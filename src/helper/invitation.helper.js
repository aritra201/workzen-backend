const { Invitation } = require('../models');
const { INVITATION_ROLE, INVITATION_STATUS } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { hashToken } = require('../helper/token.helper');

async function loadPendingInvitation(rawToken, invitedRole) {
  if (!rawToken) {
    throw new AppError('token is required', 400);
  }

  const tokenHash = hashToken(rawToken);

  const invitation = await Invitation.findOne({
    token_hash: tokenHash,
    invited_role: invitedRole,
  });

  if (!invitation) {
    throw new AppError('Invalid or already-used invitation link', 400);
  }

  if (invitation.status === INVITATION_STATUS.ACCEPTED) {
    throw new AppError('This invitation has already been accepted', 400);
  }

  if (invitation.status === INVITATION_STATUS.REVOKED) {
    throw new AppError('This invitation has been revoked', 400);
  }

  if (invitation.expires_at < new Date()) {
    if (invitation.status === INVITATION_STATUS.PENDING) {
      invitation.status = INVITATION_STATUS.EXPIRED;
      await invitation.save();
    }
    throw new AppError('Invitation link has expired — ask the admin to send a new invite', 400);
  }

  if (invitation.status !== INVITATION_STATUS.PENDING) {
    throw new AppError('Invitation is no longer valid', 400);
  }

  return invitation;
}

async function loadPendingMemberInvitation(rawToken) {
  return loadPendingInvitation(rawToken, INVITATION_ROLE.MEMBER);
}

async function loadPendingEmployeeInvitation(rawToken) {
  return loadPendingInvitation(rawToken, INVITATION_ROLE.EMPLOYEE);
}

module.exports = {
  loadPendingInvitation,
  loadPendingMemberInvitation,
  loadPendingEmployeeInvitation,
};
