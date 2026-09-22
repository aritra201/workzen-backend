const { MemberProfile } = require('../models');
const { AppError } = require('../utils/AppError');

const INACTIVE_MEMBER_MESSAGE =
  'Your member access has been deactivated. Contact your company admin.';

/**
 * FR-024: every member action requires an active membership row.
 */
function assertMemberProfileIsActive(member) {
  if (!member) {
    throw new AppError('Active member profile not found', 403);
  }
  if (member.is_active !== true) {
    throw new AppError(INACTIVE_MEMBER_MESSAGE, 403);
  }
}

/**
 * Loads the member profile for a user only when is_active is true (fresh from DB).
 */
async function findActiveMemberProfileByUserId(userId, populate = true) {
  let query = MemberProfile.findOne({ user_id: userId, is_active: true });

  if (populate) {
    query = query.populate('user_id', 'email').populate('company_id', 'company_name');
  }

  const member = await query;
  assertMemberProfileIsActive(member);
  return member;
}

/**
 * Re-validates a profile by id (e.g. after middleware attached req.membership).
 */
async function findActiveMemberProfileById(memberProfileId, userId, populate = true) {
  let query = MemberProfile.findOne({ _id: memberProfileId, user_id: userId });

  if (populate) {
    query = query.populate('user_id', 'email').populate('company_id', 'company_name');
  }

  const member = await query;
  assertMemberProfileIsActive(member);
  return member;
}

module.exports = {
  INACTIVE_MEMBER_MESSAGE,
  assertMemberProfileIsActive,
  findActiveMemberProfileByUserId,
  findActiveMemberProfileById,
};
