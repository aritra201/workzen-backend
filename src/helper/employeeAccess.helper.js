const { EmployeeProfile } = require('../models');
const { AppError } = require('../utils/AppError');

const INACTIVE_EMPLOYEE_MESSAGE = 'Your employee account has been deactivated.';

function assertEmployeeProfileIsActive(employee) {
  if (!employee) {
    throw new AppError('Active employee profile not found', 403);
  }
  if (employee.is_active !== true) {
    throw new AppError(INACTIVE_EMPLOYEE_MESSAGE, 403);
  }
  if (!employee.user_id) {
    throw new AppError('Employee account is not fully activated', 403);
  }
}

async function findActiveEmployeeProfileByUserId(userId, populate = true) {
  let query = EmployeeProfile.findOne({ user_id: userId, is_active: true });

  if (populate) {
    query = query.populate('company_id', 'company_name');
  }

  const employee = await query;
  assertEmployeeProfileIsActive(employee);
  return employee;
}

async function findActiveEmployeeProfileById(employeeProfileId, userId, populate = true) {
  let query = EmployeeProfile.findOne({ _id: employeeProfileId, user_id: userId });

  if (populate) {
    query = query.populate('company_id', 'company_name');
  }

  const employee = await query;
  assertEmployeeProfileIsActive(employee);
  return employee;
}

module.exports = {
  INACTIVE_EMPLOYEE_MESSAGE,
  assertEmployeeProfileIsActive,
  findActiveEmployeeProfileByUserId,
  findActiveEmployeeProfileById,
};
