const { Attendance, EmployeeProfile } = require('../models');
const { SHIFT_KEY, SHIFT_STATUS, COMPANY_ROLE } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { dateKeyToUtcDate, getCompanyTodayDateKey } = require('../utils/timezone.helper');
const { parseEmployeeIdsFromQuery } = require('../helper/employeeIdQuery.helper');
const {
  getOrCreateAttendanceForEmployeeDate,
  serializeAttendanceRecord,
  resolveShiftStatus,
} = require('./attendance.service');

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function parseListPaging(page, limit) {
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Number.parseInt(limit, 10) || DEFAULT_LIST_LIMIT)
  );
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
}

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
      shift.status = SHIFT_STATUS.AWAITING_ATTENDANCE;
      declaredKeys.push(SHIFT_KEY.EXTRA_DAY);
    }
  }

  if (wantsNight) {
    const shift = attendance.shifts.extra_night;
    if (!shift.declared) {
      shift.declared = true;
      shift.declared_by = adminUserId;
      shift.declared_at = now;
      shift.status = SHIFT_STATUS.AWAITING_ATTENDANCE;
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

function serializeDeclaredExtraShift(shift, shiftKey) {
  if (!shift?.declared) {
    return null;
  }
  return {
    declared: true,
    declaredAt: shift.declared_at ?? null,
    marked: Boolean(shift.marked),
    fulfilled: Boolean(shift.amount),
    status: resolveShiftStatus(shift, shiftKey),
  };
}

function buildExtraShiftListRow(employee, attendance) {
  const extraDay = attendance
    ? serializeDeclaredExtraShift(attendance.shifts?.extra_day, SHIFT_KEY.EXTRA_DAY)
    : null;
  const extraNight = attendance
    ? serializeDeclaredExtraShift(attendance.shifts?.extra_night, SHIFT_KEY.EXTRA_NIGHT)
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

const ACTIVE_EMPLOYEE_FILTER = (companyId) => ({
  company_id: companyId,
  is_active: true,
  user_id: { $ne: null },
});

async function loadAttendanceMapForDate(companyId, storedDate) {
  const attendanceRecords = await Attendance.find({
    company_id: companyId,
    date: storedDate,
  }).select('employee_id shifts lock_attendance');

  const attendanceByEmployeeId = new Map();
  for (const attendance of attendanceRecords) {
    attendanceByEmployeeId.set(attendance.employee_id.toString(), attendance);
  }
  return attendanceByEmployeeId;
}

/**
 * Admin view for a date (defaults to company today): paginated active employees
 * (declare UI) and paginated `declarations` for rows with extra day/night declared.
 */
async function listExtraShiftDeclarations({
  company,
  date,
  page,
  limit,
  declarationsPage,
  declarationsLimit,
  declarationsEmployeeId,
  employeeId,
}) {
  const dateKey = date ? parseDateKey(date) : getCompanyTodayDateKey(company.timezone);
  const storedDate = dateKeyToUtcDate(dateKey);
  const employeeFilter = ACTIVE_EMPLOYEE_FILTER(company._id);

  const empPaging = parseListPaging(page, limit);
  const declPaging = parseListPaging(
    declarationsPage ?? page,
    declarationsLimit ?? limit
  );

  const attendanceByEmployeeId = await loadAttendanceMapForDate(company._id, storedDate);

  const [employeeTotal, employeeProfiles] = await Promise.all([
    EmployeeProfile.countDocuments(employeeFilter),
    EmployeeProfile.find(employeeFilter)
      .select('employee_name employee_email')
      .sort({ employee_name: 1 })
      .skip(empPaging.skip)
      .limit(empPaging.limitNum),
  ]);

  const employees = employeeProfiles.map((employee) =>
    buildExtraShiftListRow(employee, attendanceByEmployeeId.get(employee._id.toString()))
  );

  const declarationAttendanceFilter = {
    company_id: company._id,
    date: storedDate,
    $or: [
      { 'shifts.extra_day.declared': true },
      { 'shifts.extra_night.declared': true },
    ],
  };

  const declAttendances = await Attendance.find(declarationAttendanceFilter)
    .select('employee_id shifts lock_attendance created_at')
    .sort({ created_at: -1 })
    .populate({
      path: 'employee_id',
      select: 'employee_name employee_email is_active user_id',
      match: { is_active: true, user_id: { $ne: null } },
    });

  let allDeclarations = declAttendances
    .filter((record) => record.employee_id)
    .map((record) => buildExtraShiftListRow(record.employee_id, record));

  const declFilterIds = parseEmployeeIdsFromQuery(declarationsEmployeeId);
  if (declFilterIds.length) {
    const idSet = new Set(declFilterIds.map((id) => String(id)));
    allDeclarations = allDeclarations.filter((row) => idSet.has(String(row.employeeId)));
  }

  const declarationsTotal = allDeclarations.length;
  const declarations = allDeclarations.slice(
    declPaging.skip,
    declPaging.skip + declPaging.limitNum
  );

  let employeeRow = null;
  if (employeeId) {
    const employee = await EmployeeProfile.findOne({
      ...employeeFilter,
      _id: employeeId,
    }).select('employee_name employee_email');
    if (employee) {
      employeeRow = buildExtraShiftListRow(
        employee,
        attendanceByEmployeeId.get(employee._id.toString())
      );
    }
  }

  return {
    date: dateKey,
    timezone: company.timezone ?? null,
    page: empPaging.pageNum,
    limit: empPaging.limitNum,
    total: employeeTotal,
    totalPages: employeeTotal === 0 ? 0 : Math.ceil(employeeTotal / empPaging.limitNum),
    employees,
    declarationsPage: declPaging.pageNum,
    declarationsLimit: declPaging.limitNum,
    declarationsTotal,
    declarationsTotalPages:
      declarationsTotal === 0 ? 0 : Math.ceil(declarationsTotal / declPaging.limitNum),
    declarations,
    ...(employeeRow ? { employeeRow } : {}),
  };
}

module.exports = {
  declareExtraShifts,
  listExtraShiftDeclarations,
};
