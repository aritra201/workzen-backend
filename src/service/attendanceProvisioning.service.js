const { DateTime } = require('luxon');
const { Company, EmployeeProfile, Attendance, Invitation } = require('../models');
const { COMPANY_ROLE, INVITATION_ROLE, INVITATION_STATUS } = require('../utils/enums');
const { getOrCreateAttendanceForEmployeeDate } = require('./attendance.service');
const {
  DEFAULT_TIMEZONE,
  getCompanyTodayDateKey,
  dateKeyToUtcDate,
} = require('../utils/timezone.helper');

/** Align with company attendance list default window (see attendanceVerification.service). */
const PROVISION_LOOKBACK_DAYS = 30;

function listDateKeysInclusive(startKey, endKey, timezone) {
  let current = DateTime.fromFormat(startKey, 'yyyy-MM-dd', { zone: timezone }).startOf('day');
  const end = DateTime.fromFormat(endKey, 'yyyy-MM-dd', { zone: timezone }).startOf('day');
  const keys = [];
  while (current <= end) {
    keys.push(current.toFormat('yyyy-MM-dd'));
    current = current.plus({ days: 1 });
  }
  return keys;
}

function startDateKeyForLookback(todayKey, timezone, lookbackDays) {
  const windowDays = Math.max(1, lookbackDays);
  return DateTime.fromFormat(todayKey, 'yyyy-MM-dd', { zone: timezone })
    .minus({ days: windowDays - 1 })
    .toFormat('yyyy-MM-dd');
}

function dateKeyFromInstant(instant, timezone) {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat('yyyy-MM-dd');
}

async function resolveEmployeeActivatedAt(employee) {
  if (employee.activated_at) {
    return employee.activated_at;
  }

  const invitation = await Invitation.findOne({
    company_id: employee.company_id,
    invited_email: employee.employee_email,
    invited_role: INVITATION_ROLE.EMPLOYEE,
    status: INVITATION_STATUS.ACCEPTED,
  })
    .select('accepted_at')
    .sort({ accepted_at: -1 });

  const resolved =
    invitation?.accepted_at || employee.updated_at || employee.created_at || new Date();

  await EmployeeProfile.updateOne({ _id: employee._id }, { $set: { activated_at: resolved } });
  employee.activated_at = resolved;
  return resolved;
}

function provisionStartDateKeyForEmployee(employee, windowStartKey, todayKey, timezone) {
  if (!employee.activated_at) {
    return windowStartKey;
  }
  const activatedKey = dateKeyFromInstant(employee.activated_at, timezone);
  return activatedKey > windowStartKey ? activatedKey : windowStartKey;
}

/**
 * Ensures an Attendance document exists for each active employee for each eligible day in
 * [max(window start, employee activated date), today] (company timezone).
 */
async function provisionAttendanceForCompany(company, { lookbackDays = PROVISION_LOOKBACK_DAYS } = {}) {
  const timezone = company.timezone || DEFAULT_TIMEZONE;
  const todayKey = getCompanyTodayDateKey(timezone);
  const windowStartKey = startDateKeyForLookback(todayKey, timezone, lookbackDays);

  const employees = await EmployeeProfile.find({
    company_id: company._id,
    is_active: true,
  }).select('_id user_id company_id employee_email activated_at created_at updated_at');

  let created = 0;
  const actorUserId = company.admin_user_id;

  for (const employee of employees) {
    await resolveEmployeeActivatedAt(employee);
    const employeeStartKey = provisionStartDateKeyForEmployee(
      employee,
      windowStartKey,
      todayKey,
      timezone
    );

    if (employeeStartKey > todayKey) {
      continue;
    }

    const dateKeys = listDateKeysInclusive(employeeStartKey, todayKey, timezone);

    for (const dateKey of dateKeys) {
      const existed = await Attendance.exists({
        employee_id: employee._id,
        date: dateKeyToUtcDate(dateKey),
      });

      await getOrCreateAttendanceForEmployeeDate({
        company,
        employeeProfile: employee,
        dateKey,
        actorUserId: employee.user_id || actorUserId,
        actorRole: COMPANY_ROLE.SYSTEM,
      });

      if (!existed) {
        created += 1;
      }
    }
  }

  return {
    companyId: company._id,
    timezone,
    todayKey,
    windowStartKey,
    activeEmployees: employees.length,
    recordsCreated: created,
  };
}

/**
 * Creates empty attendance rows for one employee for each day in [startKey, endKey]
 * that falls within [activated date, today] (company timezone).
 */
async function ensureEmployeeAttendanceProvisionedForRange(
  employeeProfile,
  company,
  startKey,
  endKey
) {
  const timezone = company.timezone || DEFAULT_TIMEZONE;
  const todayKey = getCompanyTodayDateKey(timezone);
  const employee = await EmployeeProfile.findById(employeeProfile._id).select(
    '_id user_id company_id employee_email activated_at created_at updated_at'
  );
  if (!employee) {
    return;
  }

  await resolveEmployeeActivatedAt(employee);
  const windowStartKey = provisionStartDateKeyForEmployee(employee, startKey, todayKey, timezone);
  const rangeEndKey = endKey > todayKey ? todayKey : endKey;

  if (windowStartKey > rangeEndKey) {
    return;
  }

  const actorUserId = company.admin_user_id;
  const dateKeys = listDateKeysInclusive(windowStartKey, rangeEndKey, timezone);

  for (const dateKey of dateKeys) {
    await getOrCreateAttendanceForEmployeeDate({
      company,
      employeeProfile: employee,
      dateKey,
      actorUserId: employee.user_id || actorUserId,
      actorRole: COMPANY_ROLE.SYSTEM,
    });
  }
}

async function provisionAttendanceForAllCompanies({ lookbackDays = PROVISION_LOOKBACK_DAYS } = {}) {
  const companies = await Company.find({}).select('_id timezone admin_user_id company_name');
  const results = [];
  let totalCreated = 0;

  for (const company of companies) {
    const summary = await provisionAttendanceForCompany(company, { lookbackDays });
    results.push(summary);
    totalCreated += summary.recordsCreated;
  }

  return {
    companiesProcessed: companies.length,
    recordsCreated: totalCreated,
    results,
  };
}

module.exports = {
  PROVISION_LOOKBACK_DAYS,
  provisionAttendanceForCompany,
  provisionAttendanceForAllCompanies,
  ensureEmployeeAttendanceProvisionedForRange,
  resolveEmployeeActivatedAt,
  provisionStartDateKeyForEmployee,
};
