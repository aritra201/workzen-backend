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

  return {
    email: invitation.invited_email,
    role: INVITATION_ROLE.MEMBER,
    companyId: invitation.company_id,
    companyName: company?.company_name ?? null,
    expiresAt: invitation.expires_at,
  };
}

async function upsertActiveMemberProfile({ userId, companyId, session }) {
  let member = await MemberProfile.findOne({ user_id: userId, company_id: companyId }).session(
    session
  );

  if (!member) {
    member = new MemberProfile({
      user_id: userId,
      company_id: companyId,
      is_active: true,
    });
  } else {
    member.is_active = true;
  }

  await member.save({ session });
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

      member = await upsertActiveMemberProfile({
        userId: user._id,
        companyId: invitation.company_id,
        session,
      });

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
        metadata: { invited_role: INVITATION_ROLE.MEMBER, invited_email: email },
      });
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

      member = await upsertActiveMemberProfile({
        userId: user._id,
        companyId: invitation.company_id,
        session,
      });

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
        metadata: { invited_role: INVITATION_ROLE.MEMBER, invited_email: email },
      });
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
