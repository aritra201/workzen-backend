const { AppError } = require('../utils/AppError');
const { Company, MemberProfile } = require('../models');
const { INACTIVE_MEMBER_MESSAGE } = require('./memberAccess.helper');

/**
 * Requires an authenticated user who owns the company (v1 admin).
 * Attaches the Company document to req.company.
 */
async function requireCompanyAdmin(req, res, next) {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    const company = await Company.findOne({ admin_user_id: req.user._id });
    if (!company) {
      const deactivatedMember = await MemberProfile.exists({
        user_id: req.user._id,
        is_active: false,
      });
      if (deactivatedMember) {
        throw new AppError(INACTIVE_MEMBER_MESSAGE, 403);
      }
      throw new AppError('Company admin access required', 403);
    }

    req.company = company;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireCompanyAdmin };
