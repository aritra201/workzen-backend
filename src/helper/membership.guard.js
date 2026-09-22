const { AppError } = require('../utils/AppError');
const { COMPANY_ROLE } = require('../utils/enums');
const { Company, MemberProfile } = require('../models');

/**
 * FR-023: members have view-only access — block write/admin actions company-wide.
 * Use on routes that must remain admin-only (invites, profile edits, etc.).
 */
async function forbidActiveMemberWriteAccess(req, res, next) {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    const isAdmin = await Company.exists({ admin_user_id: req.user._id });
    if (isAdmin) {
      return next();
    }

    const activeMembership = await MemberProfile.findOne({
      user_id: req.user._id,
      is_active: true,
    });

    if (activeMembership) {
      throw new AppError('Members have view-only access and cannot perform this action', 403);
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Loads company context for an active member (read routes in later modules).
 */
async function requireActiveMember(req, res, next) {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    const member = await MemberProfile.findOne({
      user_id: req.user._id,
      is_active: true,
    }).populate('company_id');

    if (!member) {
      throw new AppError('Active member access required', 403);
    }

    req.membership = {
      role: COMPANY_ROLE.MEMBER,
      company: member.company_id,
      memberProfile: member,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { forbidActiveMemberWriteAccess, requireActiveMember };
