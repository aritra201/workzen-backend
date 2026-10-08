const { Attendance, EmployeeProfile } = require('../models');
const { SHIFT_KEY } = require('../utils/enums');
const { resolveDateRangeFilter } = require('../helper/dateRangeFilter.helper');
const { parseEmployeeIdsFromQuery } = require('../helper/employeeIdQuery.helper');
const {
  FIXED_SHIFT_KEYS,
  listMarkedHalfShiftEntries,
  parseHalfShiftSlot,
} = require('../helper/employeeShiftKeys.helper');
const {
  getCompanyTodayDateKey,
  utcDateToDateKey,
} = require('../utils/timezone.helper');
const { AppError } = require('../utils/AppError');

const DEFAULT_LIST_DAYS = 30;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

const SHIFT_PAYROLL_LABELS = {
  [SHIFT_KEY.DAY]: 'Day',
  [SHIFT_KEY.NIGHT]: 'Night',
  [SHIFT_KEY.EXTRA_DAY]: 'Extra Day',
  [SHIFT_KEY.EXTRA_NIGHT]: 'Extra Night',
};

function shiftKeyToPayrollLabel(shiftKey, slot) {
  if (slot != null) {
    return `Half ${slot}`;
  }
  if (SHIFT_PAYROLL_LABELS[shiftKey]) {
    return SHIFT_PAYROLL_LABELS[shiftKey];
  }
  const halfSlot = parseHalfShiftSlot(shiftKey);
  if (halfSlot) {
    return `Half ${halfSlot}`;
  }
  return shiftKey;
}

async function loadEmployeesForCompanyFilter(companyId, employeeIdRaw) {
  const ids = parseEmployeeIdsFromQuery(employeeIdRaw);
  if (!ids.length) {
    return { employees: [], filter: null };
  }

  const employees = await EmployeeProfile.find({
    _id: { $in: ids },
    company_id: companyId,
  });

  if (employees.length !== ids.length) {
    throw new AppError('One or more employees were not found in this company', 404);
  }

  const filter =
    ids.length === 1 ? { employee_id: ids[0] } : { employee_id: { $in: ids } };

  return { employees, filter };
}

function attendanceHasMarkedShift(attendance) {
  const shifts = attendance.shifts || {};
  for (const key of FIXED_SHIFT_KEYS) {
    if (shifts[key]?.marked) {
      return true;
    }
  }
  return (shifts.half_shifts || []).some((half) => Boolean(half?.marked));
}

function collectMarkedPayrollShifts(attendance) {
  const lines = [];
  const shifts = attendance.shifts || {};

  for (const key of FIXED_SHIFT_KEYS) {
    const shift = shifts[key];
    if (!shift?.marked) {
      continue;
    }
    const amount =
      shift.amount != null && !Number.isNaN(Number(shift.amount))
        ? Number(shift.amount)
        : null;
    lines.push({
      shiftKey: key,
      shiftLabel: shiftKeyToPayrollLabel(key),
      amount,
    });
  }

  for (const { slot, shiftKey, shift } of listMarkedHalfShiftEntries(attendance)) {
    const amount =
      shift.amount != null && !Number.isNaN(Number(shift.amount))
        ? Number(shift.amount)
        : null;
    lines.push({
      shiftKey,
      shiftLabel: shiftKeyToPayrollLabel(shiftKey, slot),
      amount,
    });
  }

  return lines;
}

function sumPayrollLineAmounts(lines) {
  let total = 0;
  let hasAmount = false;
  for (const line of lines) {
    if (line.amount != null) {
      total += line.amount;
      hasAmount = true;
    }
  }
  return hasAmount ? total : null;
}

function serializePayrollListItem(attendance, employee) {
  const dateKey = utcDateToDateKey(attendance.date);
  const shiftLines = collectMarkedPayrollShifts(attendance);
  const dayTotal = sumPayrollLineAmounts(shiftLines);

  return {
    attendanceId: attendance._id,
    date: dateKey,
    employee: employee
      ? {
          employeeId: employee._id,
          name: employee.employee_name,
          email: employee.employee_email,
          profilePicture: employee.employee_profile_picture ?? null,
          isActive: employee.is_active,
        }
      : { employeeId: attendance.employee_id },
    shifts: shiftLines,
    dayTotal,
    updatedAt: attendance.updated_at,
  };
}

function computePayrollSummary(items) {
  let grandTotal = 0;
  let hasGrandTotal = false;
  let markedShiftCount = 0;

  for (const item of items) {
    for (const line of item.shifts) {
      markedShiftCount += 1;
      if (line.amount != null) {
        grandTotal += line.amount;
        hasGrandTotal = true;
      }
    }
  }

  return {
    recordCount: items.length,
    markedShiftCount,
    grandTotal: hasGrandTotal ? grandTotal : null,
  };
}

/**
 * Payroll roll-up: only attendance days with at least one confirmed (marked) shift.
 */
async function listPayroll(company, { employeeId, startDate, endDate, page, limit }) {
  const timezone = company.timezone || 'Asia/Kolkata';
  const todayKey = getCompanyTodayDateKey(timezone);

  const { startDate: startDateKey, endDate: endDateKey, dateRange } = resolveDateRangeFilter({
    startDate,
    endDate,
    timezone,
    todayKey,
    defaultWindowDays: DEFAULT_LIST_DAYS,
  });

  const { employees: filterEmployees, filter: employeeFilter } =
    await loadEmployeesForCompanyFilter(company._id, employeeId);

  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Number.parseInt(limit, 10) || DEFAULT_LIST_LIMIT)
  );

  const filter = {
    company_id: company._id,
    date: dateRange,
    ...(employeeFilter || {}),
  };

  let records = await Attendance.find(filter).sort({ date: -1, created_at: -1, _id: -1 }).lean();

  records = records.filter((doc) => attendanceHasMarkedShift(doc));

  records.sort((a, b) => {
    const dateDiff = new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return String(b._id).localeCompare(String(a._id));
  });

  const employeeIds = [...new Set(records.map((r) => String(r.employee_id)))];
  const employees = await EmployeeProfile.find({ _id: { $in: employeeIds } }).lean();
  const employeeMap = new Map(employees.map((e) => [String(e._id), e]));

  const allItems = records.map((attendance) =>
    serializePayrollListItem(attendance, employeeMap.get(String(attendance.employee_id)))
  );

  const summary = computePayrollSummary(allItems);

  const total = allItems.length;
  const skip = (pageNum - 1) * limitNum;
  const items = allItems.slice(skip, skip + limitNum);

  return {
    timezone,
    startDate: startDateKey,
    endDate: endDateKey,
    employeeId: filterEmployees.length ? filterEmployees.map((e) => e._id) : null,
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limitNum),
    summary,
    items,
  };
}

module.exports = {
  listPayroll,
  collectMarkedPayrollShifts,
  attendanceHasMarkedShift,
};
