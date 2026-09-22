const { Company, MemberProfile, EmployeeProfile } = require('../models');
const { COMPANY_ROLE } = require('../utils/enums');
const { AppError } = require('../utils/AppError');

/**
 * Resolves all company roles for a user (v1: admin of one company, optional member rows).
 */
async function resolveMemberships(userId) {
  const memberships = [];

  const adminCompany = await Company.findOne({ admin_user_id: userId });
  if (adminCompany) {
    memberships.push({
      role: COMPANY_ROLE.ADMIN,
      companyId: adminCompany._id,
      companyName: adminCompany.company_name,
      isActive: true,
    });
  }

  const memberRows = await MemberProfile.find({ user_id: userId }).populate(
    'company_id',
    'company_name'
  );

  for (const row of memberRows) {
    memberships.push({
      role: COMPANY_ROLE.MEMBER,
      companyId: row.company_id._id,
      companyName: row.company_id.company_name,
      memberProfileId: row._id,
      isActive: row.is_active,
    });
  }

  const employeeRow = await EmployeeProfile.findOne({ user_id: userId }).populate(
    'company_id',
    'company_name'
  );

  if (employeeRow) {
    memberships.push({
      role: COMPANY_ROLE.EMPLOYEE,
      companyId: employeeRow.company_id._id,
      companyName: employeeRow.company_id.company_name,
      employeeProfileId: employeeRow._id,
      isActive: employeeRow.is_active,
    });
  }

  return memberships;
}

/**
 * FR-024: deactivated members cannot authenticate. Company admins and users
 * with at least one active member/employee profile may still sign in.
 */
async function assertUserCanAuthenticate(user) {
  const userId = user._id;

  const isAdmin = await Company.exists({ admin_user_id: userId });
  if (isAdmin) {
    return;
  }

  const [hasActiveMember, hasActiveEmployee, hasMemberProfile, hasEmployeeProfile] =
    await Promise.all([
      MemberProfile.exists({ user_id: userId, is_active: true }),
      EmployeeProfile.exists({ user_id: userId, is_active: true }),
      MemberProfile.exists({ user_id: userId }),
      EmployeeProfile.exists({ user_id: userId }),
    ]);

  if (hasActiveMember || hasActiveEmployee) {
    return;
  }

  if (hasMemberProfile) {
    throw new AppError(
      'Your member access has been deactivated. Contact your company admin.',
      403
    );
  }

  if (hasEmployeeProfile) {
    throw new AppError('Your employee account has been deactivated.', 403);
  }
}

module.exports = { resolveMemberships, assertUserCanAuthenticate };
