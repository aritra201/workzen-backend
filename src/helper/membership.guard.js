const { AppError } = require('../utils/AppError');
const { COMPANY_ROLE } = require('../utils/enums');
const { Company, MemberProfile, EmployeeProfile } = require('../models');
const {
  findActiveMemberProfileByUserId,
  INACTIVE_MEMBER_MESSAGE,
} = require('./memberAccess.helper');
const {
  INACTIVE_EMPLOYEE_MESSAGE,
  findActiveEmployeeProfileByUserId,
} = require('./employeeAccess.helper');

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

    const inactiveMembership = await MemberProfile.findOne({
      user_id: req.user._id,
      is_active: false,
    });

    if (inactiveMembership) {
      throw new AppError(INACTIVE_MEMBER_MESSAGE, 403);
    }

    const inactiveEmployment = await EmployeeProfile.findOne({
      user_id: req.user._id,
      is_active: false,
    });

    if (inactiveEmployment) {
      throw new AppError(INACTIVE_EMPLOYEE_MESSAGE, 403);
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Loads company context for an active member (read routes in later modules).
 */
/**
 * All member-only routes must use this — enforces MemberProfile.is_active === true.
 */
async function requireActiveMember(req, res, next) {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    const member = await findActiveMemberProfileByUserId(req.user._id, true);

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

/**
 * Employee-only routes — enforces EmployeeProfile.is_active === true and user_id set.
 */
async function requireActiveEmployee(req, res, next) {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    const employeeProfile = await findActiveEmployeeProfileByUserId(req.user._id, true);

    req.employment = {
      role: COMPANY_ROLE.EMPLOYEE,
      company: employeeProfile.company_id,
      employeeProfile,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { forbidActiveMemberWriteAccess, requireActiveMember, requireActiveEmployee };
