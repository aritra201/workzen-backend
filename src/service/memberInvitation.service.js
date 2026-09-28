const { User, Company, MemberProfile, Invitation } = require('../models');
const {
  AUTH_PROVIDER,
  COMPANY_ROLE,
  INVITATION_ROLE,
  INVITATION_STATUS,
} = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { loadPendingMemberInvitation } = require('../helper/invitation.helper');
const { verifyGoogleIdToken } = require('../helper/google.helper');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { issueAndPersistTokens } = require('./auth.service');

async function getMemberInvitationPreview(rawToken) {
  const invitation = await loadPendingMemberInvitation(rawToken);
  const company = await Company.findById(invitation.company_id);
  const member = await MemberProfile.findOne({
    company_id: invitation.company_id,
    member_email: invitation.invited_email,
  });

  const memberName =
    member?.member_name || invitation.invited_name?.trim() || null;

  return {
    email: invitation.invited_email,
    memberName,
    role: INVITATION_ROLE.MEMBER,
    companyId: invitation.company_id,
    companyName: company?.company_name ?? null,
    expiresAt: invitation.expires_at,
  };
}

function applyInvitedMemberName(member, invitedName) {
  const name = typeof invitedName === 'string' ? invitedName.trim() : '';
  if (name && !member.member_name) {
    member.member_name = name;
  }
}

async function linkMemberToUser({ invitation, user, session }) {
  const email = invitation.invited_email;

  let member = await MemberProfile.findOne({
    company_id: invitation.company_id,
    member_email: email,
  }).session(session);

  if (!member) {
    member = await MemberProfile.findOne({
      company_id: invitation.company_id,
      user_id: user._id,
    }).session(session);
  }

  if (!member) {
    member = new MemberProfile({
      user_id: user._id,
      company_id: invitation.company_id,
      member_email: email,
      is_active: true,
    });
    applyInvitedMemberName(member, invitation.invited_name);
    await member.save({ session });

    invitation.status = INVITATION_STATUS.ACCEPTED;
    invitation.accepted_at = new Date();
    await invitation.save({ session });

    await writeActivityLog({
      companyId: invitation.company_id,
      actorUserId: user._id,
      actorRole: COMPANY_ROLE.MEMBER,
      actionType: 'invitation.accepted',
      targetType: 'Invitation',
      targetId: invitation._id,
      metadata: {
        invited_role: INVITATION_ROLE.MEMBER,
        invited_email: email,
        invited_name: invitation.invited_name ?? null,
        member_profile_id: member._id,
      },
    });

    return member;
  }

  if (member.is_active && member.user_id) {
    throw new AppError('This member invitation has already been accepted', 409);
  }

  const existingLink = await MemberProfile.findOne({ user_id: user._id }).session(session);
  if (existingLink && existingLink._id.toString() !== member._id.toString()) {
    throw new AppError(
      'This account is already linked to another member profile in WorkZen',
      409
    );
  }

  applyInvitedMemberName(member, invitation.invited_name);
  if (!member.member_email) {
    member.member_email = email;
  }
  member.user_id = user._id;
  member.is_active = true;
  await member.save({ session });

  invitation.status = INVITATION_STATUS.ACCEPTED;
  invitation.accepted_at = new Date();
  await invitation.save({ session });

  await writeActivityLog({
    companyId: invitation.company_id,
    actorUserId: user._id,
    actorRole: COMPANY_ROLE.MEMBER,
    actionType: 'invitation.accepted',
    targetType: 'Invitation',
    targetId: invitation._id,
    metadata: {
      invited_role: INVITATION_ROLE.MEMBER,
      invited_email: email,
      invited_name: invitation.invited_name ?? null,
      member_profile_id: member._id,
    },
  });

  return member;
}

/**
 * FR-022: accept member invite — set password (new account) or verify password (existing local).
 */
async function acceptMemberInvitationManual({ rawToken, password }) {
  if (!password || password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const invitation = await loadPendingMemberInvitation(rawToken);
  const email = invitation.invited_email;

  const session = await User.startSession();
  let user;
  let member;

  try {
    await session.withTransaction(async () => {
      user = await User.findOne({ email }).select('+password_hash').session(session);

      if (!user) {
        user = new User({
          email,
          password_hash: password,
          auth_provider: AUTH_PROVIDER.LOCAL,
          is_active: true,
          is_email_verified: true,
        });
        await user.save({ session });
      } else if (user.auth_provider === AUTH_PROVIDER.GOOGLE) {
        throw new AppError(
          'This email uses Google sign-in — accept the invitation with Google instead',
          400
        );
      } else {
        const passwordMatches = await user.comparePassword(password);
        if (!passwordMatches) {
          throw new AppError(
            'An account with this email already exists — enter your current password to accept, or use forgot password',
            401
          );
        }
        if (!user.is_active) {
          user.is_active = true;
          user.is_email_verified = true;
          await user.save({ session });
        }
      }

      member = await linkMemberToUser({ invitation, user, session });
    });
  } finally {
    session.endSession();
  }

  const tokens = await issueAndPersistTokens(user);

  return {
    ...tokens,
    role: COMPANY_ROLE.MEMBER,
    companyId: invitation.company_id,
    memberProfileId: member._id,
  };
}

/**
 * FR-022: Google accept — OAuth email must exactly match invited email.
 */
async function acceptMemberInvitationGoogle({ rawToken, idToken }) {
  const invitation = await loadPendingMemberInvitation(rawToken);
  const { googleId, email } = await verifyGoogleIdToken(idToken);

  if (email !== invitation.invited_email) {
    throw new AppError('Google account email must match the invited email', 403);
  }

  const session = await User.startSession();
  let user;
  let member;

  try {
    await session.withTransaction(async () => {
      user = await User.findOne({ google_id: googleId }).session(session);

      if (!user) {
        const existingLocal = await User.findOne({ email }).session(session);
        if (existingLocal) {
          throw new AppError(
            'An account with this email already exists — accept with your password instead',
            409
          );
        }

        user = new User({
          email,
          auth_provider: AUTH_PROVIDER.GOOGLE,
          google_id: googleId,
          is_active: true,
          is_email_verified: true,
        });
        await user.save({ session });
      } else if (!user.is_active) {
        user.is_active = true;
        await user.save({ session });
      }

      member = await linkMemberToUser({ invitation, user, session });
    });
  } finally {
    session.endSession();
  }

  const tokens = await issueAndPersistTokens(user);

  return {
    ...tokens,
    role: COMPANY_ROLE.MEMBER,
    companyId: invitation.company_id,
    memberProfileId: member._id,
  };
}

module.exports = {
  getMemberInvitationPreview,
  acceptMemberInvitationManual,
  acceptMemberInvitationGoogle,
};
