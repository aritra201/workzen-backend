const { AppError } = require('../utils/AppError');
const { COMPANY_ROLE } = require('../utils/enums');
const { Company, MemberProfile, EmployeeProfile } = require('../models');
const { findActiveMemberProfileByUserId, INACTIVE_MEMBER_MESSAGE } = require('./memberAccess.helper');
const { INACTIVE_EMPLOYEE_MESSAGE } = require('./employeeAccess.helper');

/**
 * FR-070 / FR-074: company admin or active member may read company attendance data.
 * Attaches req.company (Company document) and req.companyViewer { role, actorRole }.
 */
async function requireCompanyAttendanceViewer(req, res, next) {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    const company = await Company.findOne({ admin_user_id: req.user._id });
    if (company) {
      req.company = company;
      req.companyViewer = { role: COMPANY_ROLE.ADMIN, actorRole: COMPANY_ROLE.ADMIN };
      return next();
    }

    try {
      const member = await findActiveMemberProfileByUserId(req.user._id, true);
      const memberCompany =
        member.company_id && member.company_id._id ? member.company_id : member.company_id;
      const companyDoc =
        member.company_id && member.company_id.timezone !== undefined
          ? member.company_id
          : await Company.findById(memberCompany);
      if (!companyDoc) {
        throw new AppError('Company not found for member', 500);
      }
      req.company = companyDoc;
      req.companyViewer = { role: COMPANY_ROLE.MEMBER, actorRole: COMPANY_ROLE.MEMBER };
      return next();
    } catch (memberErr) {
      if (!(memberErr instanceof AppError) || memberErr.statusCode !== 403) {
        throw memberErr;
      }
    }

    const inactiveMember = await MemberProfile.findOne({
      user_id: req.user._id,
      is_active: false,
    });
    if (inactiveMember) {
      throw new AppError(INACTIVE_MEMBER_MESSAGE, 403);
    }

    const employeeProfile = await EmployeeProfile.findOne({ user_id: req.user._id });
    if (employeeProfile) {
      if (!employeeProfile.is_active) {
        throw new AppError(INACTIVE_EMPLOYEE_MESSAGE, 403);
      }
      throw new AppError('Company admin or member access required', 403);
    }

    throw new AppError('Company admin or member access required', 403);
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireCompanyAttendanceViewer };
