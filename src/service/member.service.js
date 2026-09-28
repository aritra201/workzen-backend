const { User, MemberProfile, Invitation } = require('../models');
const {
  COMPANY_ROLE,
  INVITATION_ROLE,
  INVITATION_STATUS,
} = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { sendMemberInvitationEmail } = require('../helper/email.helper');
const { uploadImageBuffer } = require('../helper/cloudinary.helper');
const {
  assertMemberProfileIsActive,
  findActiveMemberProfileByUserId,
  findActiveMemberProfileById,
} = require('../helper/memberAccess.helper');

function serializeMember(member) {
  const user = member.user_id;
  const company = member.company_id;

  return {
    id: member._id,
    userId: user?._id ?? null,
    email: user?.email ?? member.member_email ?? null,
    name: member.member_name ?? null,
    profilePicture: member.member_profile_picture ?? null,
    companyId: company._id,
    companyName: company.company_name ?? null,
    role: COMPANY_ROLE.MEMBER,
    isActive: member.is_active,
    joinedAt: member.created_at,
  };
}

async function loadMemberProfileForUser(userId, memberProfileId) {
  if (memberProfileId) {
    return findActiveMemberProfileById(memberProfileId, userId, true);
  }
  return findActiveMemberProfileByUserId(userId, true);
}

/**
 * FR-021: list members for the admin's company.
 */
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

async function listMembers(companyId) {
  const members = await MemberProfile.find({ company_id: companyId })
    .populate('user_id', 'email')
    .populate('company_id', 'company_name')
    .sort({ created_at: -1 });

  return members.map(serializeMember);
}

async function listMembersPaginated(companyId, { page, limit } = {}) {
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Number.parseInt(limit, 10) || DEFAULT_LIST_LIMIT)
  );
  const skip = (pageNum - 1) * limitNum;

  const filter = { company_id: companyId };

  const [total, members] = await Promise.all([
    MemberProfile.countDocuments(filter),
    MemberProfile.find(filter)
      .populate('user_id', 'email')
      .populate('company_id', 'company_name')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limitNum),
  ]);

  const items = members.map(serializeMember);

  return {
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limitNum),
    items,
    members: items,
  };
}

async function getMyMemberProfile({ userId, memberProfileId }) {
  const member = await loadMemberProfileForUser(userId, memberProfileId);
  return serializeMember(member);
}

async function updateMyMemberProfile({ userId, memberProfileId, body }) {
  if (body.profilePicture !== undefined) {
    throw new AppError(
      'Use POST /api/members/me/profile-picture with multipart form-data (field: profilePicture)',
      400
    );
  }

  if (body.name === undefined) {
    throw new AppError('name is required', 400);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    throw new AppError('name cannot be empty', 400);
  }

  const member = await loadMemberProfileForUser(userId, memberProfileId);
  assertMemberProfileIsActive(member);

  const beforeName = member.member_name ?? null;

  member.member_name = name;
  await member.save();

  if (beforeName !== name) {
    await writeActivityLog({
      companyId: member.company_id._id,
      actorUserId: userId,
      actorRole: COMPANY_ROLE.MEMBER,
      actionType: 'member.profile_updated',
      targetType: 'MemberProfile',
      targetId: member._id,
      beforeValue: { member_name: beforeName },
      afterValue: { member_name: name },
    });
  }

  return serializeMember(
    await MemberProfile.findById(member._id)
      .populate('user_id', 'email')
      .populate('company_id', 'company_name')
  );
}

async function uploadMyMemberProfilePicture({ userId, memberProfileId, file }) {
  if (!file || !file.buffer) {
    throw new AppError('profilePicture file is required', 400);
  }

  const member = await loadMemberProfileForUser(userId, memberProfileId);
  assertMemberProfileIsActive(member);

  const beforePicture = member.member_profile_picture ?? null;

  const folder = `workzen/members/${member._id.toString()}/profile`;
  const publicId = 'member_profile_picture';

  let uploadResult;
  try {
    uploadResult = await uploadImageBuffer(file.buffer, { folder, publicId });
  } catch (err) {
    throw new AppError('Failed to upload image — try again later', 502);
  }

  member.member_profile_picture = uploadResult.secure_url;
  await member.save();

  if (beforePicture !== member.member_profile_picture) {
    await writeActivityLog({
      companyId: member.company_id._id,
      actorUserId: userId,
      actorRole: COMPANY_ROLE.MEMBER,
      actionType: 'member.profile_updated',
      targetType: 'MemberProfile',
      targetId: member._id,
      beforeValue: { member_profile_picture: beforePicture },
      afterValue: { member_profile_picture: member.member_profile_picture },
    });
  }

  return serializeMember(
    await MemberProfile.findById(member._id)
      .populate('user_id', 'email')
      .populate('company_id', 'company_name')
  );
}

function normalizeInviteEmail(email) {
  const invitedEmail = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(invitedEmail)) {
    throw new AppError('A valid email is required', 400);
  }
  return invitedEmail;
}

function normalizeMemberName(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (!normalized) {
    throw new AppError('memberName is required', 400);
  }
  return normalized;
}

async function assertMemberInviteAllowed(company, invitedEmail) {
  const adminUser = await User.findById(company.admin_user_id);
  if (adminUser.email === invitedEmail) {
    throw new AppError('You cannot invite yourself as a member', 400);
  }

  let existingInCompany = await MemberProfile.findOne({
    company_id: company._id,
    member_email: invitedEmail,
  });

  if (existingInCompany?.is_active && existingInCompany.user_id) {
    throw new AppError('This email is already an active member of your company', 409);
  }

  const existingUser = await User.findOne({ email: invitedEmail });
  if (existingUser) {
    const linkedMember = await MemberProfile.findOne({ user_id: existingUser._id });
    if (
      linkedMember &&
      linkedMember.is_active &&
      linkedMember.company_id.toString() !== company._id.toString()
    ) {
      throw new AppError(
        'This user is already an active member at another company in WorkZen',
        409
      );
    }

    if (!existingInCompany) {
      existingInCompany = await MemberProfile.findOne({
        company_id: company._id,
        user_id: existingUser._id,
      });
    }

    if (existingInCompany?.is_active) {
      throw new AppError('This user is already an active member of your company', 409);
    }
  }

  return existingInCompany;
}

async function revokeSupersededMemberInvites(companyId, invitedEmail) {
  const openInvites = await Invitation.find({
    company_id: companyId,
    invited_email: invitedEmail,
    invited_role: INVITATION_ROLE.MEMBER,
    status: INVITATION_STATUS.PENDING,
  });

  const now = new Date();
  for (const invite of openInvites) {
    invite.status = invite.expires_at < now ? INVITATION_STATUS.EXPIRED : INVITATION_STATUS.REVOKED;
    await invite.save();
  }
}

async function createAndEmailMemberInvitation({
  company,
  adminUserId,
  invitedEmail,
  memberName,
  memberProfileId,
  actionType,
}) {
  const { rawToken, tokenHash } = Invitation.generateToken();

  const invitation = await Invitation.create({
    company_id: company._id,
    invited_email: invitedEmail,
    invited_role: INVITATION_ROLE.MEMBER,
    invited_name: memberName,
    token_hash: tokenHash,
    status: INVITATION_STATUS.PENDING,
    expires_at: Invitation.defaultExpiry(),
  });

  await sendMemberInvitationEmail({
    to: invitedEmail,
    rawToken,
    companyName: company.company_name || 'a WorkZen company',
    memberName,
  });

  await writeActivityLog({
    companyId: company._id,
    actorUserId: adminUserId,
    actorRole: COMPANY_ROLE.ADMIN,
    actionType,
    targetType: 'Invitation',
    targetId: invitation._id,
    metadata: {
      invited_email: invitedEmail,
      invited_role: INVITATION_ROLE.MEMBER,
      invited_name: memberName,
      member_profile_id: memberProfileId,
    },
  });

  return {
    invitationId: invitation._id,
    memberProfileId,
    email: invitedEmail,
    memberName,
    expiresAt: invitation.expires_at,
  };
}

/**
 * FR-021: invite a view-only member by email.
 */
async function inviteMember({ company, adminUserId, email, memberName }) {
  const invitedEmail = normalizeInviteEmail(email);
  const name = normalizeMemberName(memberName);
  let memberProfile = await assertMemberInviteAllowed(company, invitedEmail);

  const pendingInvite = await Invitation.findOne({
    company_id: company._id,
    invited_email: invitedEmail,
    invited_role: INVITATION_ROLE.MEMBER,
    status: INVITATION_STATUS.PENDING,
    expires_at: { $gt: new Date() },
  });

  if (pendingInvite) {
    const pendingProfile = await MemberProfile.findOne({
      company_id: company._id,
      member_email: invitedEmail,
    });

    if (pendingProfile && !pendingProfile.user_id) {
      throw new AppError(
        'An invitation is already pending for this email — use resend invitation instead',
        409
      );
    }

    await revokeSupersededMemberInvites(company._id, invitedEmail);
  }

  if (!memberProfile) {
    memberProfile = await MemberProfile.create({
      company_id: company._id,
      member_name: name,
      member_email: invitedEmail,
      is_active: false,
    });
  } else {
    memberProfile.member_name = name;
    memberProfile.member_email = invitedEmail;
    await memberProfile.save();
  }

  return createAndEmailMemberInvitation({
    company,
    adminUserId,
    invitedEmail,
    memberName: name,
    memberProfileId: memberProfile._id,
    actionType: 'invitation.sent',
  });
}

/**
 * Resend when invite expired, was never accepted, or member is inactive.
 */
async function resendMemberInvitation({ company, adminUserId, email }) {
  const invitedEmail = normalizeInviteEmail(email);
  await assertMemberInviteAllowed(company, invitedEmail);

  const hadPriorInvite = await Invitation.exists({
    company_id: company._id,
    invited_email: invitedEmail,
    invited_role: INVITATION_ROLE.MEMBER,
  });

  let memberProfile = await MemberProfile.findOne({
    company_id: company._id,
    member_email: invitedEmail,
  });

  if (!memberProfile) {
    const existingUser = await User.findOne({ email: invitedEmail });
    if (existingUser) {
      memberProfile = await MemberProfile.findOne({
        company_id: company._id,
        user_id: existingUser._id,
        is_active: false,
      });
    }
  }

  if (!hadPriorInvite && !memberProfile) {
    throw new AppError(
      'No prior invitation found for this email — send a new invitation instead',
      404
    );
  }

  await revokeSupersededMemberInvites(company._id, invitedEmail);

  let memberName = memberProfile?.member_name?.trim() || '';
  if (!memberName) {
    const lastInvite = await Invitation.findOne({
      company_id: company._id,
      invited_email: invitedEmail,
      invited_role: INVITATION_ROLE.MEMBER,
      invited_name: { $exists: true, $nin: [null, ''] },
    })
      .sort({ created_at: -1 })
      .select('invited_name');
    memberName = lastInvite?.invited_name?.trim() || '';
  }
  if (!memberName) {
    throw new AppError(
      'Member name is missing for this invite — send a new invitation with name and email',
      400
    );
  }

  if (!memberProfile) {
    memberProfile = await MemberProfile.create({
      company_id: company._id,
      member_name: memberName,
      member_email: invitedEmail,
      is_active: false,
    });
  } else {
    memberProfile.member_name = memberName;
    memberProfile.member_email = invitedEmail;
    await memberProfile.save();
  }

  return createAndEmailMemberInvitation({
    company,
    adminUserId,
    invitedEmail,
    memberName,
    memberProfileId: memberProfile._id,
    actionType: 'invitation.resent',
  });
}

/**
 * FR-024: deactivate or reactivate a member.
 */
async function setMemberActive({ company, adminUserId, memberId, isActive }) {
  if (typeof isActive !== 'boolean') {
    throw new AppError('isActive must be a boolean', 400);
  }

  const member = await MemberProfile.findOne({
    _id: memberId,
    company_id: company._id,
  })
    .populate('user_id', 'email')
    .populate('company_id', 'company_name');

  if (!member) {
    throw new AppError('Member not found', 404);
  }

  if (!member.user_id && isActive) {
    throw new AppError('Cannot activate a member who has not accepted the invitation yet', 400);
  }

  if (member.is_active === isActive) {
    return serializeMember(member);
  }

  const before = member.is_active;
  member.is_active = isActive;
  await member.save();

  await writeActivityLog({
    companyId: company._id,
    actorUserId: adminUserId,
    actorRole: COMPANY_ROLE.ADMIN,
    actionType: isActive ? 'member.reactivated' : 'member.deactivated',
    targetType: 'MemberProfile',
    targetId: member._id,
    beforeValue: { is_active: before },
    afterValue: { is_active: isActive },
    metadata: { member_email: member.user_id.email },
  });

  return serializeMember(member);
}

module.exports = {
  listMembers,
  listMembersPaginated,
  getMyMemberProfile,
  updateMyMemberProfile,
  uploadMyMemberProfilePicture,
  inviteMember,
  resendMemberInvitation,
  setMemberActive,
};
