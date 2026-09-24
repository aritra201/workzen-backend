const {
  Attendance,
  CommentThread,
  EmployeeProfile,
  Company,
} = require('../models');
const {
  SHIFT_KEY,
  SHIFT_STATUS,
  COMPANY_ROLE,
} = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { resolveDateRangeFilter } = require('../helper/dateRangeFilter.helper');
const { parseObjectId } = require('../utils/objectId.helper');
const {
  getCompanyTodayDateKey,
  utcDateToDateKey,
} = require('../utils/timezone.helper');
const {
  assertEmployeeShiftKey,
  isExtraShiftKey,
  serializeAttendanceRecord,
  serializeRegularShift,
  serializeExtraShift,
} = require('./attendance.service');

const SHIFT_KEYS = Object.values(SHIFT_KEY);
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_DAYS = 30;
const MAX_REPLY_LENGTH = 4000;

function parseStatusFilter(status) {
  if (status === undefined || status === null || status === '') {
    return null;
  }
  const value = String(status).trim().toLowerCase();
  if (!Object.values(SHIFT_STATUS).includes(value)) {
    throw new AppError(
      `status must be one of: ${Object.values(SHIFT_STATUS).join(', ')}`,
      400
    );
  }
  return value;
}

function shiftIsVisibleToCompany(shift, shiftKey) {
  if (isExtraShiftKey(shiftKey)) {
    return Boolean(shift?.declared);
  }
  return Boolean(shift?.marked);
}

function shiftMatchesStatusFilter(shift, shiftKey, statusFilter) {
  if (!statusFilter) {
    return true;
  }
  if (!shiftIsVisibleToCompany(shift, shiftKey)) {
    return false;
  }
  const status = shift?.status || SHIFT_STATUS.PENDING_VERIFICATION;
  return status === statusFilter;
}

function attendanceMatchesStatusFilter(attendance, statusFilter) {
  if (!statusFilter) {
    return true;
  }
  return SHIFT_KEYS.some((key) =>
    shiftMatchesStatusFilter(attendance.shifts[key], key, statusFilter)
  );
}

function validateReplyText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new AppError('text is required', 400);
  }
  const trimmed = text.trim();
  if (trimmed.length > MAX_REPLY_LENGTH) {
    throw new AppError(`text must be at most ${MAX_REPLY_LENGTH} characters`, 400);
  }
  return trimmed;
}

function serializeThreadMessage(message) {
  return {
    id: message._id,
    authorId: message.author_id,
    authorRole: message.author_role,
    text: message.text,
    createdAt: message.created_at,
  };
}

function serializeCommentThread(thread) {
  if (!thread) {
    return null;
  }
  return {
    id: thread._id,
    shiftKey: thread.shift_key,
    messages: (thread.messages || []).map(serializeThreadMessage),
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
  };
}

function serializeAdminRegularShift(shift, shiftKey) {
  if (!shift?.marked) {
    return null;
  }
  return {
    shiftKey,
    marked: true,
    amount: shift.amount ?? null,
    comment: shift.comment ?? null,
    workPictures: shift.work_picture ?? [],
    geoLocation: shift.geo_location ?? null,
    status: shift.status,
    verifiedBy: shift.verified_by ?? null,
    verifiedAt: shift.verified_at ?? null,
  };
}

function serializeAdminExtraShift(shift, shiftKey) {
  if (!shift?.declared) {
    return null;
  }
  return {
    shiftKey,
    declared: true,
    declaredBy: shift.declared_by ?? null,
    declaredAt: shift.declared_at ?? null,
    marked: Boolean(shift.marked),
    amount: shift.amount ?? null,
    comment: shift.comment ?? null,
    workPictures: shift.work_picture ?? [],
    geoLocation: shift.geo_location ?? null,
    status: shift.status,
    verifiedBy: shift.verified_by ?? null,
    verifiedAt: shift.verified_at ?? null,
  };
}

function summarizeShiftForList(shift, shiftKey) {
  if (!shiftIsVisibleToCompany(shift, shiftKey)) {
    return null;
  }
  const base = {
    shiftKey,
    status: shift?.status || SHIFT_STATUS.PENDING_VERIFICATION,
    marked: Boolean(shift?.marked),
  };
  if (isExtraShiftKey(shiftKey)) {
    return { ...base, declared: true };
  }
  return base;
}

function shiftKeyToResponseKey(shiftKey) {
  if (shiftKey === SHIFT_KEY.EXTRA_DAY) {
    return 'extraDay';
  }
  if (shiftKey === SHIFT_KEY.EXTRA_NIGHT) {
    return 'extraNight';
  }
  return shiftKey;
}

function serializeEmployeeShift(attendance, shiftKey) {
  if (!shiftIsVisibleToCompany(attendance.shifts[shiftKey], shiftKey)) {
    return null;
  }
  const body = isExtraShiftKey(shiftKey)
    ? serializeExtraShift(attendance.shifts[shiftKey])
    : serializeRegularShift(attendance.shifts[shiftKey]);
  if (!body) {
    return null;
  }
  return { shiftKey, ...body };
}

function employeeShiftsWithKeys(attendance) {
  return {
    day: serializeEmployeeShift(attendance, SHIFT_KEY.DAY),
    night: serializeEmployeeShift(attendance, SHIFT_KEY.NIGHT),
    extraDay: serializeEmployeeShift(attendance, SHIFT_KEY.EXTRA_DAY),
    extraNight: serializeEmployeeShift(attendance, SHIFT_KEY.EXTRA_NIGHT),
  };
}

function serializeAdminShift(attendance, shiftKey) {
  const shift = attendance.shifts[shiftKey];
  if (isExtraShiftKey(shiftKey)) {
    return serializeAdminExtraShift(shift, shiftKey);
  }
  return serializeAdminRegularShift(shift, shiftKey);
}

async function resolveCommentThreadForShift(attendance, shiftKey, threadMap) {
  let thread = threadMap.get(shiftKey);
  if (
    attendance.shifts[shiftKey]?.comment &&
    (!thread || thread.messages.length === 0)
  ) {
    try {
      thread = await ensureCommentThreadBootstrapped(attendance, shiftKey);
      threadMap.set(shiftKey, thread);
    } catch {
      // shift has no comment to bootstrap
    }
  }
  return serializeCommentThread(thread);
}

function companyAttendanceBasePayload(attendance, dateKey, timezone, employee) {
  return {
    attendanceId: attendance._id,
    date: dateKey,
    timezone,
    lockAttendance: attendance.lock_attendance,
    unlockedViaRequestId: attendance.unlocked_via_request_id || null,
    unlockExpiresAt: attendance.unlock_expires_at || null,
    employee: {
      employeeId: employee._id,
      name: employee.employee_name,
      email: employee.employee_email,
      isActive: employee.is_active,
    },
    createdAt: attendance.created_at,
    updatedAt: attendance.updated_at,
  };
}

function serializeListItem(attendance, employee, timezone) {
  const dateKey = utcDateToDateKey(attendance.date);
  return {
    attendanceId: attendance._id,
    date: dateKey,
    lockAttendance: attendance.lock_attendance,
    unlockExpiresAt: attendance.unlock_expires_at || null,
    employee: employee
      ? {
          employeeId: employee._id,
          name: employee.employee_name,
          email: employee.employee_email,
          isActive: employee.is_active,
        }
      : { employeeId: attendance.employee_id },
    shifts: {
      day: summarizeShiftForList(attendance.shifts.day, SHIFT_KEY.DAY),
      night: summarizeShiftForList(attendance.shifts.night, SHIFT_KEY.NIGHT),
      extraDay: summarizeShiftForList(attendance.shifts.extra_day, SHIFT_KEY.EXTRA_DAY),
      extraNight: summarizeShiftForList(attendance.shifts.extra_night, SHIFT_KEY.EXTRA_NIGHT),
    },
    updatedAt: attendance.updated_at,
  };
}

async function loadCompanyAttendance(companyId, attendanceId) {
  const id = parseObjectId(attendanceId, 'attendanceId');
  const attendance = await Attendance.findOne({
    _id: id,
    company_id: companyId,
  });
  if (!attendance) {
    throw new AppError('Attendance record not found', 404);
  }
  return attendance;
}

async function loadEmployeeForCompany(companyId, employeeId) {
  if (!employeeId) {
    return null;
  }
  const id = parseObjectId(employeeId, 'employeeId');
  const employee = await EmployeeProfile.findOne({
    _id: id,
    company_id: companyId,
  });
  if (!employee) {
    throw new AppError('Employee not found in this company', 404);
  }
  return employee;
}

function assertShiftReviewable(shift, shiftKey) {
  assertEmployeeShiftKey(shiftKey);
  if (isExtraShiftKey(shiftKey)) {
    if (!shift?.declared) {
      throw new AppError('Extra shift is not declared', 400);
    }
  }
  if (!shift?.marked) {
    throw new AppError('Shift is not confirmed', 400);
  }
  if (shift.amount == null || !shift.comment) {
    throw new AppError('Shift has not been submitted for verification', 400);
  }
}

async function resolveEmployeeAuthorUserId(employeeProfileId) {
  const employee = await EmployeeProfile.findById(employeeProfileId).select('user_id');
  if (!employee?.user_id) {
    throw new AppError('Employee account is not linked — cannot use comment thread', 400);
  }
  return employee.user_id;
}

/**
 * Ensures thread exists with message 0 mirroring the employee shift comment (FR-073).
 */
async function ensureCommentThreadBootstrapped(attendance, shiftKey) {
  const shift = attendance.shifts[shiftKey];
  const commentText = typeof shift?.comment === 'string' ? shift.comment.trim() : '';
  if (!commentText) {
    throw new AppError('Shift has no employee comment to thread', 400);
  }

  const employeeUserId = await resolveEmployeeAuthorUserId(attendance.employee_id);

  let thread = await CommentThread.findOne({
    attendance_id: attendance._id,
    shift_key: shiftKey,
  });

  if (!thread) {
    thread = await CommentThread.create({
      attendance_id: attendance._id,
      shift_key: shiftKey,
      messages: [
        {
          author_id: employeeUserId,
          author_role: COMPANY_ROLE.EMPLOYEE,
          text: commentText,
        },
      ],
    });
    return thread;
  }

  if (thread.messages.length === 0) {
    thread.messages.push({
      author_id: employeeUserId,
      author_role: COMPANY_ROLE.EMPLOYEE,
      text: commentText,
    });
    await thread.save();
  }

  return thread;
}

async function listCompanyAttendance(
  company,
  { employeeId, startDate, endDate, status, page, limit }
) {
  const timezone = company.timezone || 'Asia/Kolkata';
  const todayKey = getCompanyTodayDateKey(timezone);
  const statusFilter = parseStatusFilter(status);

  const { startDate: startDateKey, endDate: endDateKey, dateRange } = resolveDateRangeFilter({
    startDate,
    endDate,
    timezone,
    todayKey,
    defaultWindowDays: DEFAULT_LIST_DAYS,
  });

  const employee = await loadEmployeeForCompany(company._id, employeeId);

  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Number.parseInt(limit, 10) || DEFAULT_LIST_LIMIT)
  );

  const filter = {
    company_id: company._id,
    date: dateRange,
  };
  if (employee) {
    filter.employee_id = employee._id;
  }

  const query = Attendance.find(filter).sort({ date: -1, _id: -1 });
  let records = await query.lean();

  if (statusFilter) {
    records = records.filter((doc) => attendanceMatchesStatusFilter(doc, statusFilter));
  }

  const total = records.length;
  const skip = (pageNum - 1) * limitNum;
  const pageRecords = records.slice(skip, skip + limitNum);

  const employeeIds = [...new Set(pageRecords.map((r) => String(r.employee_id)))];
  const employees = await EmployeeProfile.find({ _id: { $in: employeeIds } }).lean();
  const employeeMap = new Map(employees.map((e) => [String(e._id), e]));

  return {
    timezone,
    startDate: startDateKey,
    endDate: endDateKey,
    status: statusFilter,
    employeeId: employee ? employee._id : null,
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limitNum),
    items: pageRecords.map((attendance) =>
      serializeListItem(
        attendance,
        employeeMap.get(String(attendance.employee_id)),
        timezone
      )
    ),
  };
}

async function loadThreadsForAttendance(attendanceId) {
  const threads = await CommentThread.find({ attendance_id: attendanceId });
  const byShift = new Map(threads.map((t) => [t.shift_key, t]));
  return byShift;
}

async function getCompanyAttendanceDetail(company, attendanceId, { shiftKey } = {}) {
  const attendance = await loadCompanyAttendance(company._id, attendanceId);
  const timezone = company.timezone || 'Asia/Kolkata';
  const dateKey = utcDateToDateKey(attendance.date);

  const employee = await EmployeeProfile.findById(attendance.employee_id).lean();
  if (!employee || String(employee.company_id) !== String(company._id)) {
    throw new AppError('Attendance record not found', 404);
  }

  if (shiftKey) {
    assertEmployeeShiftKey(shiftKey);
  }

  const base = companyAttendanceBasePayload(attendance, dateKey, timezone, employee);
  const threadMap = await loadThreadsForAttendance(attendance._id);

  if (shiftKey) {
    const hasShift = shiftIsVisibleToCompany(attendance.shifts[shiftKey], shiftKey);
    return {
      ...base,
      shiftKey,
      shift: hasShift ? serializeAdminShift(attendance, shiftKey) : null,
      commentThread: hasShift
        ? await resolveCommentThreadForShift(attendance, shiftKey, threadMap)
        : null,
    };
  }

  const shiftsPayload = {
    day: null,
    night: null,
    extraDay: null,
    extraNight: null,
  };
  const commentThreads = {
    day: null,
    night: null,
    extraDay: null,
    extraNight: null,
  };

  for (const key of SHIFT_KEYS) {
    if (!shiftIsVisibleToCompany(attendance.shifts[key], key)) {
      continue;
    }
    const responseKey = shiftKeyToResponseKey(key);
    shiftsPayload[responseKey] = serializeAdminShift(attendance, key);
    commentThreads[responseKey] = await resolveCommentThreadForShift(
      attendance,
      key,
      threadMap
    );
  }

  return {
    ...base,
    shifts: shiftsPayload,
    commentThreads,
  };
}

async function verifyAttendanceShift({
  company,
  adminUserId,
  attendanceId,
  shiftKey,
}) {
  assertEmployeeShiftKey(shiftKey);
  const attendance = await loadCompanyAttendance(company._id, attendanceId);
  const shift = attendance.shifts[shiftKey];
  assertShiftReviewable(shift, shiftKey);

  if (shift.status === SHIFT_STATUS.VERIFIED) {
    return getCompanyAttendanceDetail(company, attendanceId, { shiftKey });
  }
  if (shift.status === SHIFT_STATUS.REJECTED) {
    throw new AppError('Rejected shifts cannot be verified', 400);
  }

  const before = {
    status: shift.status,
    verified_by: shift.verified_by,
    verified_at: shift.verified_at,
  };

  shift.status = SHIFT_STATUS.VERIFIED;
  shift.verified_by = adminUserId;
  shift.verified_at = new Date();

  if (attendance.lock_attendance) {
    attendance.$locals.allowLockedEdit = true;
  }
  attendance.markModified(`shifts.${shiftKey}`);
  await attendance.save();

  await writeActivityLog({
    companyId: company._id,
    actorUserId: adminUserId,
    actorRole: COMPANY_ROLE.ADMIN,
    actionType: 'attendance.verified',
    targetType: 'Attendance',
    targetId: attendance._id,
    beforeValue: before,
    afterValue: {
      status: shift.status,
      verified_by: shift.verified_by,
      verified_at: shift.verified_at,
    },
    metadata: {
      date: utcDateToDateKey(attendance.date),
      shift_key: shiftKey,
    },
  });

  return getCompanyAttendanceDetail(company, attendanceId, { shiftKey });
}

async function addAdminCommentThreadReply({
  company,
  adminUserId,
  attendanceId,
  shiftKey,
  text,
}) {
  assertEmployeeShiftKey(shiftKey);
  const attendance = await loadCompanyAttendance(company._id, attendanceId);
  const shift = attendance.shifts[shiftKey];
  assertShiftReviewable(shift, shiftKey);

  const replyText = validateReplyText(text);
  const thread = await ensureCommentThreadBootstrapped(attendance, shiftKey);

  thread.messages.push({
    author_id: adminUserId,
    author_role: COMPANY_ROLE.ADMIN,
    text: replyText,
  });
  await thread.save();

  await writeActivityLog({
    companyId: company._id,
    actorUserId: adminUserId,
    actorRole: COMPANY_ROLE.ADMIN,
    actionType: 'comment_thread.reply',
    targetType: 'CommentThread',
    targetId: thread._id,
    afterValue: { text: replyText, author_role: COMPANY_ROLE.ADMIN },
    metadata: {
      attendance_id: attendance._id,
      date: utcDateToDateKey(attendance.date),
      shift_key: shiftKey,
    },
  });

  return getCompanyAttendanceDetail(company, attendanceId, { shiftKey });
}

async function getEmployeeAttendanceDetail(employeeProfile, attendanceId, { shiftKey } = {}) {
  const id = parseObjectId(attendanceId, 'attendanceId');
  const attendance = await Attendance.findOne({
    _id: id,
    employee_id: employeeProfile._id,
    company_id: employeeProfile.company_id,
  });
  if (!attendance) {
    throw new AppError('Attendance record not found', 404);
  }

  const company = await Company.findById(employeeProfile.company_id);
  const timezone = company?.timezone || 'Asia/Kolkata';
  const dateKey = utcDateToDateKey(attendance.date);

  if (shiftKey) {
    assertEmployeeShiftKey(shiftKey);
  }

  const record = serializeAttendanceRecord(attendance, dateKey, timezone);
  const { shifts: _shifts, ...base } = record;

  const threadMap = await loadThreadsForAttendance(attendance._id);

  if (shiftKey) {
    const hasShift = shiftIsVisibleToCompany(attendance.shifts[shiftKey], shiftKey);
    return {
      ...base,
      shiftKey,
      shift: hasShift ? serializeEmployeeShift(attendance, shiftKey) : null,
      commentThread: hasShift
        ? await resolveCommentThreadForShift(attendance, shiftKey, threadMap)
        : null,
    };
  }

  const commentThreads = {
    day: null,
    night: null,
    extraDay: null,
    extraNight: null,
  };

  for (const key of SHIFT_KEYS) {
    if (!shiftIsVisibleToCompany(attendance.shifts[key], key)) {
      continue;
    }
    const responseKey = shiftKeyToResponseKey(key);
    commentThreads[responseKey] = await resolveCommentThreadForShift(
      attendance,
      key,
      threadMap
    );
  }

  return {
    ...base,
    shifts: employeeShiftsWithKeys(attendance),
    commentThreads,
  };
}

async function addEmployeeCommentThreadReply({
  employeeProfile,
  attendanceId,
  shiftKey,
  text,
}) {
  assertEmployeeShiftKey(shiftKey);
  const replyText = validateReplyText(text);

  const id = parseObjectId(attendanceId, 'attendanceId');
  const attendance = await Attendance.findOne({
    _id: id,
    employee_id: employeeProfile._id,
    company_id: employeeProfile.company_id,
  });
  if (!attendance) {
    throw new AppError('Attendance record not found', 404);
  }

  const shift = attendance.shifts[shiftKey];
  assertShiftReviewable(shift, shiftKey);

  if (!employeeProfile.user_id) {
    throw new AppError('Employee account is not linked', 400);
  }

  const thread = await ensureCommentThreadBootstrapped(attendance, shiftKey);

  thread.messages.push({
    author_id: employeeProfile.user_id,
    author_role: COMPANY_ROLE.EMPLOYEE,
    text: replyText,
  });
  await thread.save();

  await writeActivityLog({
    companyId: employeeProfile.company_id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType: 'comment_thread.reply',
    targetType: 'CommentThread',
    targetId: thread._id,
    afterValue: { text: replyText, author_role: COMPANY_ROLE.EMPLOYEE },
    metadata: {
      attendance_id: attendance._id,
      date: utcDateToDateKey(attendance.date),
      shift_key: shiftKey,
    },
  });

  return serializeCommentThread(thread);
}

module.exports = {
  listCompanyAttendance,
  getCompanyAttendanceDetail,
  verifyAttendanceShift,
  addAdminCommentThreadReply,
  getEmployeeAttendanceDetail,
  addEmployeeCommentThreadReply,
};
