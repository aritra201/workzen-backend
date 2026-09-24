const { Attendance, UnlockRequest, EmployeeProfile, Company, User } = require('../models');
const { COMPANY_ROLE, UNLOCK_REQUEST_STATUS } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { writeActivityLog } = require('../helper/activityLog.helper');
const {
  sendUnlockRequestSubmittedEmail,
  sendUnlockRequestApprovedEmail,
  sendUnlockRequestDeniedEmail,
} = require('../helper/email.helper');
const { resolveDateRangeFilter } = require('../helper/dateRangeFilter.helper');
const { parseObjectId } = require('../utils/objectId.helper');
const {
  getCompanyTodayDateKey,
  utcDateToDateKey,
} = require('../utils/timezone.helper');
const { computeUnlockExpiresAt, isUnlockWindowActive } = require('../helper/unlockWindow.helper');

const MAX_REASON_LENGTH = 1000;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_DAYS = 30;

function parseOptionalDecisionNote(decisionNote) {
  if (decisionNote === undefined || decisionNote === null || decisionNote === '') {
    return null;
  }
  if (typeof decisionNote !== 'string') {
    throw new AppError('decisionNote must be a string', 400);
  }
  const trimmed = decisionNote.trim();
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new AppError(`decisionNote must be at most ${MAX_REASON_LENGTH} characters`, 400);
  }
  return trimmed || null;
}

function serializeUnlockRequest(request, timezone) {
  const employee = request.employee_id;
  const employeePopulated = employee && typeof employee === 'object' && employee.employee_name;

  return {
    id: request._id,
    companyId: request.company_id,
    employeeId: employeePopulated ? employee._id : request.employee_id,
    employeeName: employeePopulated ? employee.employee_name : undefined,
    employeeEmail: employeePopulated ? employee.employee_email : undefined,
    date: utcDateToDateKey(request.requested_date),
    attendanceId: request.attendance_id,
    timezone: timezone || null,
    status: request.status,
    decisionNote: request.decision_note || null,
    decidedBy: request.decided_by || null,
    decidedAt: request.decided_at || null,
    unlockExpiresAt: request.unlock_expires_at || null,
    unlockWindowActive: isUnlockWindowActive(request.unlock_expires_at),
    createdAt: request.created_at,
  };
}

function parseListPaging(page, limit) {
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Number.parseInt(limit, 10) || DEFAULT_LIST_LIMIT)
  );
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
}

async function notifyAdminOfUnlockRequest({ company, employeeProfile, dateKey }) {
  try {
    const adminUser = await User.findById(company.admin_user_id).select('email');
    const to = adminUser?.email || company.personal_email_id;
    if (!to) {
      return;
    }

    await sendUnlockRequestSubmittedEmail({
      to,
      adminName: company.owner_name,
      employeeName: employeeProfile.employee_name,
      employeeEmail: employeeProfile.employee_email,
      dateKey,
      companyName: company.company_name,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[unlock-request] admin notification email failed:', err?.message || err);
  }
}

async function notifyUnlockDecision({ employee, dateKey, status, decisionNote, unlockExpiresAt }) {
  if (!employee?.employee_email) {
    return;
  }
  try {
    if (status === UNLOCK_REQUEST_STATUS.APPROVED) {
      await sendUnlockRequestApprovedEmail({
        to: employee.employee_email,
        employeeName: employee.employee_name,
        dateKey,
        decisionNote,
        expiresAt: unlockExpiresAt,
      });
      return;
    }
    await sendUnlockRequestDeniedEmail({
      to: employee.employee_email,
      employeeName: employee.employee_name,
      dateKey,
      decisionNote,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[unlock-request] notification email failed:', err?.message || err);
  }
}

/**
 * Employee requests unlock for a locked attendance row they already see in their list.
 */
async function createUnlockRequest({ employeeProfile, attendanceId }) {
  const company = await Company.findById(employeeProfile.company_id);
  if (!company) {
    throw new AppError('Company not found for employee', 500);
  }

  const parsedAttendanceId = parseObjectId(attendanceId, 'attendanceId');
  const attendance = await Attendance.findOne({
    _id: parsedAttendanceId,
    employee_id: employeeProfile._id,
    company_id: company._id,
  });

  if (!attendance) {
    throw new AppError('Attendance not found', 404);
  }

  const timezone = company.timezone;
  const todayKey = getCompanyTodayDateKey(timezone);
  const dateKey = utcDateToDateKey(attendance.date);

  if (dateKey > todayKey) {
    throw new AppError('Cannot request unlock for a future date', 400);
  }

  if (!attendance.lock_attendance && dateKey === todayKey) {
    throw new AppError('Today\'s attendance is still editable — unlock is not needed', 400);
  }

  if (!attendance.lock_attendance && isUnlockWindowActive(attendance.unlock_expires_at)) {
    throw new AppError('This attendance is already unlocked — mark it before the window expires', 409);
  }

  const pending = await UnlockRequest.findOne({
    employee_id: employeeProfile._id,
    company_id: company._id,
    attendance_id: attendance._id,
    status: UNLOCK_REQUEST_STATUS.PENDING,
  });
  if (pending) {
    throw new AppError('A pending unlock request already exists for this attendance', 409);
  }

  const request = await UnlockRequest.create({
    company_id: company._id,
    employee_id: employeeProfile._id,
    attendance_id: attendance._id,
    requested_date: attendance.date,
    status: UNLOCK_REQUEST_STATUS.PENDING,
  }).catch((err) => {
    if (err?.code === 11000) {
      throw new AppError('A pending unlock request already exists for this attendance', 409);
    }
    throw err;
  });

  await writeActivityLog({
    companyId: company._id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType: 'unlock_request.submitted',
    targetType: 'UnlockRequest',
    targetId: request._id,
    metadata: { date: dateKey, attendance_id: attendance._id },
  });

  await notifyAdminOfUnlockRequest({ company, employeeProfile, dateKey });

  return serializeUnlockRequest(request, timezone);
}

async function listMyUnlockRequests(employeeProfile, { status, startDate, endDate, page, limit }) {
  const company = await Company.findById(employeeProfile.company_id);
  if (!company) {
    throw new AppError('Company not found for employee', 500);
  }

  const timezone = company.timezone;
  const todayKey = getCompanyTodayDateKey(timezone);
  const { startDate: startDateKey, endDate: endDateKey, dateRange } = resolveDateRangeFilter({
    startDate,
    endDate,
    timezone,
    todayKey,
    defaultWindowDays: DEFAULT_LIST_DAYS,
  });

  const filter = {
    employee_id: employeeProfile._id,
    company_id: company._id,
    requested_date: dateRange,
  };

  if (status) {
    if (!Object.values(UNLOCK_REQUEST_STATUS).includes(status)) {
      throw new AppError('status must be pending, approved, or denied', 400);
    }
    filter.status = status;
  }

  const { pageNum, limitNum, skip } = parseListPaging(page, limit);
  const [total, records] = await Promise.all([
    UnlockRequest.countDocuments(filter),
    UnlockRequest.find(filter).sort({ created_at: -1 }).skip(skip).limit(limitNum),
  ]);

  return {
    timezone,
    startDate: startDateKey,
    endDate: endDateKey,
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limitNum),
    requests: records.map((request) => serializeUnlockRequest(request, timezone)),
  };
}

async function cancelMyUnlockRequest(employeeProfile, requestId) {
  const id = parseObjectId(requestId, 'requestId');
  const request = await UnlockRequest.findOne({
    _id: id,
    employee_id: employeeProfile._id,
    company_id: employeeProfile.company_id,
  });
  if (!request) {
    throw new AppError('Unlock request not found', 404);
  }
  if (request.status !== UNLOCK_REQUEST_STATUS.PENDING) {
    throw new AppError('Only pending unlock requests can be cancelled', 409);
  }

  await request.deleteOne();

  await writeActivityLog({
    companyId: employeeProfile.company_id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType: 'unlock_request.cancelled',
    targetType: 'UnlockRequest',
    targetId: request._id,
    metadata: { date: utcDateToDateKey(request.requested_date) },
  });

  return { message: 'Unlock request cancelled' };
}

/**
 * FR-061: admin pending (default) / filtered list.
 */
async function listUnlockRequestsForAdmin(company, { status, employeeId, startDate, endDate, page, limit }) {
  const timezone = company.timezone;
  const todayKey = getCompanyTodayDateKey(timezone);

  const filter = {
    company_id: company._id,
  };

  let startDateKey = null;
  let endDateKey = null;
  if (startDate || endDate) {
    const resolved = resolveDateRangeFilter({
      startDate,
      endDate,
      timezone,
      todayKey,
      defaultWindowDays: DEFAULT_LIST_DAYS,
      allowFuture: false,
    });
    startDateKey = resolved.startDate;
    endDateKey = resolved.endDate;
    filter.requested_date = resolved.dateRange;
  }

  const statusFilter = status || UNLOCK_REQUEST_STATUS.PENDING;
  if (statusFilter !== 'all') {
    if (!Object.values(UNLOCK_REQUEST_STATUS).includes(statusFilter)) {
      throw new AppError('status must be pending, approved, denied, or all', 400);
    }
    filter.status = statusFilter;
  }

  if (employeeId) {
    const parsedEmployeeId = parseObjectId(employeeId, 'employeeId');
    const employee = await EmployeeProfile.findOne({
      _id: parsedEmployeeId,
      company_id: company._id,
    }).select('_id');
    if (!employee) {
      throw new AppError('Employee not found in your company', 404);
    }
    filter.employee_id = employee._id;
  }

  const { pageNum, limitNum, skip } = parseListPaging(page, limit);
  const [total, records] = await Promise.all([
    UnlockRequest.countDocuments(filter),
    UnlockRequest.find(filter)
      .populate('employee_id', 'employee_name employee_email')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limitNum),
  ]);

  return {
    timezone,
    status: statusFilter,
    startDate: startDateKey,
    endDate: endDateKey,
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limitNum),
    requests: records.map((request) => serializeUnlockRequest(request, timezone)),
  };
}

async function decideUnlockRequest({ company, adminUserId, attendanceId, status, decisionNote }) {
  const parsedAttendanceId = parseObjectId(attendanceId, 'attendanceId');
  const note = parseOptionalDecisionNote(decisionNote);

  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  const approve = normalized === 'approved' || normalized === 'approve';
  const deny = normalized === 'denied' || normalized === 'deny';
  if (!approve && !deny) {
    throw new AppError('status must be approved or denied', 400);
  }

  const attendance = await Attendance.findOne({
    _id: parsedAttendanceId,
    company_id: company._id,
  });
  if (!attendance) {
    throw new AppError('Attendance not found in your company', 404);
  }

  const nextStatus = approve ? UNLOCK_REQUEST_STATUS.APPROVED : UNLOCK_REQUEST_STATUS.DENIED;
  const now = new Date();
  const unlockExpiresAt = approve ? computeUnlockExpiresAt(now) : null;

  const request = await UnlockRequest.findOneAndUpdate(
    {
      attendance_id: attendance._id,
      company_id: company._id,
      status: UNLOCK_REQUEST_STATUS.PENDING,
    },
    {
      $set: {
        status: nextStatus,
        decided_by: adminUserId,
        decided_at: now,
        decision_note: note,
        unlock_expires_at: unlockExpiresAt,
      },
    },
    { new: true }
  ).populate('employee_id');

  if (!request) {
    const existing = await UnlockRequest.findOne({
      attendance_id: attendance._id,
      company_id: company._id,
    }).sort({ created_at: -1 });
    if (!existing) {
      throw new AppError('No pending unlock request found for this attendance', 404);
    }
    throw new AppError('This unlock request has already been decided', 409);
  }

  const employee = request.employee_id;
  if (!employee || !employee._id) {
    throw new AppError('Employee record is missing for this unlock request', 404);
  }
  const dateKey = utcDateToDateKey(request.requested_date);

  if (approve) {
    attendance.lock_attendance = false;
    attendance.unlocked_via_request_id = request._id;
    attendance.unlock_expires_at = unlockExpiresAt;
    attendance.$locals.allowLockedEdit = true;
    await attendance.save();
  }

  await writeActivityLog({
    companyId: company._id,
    actorUserId: adminUserId,
    actorRole: COMPANY_ROLE.ADMIN,
    actionType: approve ? 'unlock_request.approved' : 'unlock_request.denied',
    targetType: 'UnlockRequest',
    targetId: request._id,
    metadata: {
      date: dateKey,
      attendance_id: attendance._id,
      employee_id: employee._id,
      employee_email: employee.employee_email,
      decision_note: note,
      unlock_expires_at: unlockExpiresAt,
    },
  });

  await notifyUnlockDecision({
    employee,
    dateKey,
    status: nextStatus,
    decisionNote: note,
    unlockExpiresAt,
  });

  return serializeUnlockRequest(request, company.timezone);
}

module.exports = {
  createUnlockRequest,
  listMyUnlockRequests,
  cancelMyUnlockRequest,
  listUnlockRequestsForAdmin,
  decideUnlockRequest,
};
