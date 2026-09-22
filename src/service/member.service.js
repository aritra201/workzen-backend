const { User, MemberProfile, Invitation } = require('../models');
const {
  COMPANY_ROLE,
  INVITATION_ROLE,
  INVITATION_STATUS,
} = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { sendMemberInvitationEmail } = require('../helper/email.helper');

function serializeMember(member) {
  const user = member.user_id;
  return {
    id: member._id,
    userId: user._id,
    email: user.email,
    role: COMPANY_ROLE.MEMBER,
    isActive: member.is_active,
    joinedAt: member.created_at,
  };
}

/**
 * FR-021: list members for the admin's company.
 */
async function listMembers(companyId) {
  const members = await MemberProfile.find({ company_id: companyId })
    .populate('user_id', 'email')
    .sort({ created_at: -1 });

  return members.map(serializeMember);
}

/**
 * FR-021: invite a view-only member by email.
 */
async function inviteMember({ company, adminUserId, email }) {
  const invitedEmail = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(invitedEmail)) {
    throw new AppError('A valid email is required', 400);
  }

  const adminUser = await User.findById(company.admin_user_id);
  if (adminUser.email === invitedEmail) {
    throw new AppError('You cannot invite yourself as a member', 400);
  }

  const existingUser = await User.findOne({ email: invitedEmail });
  if (existingUser) {
    const existingMember = await MemberProfile.findOne({
      company_id: company._id,
      user_id: existingUser._id,
    });
    if (existingMember?.is_active) {
      throw new AppError('This user is already an active member of your company', 409);
    }
  }

  const pendingInvite = await Invitation.findOne({
    company_id: company._id,
    invited_email: invitedEmail,
    invited_role: INVITATION_ROLE.MEMBER,
    status: INVITATION_STATUS.PENDING,
    expires_at: { $gt: new Date() },
  });

  if (pendingInvite) {
    throw new AppError('An invitation is already pending for this email', 409);
  }

  const { rawToken, tokenHash } = Invitation.generateToken();

  const invitation = await Invitation.create({
    company_id: company._id,
    invited_email: invitedEmail,
    invited_role: INVITATION_ROLE.MEMBER,
    token_hash: tokenHash,
    status: INVITATION_STATUS.PENDING,
    expires_at: Invitation.defaultExpiry(),
  });

  await sendMemberInvitationEmail({
    to: invitedEmail,
    rawToken,
    companyName: company.company_name || 'a WorkZen company',
  });

  await writeActivityLog({
    companyId: company._id,
    actorUserId: adminUserId,
    actorRole: COMPANY_ROLE.ADMIN,
    actionType: 'invitation.sent',
    targetType: 'Invitation',
    targetId: invitation._id,
    metadata: { invited_email: invitedEmail, invited_role: INVITATION_ROLE.MEMBER },
  });

  return {
    invitationId: invitation._id,
    email: invitedEmail,
    expiresAt: invitation.expires_at,
  };
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
  }).populate('user_id', 'email');

  if (!member) {
    throw new AppError('Member not found', 404);
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
  inviteMember,
  setMemberActive,
};
