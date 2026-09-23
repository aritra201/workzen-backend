const { Attendance, EmployeeProfile } = require('../models');
const { SHIFT_KEY, COMPANY_ROLE } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { dateKeyToUtcDate, getCompanyTodayDateKey } = require('../utils/timezone.helper');
const {
  getOrCreateAttendanceForEmployeeDate,
  serializeAttendanceRecord,
} = require('./attendance.service');

const EXTRA_SHIFT_API_MAP = {
  extraDayShift: SHIFT_KEY.EXTRA_DAY,
  extraNightShift: SHIFT_KEY.EXTRA_NIGHT,
};

function parseDateKey(date) {
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    throw new AppError('date is required in yyyy-MM-dd format', 400);
  }
  return date.trim();
}

/**
 * FR-050/051: admin declares extra day/night shift(s) for an employee on a date.
 */
async function declareExtraShifts({
  company,
  adminUserId,
  employeeId,
  date,
  extraDayShift,
  extraNightShift,
}) {
  const dateKey = parseDateKey(date);

  const employee = await EmployeeProfile.findOne({
    _id: employeeId,
    company_id: company._id,
  });

  if (!employee) {
    throw new AppError('Employee not found in your company', 404);
  }
  if (!employee.is_active) {
    throw new AppError('Cannot declare extra shifts for an inactive employee', 400);
  }

  const wantsDay = Boolean(extraDayShift);
  const wantsNight = Boolean(extraNightShift);
  if (!wantsDay && !wantsNight) {
    throw new AppError('At least one of extraDayShift or extraNightShift must be true', 400);
  }

  const { attendance, timezone } = await getOrCreateAttendanceForEmployeeDate({
    company,
    employeeProfile: employee,
    dateKey,
    actorUserId: adminUserId,
    actorRole: COMPANY_ROLE.ADMIN,
  });

  const declaredKeys = [];
  const now = new Date();

  if (wantsDay) {
    const shift = attendance.shifts.extra_day;
    if (!shift.declared) {
      shift.declared = true;
      shift.declared_by = adminUserId;
      shift.declared_at = now;
      declaredKeys.push(SHIFT_KEY.EXTRA_DAY);
    }
  }

  if (wantsNight) {
    const shift = attendance.shifts.extra_night;
    if (!shift.declared) {
      shift.declared = true;
      shift.declared_by = adminUserId;
      shift.declared_at = now;
      declaredKeys.push(SHIFT_KEY.EXTRA_NIGHT);
    }
  }

  if (declaredKeys.length === 0) {
    throw new AppError('Selected extra shift(s) are already declared for this date', 409);
  }

  attendance.markModified('shifts');
  await attendance.save();

  for (const shiftKey of declaredKeys) {
    await writeActivityLog({
      companyId: company._id,
      actorUserId: adminUserId,
      actorRole: COMPANY_ROLE.ADMIN,
      actionType: 'extra_shift.declared',
      targetType: 'Attendance',
      targetId: attendance._id,
      metadata: {
        date: dateKey,
        shift_key: shiftKey,
        employee_id: employee._id,
        employee_email: employee.employee_email,
      },
    });
  }

  return serializeAttendanceRecord(attendance, dateKey, timezone);
}

function serializeDeclaredExtraShift(shift) {
  if (!shift?.declared) {
    return null;
  }
  return {
    declared: true,
    declaredAt: shift.declared_at ?? null,
    fulfilled: Boolean(shift.amount),
  };
}

function buildExtraShiftListRow(employee, attendance) {
  const extraDay = attendance
    ? serializeDeclaredExtraShift(attendance.shifts?.extra_day)
    : null;
  const extraNight = attendance
    ? serializeDeclaredExtraShift(attendance.shifts?.extra_night)
    : null;

  return {
    attendanceId: attendance?._id ?? null,
    employeeId: employee._id,
    employeeName: employee.employee_name,
    employeeEmail: employee.employee_email,
    extraDay,
    extraNight,
    lockAttendance: attendance?.lock_attendance ?? false,
  };
}

/**
 * Admin view for a date (defaults to company today): all active employees with
 * employeeId for declare UI, plus `declarations` for rows that already have
 * an extra day/night shift declared.
 */
async function listExtraShiftDeclarations({ company, date }) {
  const dateKey = date ? parseDateKey(date) : getCompanyTodayDateKey(company.timezone);
  const storedDate = dateKeyToUtcDate(dateKey);

  const employeeProfiles = await EmployeeProfile.find({
    company_id: company._id,
    is_active: true,
    user_id: { $ne: null },
  })
    .select('employee_name employee_email')
    .sort({ employee_name: 1 });

  const attendanceRecords = await Attendance.find({
    company_id: company._id,
    date: storedDate,
  }).select('employee_id shifts lock_attendance');

  const attendanceByEmployeeId = new Map();
  for (const attendance of attendanceRecords) {
    attendanceByEmployeeId.set(attendance.employee_id.toString(), attendance);
  }

  const employees = employeeProfiles.map((employee) =>
    buildExtraShiftListRow(employee, attendanceByEmployeeId.get(employee._id.toString()))
  );

  const declarations = employees.filter((row) => row.extraDay || row.extraNight);

  return {
    date: dateKey,
    timezone: company.timezone ?? null,
    employees,
    declarations,
  };
}

module.exports = {
  declareExtraShifts,
  listExtraShiftDeclarations,
};
