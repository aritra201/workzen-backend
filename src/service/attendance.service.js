const { Attendance, Company, UnlockRequest } = require('../models');
const { SHIFT_KEY, SHIFT_STATUS, COMPANY_ROLE, UNLOCK_REQUEST_STATUS } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { uploadImageBuffer, deleteImagesByUrls } = require('../helper/cloudinary.helper');
const { parseWorkPictureUrlList } = require('../helper/workPictureList.helper');
const { MAX_WORK_PICTURES } = require('../helper/attendanceUpload.helper');
const { resolveDateRangeFilter, parseRequiredDateKey } = require('../helper/dateRangeFilter.helper');
const { isUnlockWindowActive } = require('../helper/unlockWindow.helper');
const {
  getCompanyTodayDateKey,
  dateKeyToUtcDate,
  utcDateToDateKey,
  isCompanyLocalLockCutoffReached,
} = require('../utils/timezone.helper');

const REGULAR_SHIFTS = new Set([SHIFT_KEY.DAY, SHIFT_KEY.NIGHT]);
const EXTRA_SHIFTS = new Set([SHIFT_KEY.EXTRA_DAY, SHIFT_KEY.EXTRA_NIGHT]);
const ALL_EMPLOYEE_SHIFTS = new Set([...REGULAR_SHIFTS, ...EXTRA_SHIFTS]);
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_DAYS = 30;

function assertEmployeeShiftKey(shiftKey) {
  if (!ALL_EMPLOYEE_SHIFTS.has(shiftKey)) {
    throw new AppError('Shift-Key must be day, night, extra_day, or extra_night', 400);
  }
}

function isExtraShiftKey(shiftKey) {
  return EXTRA_SHIFTS.has(shiftKey);
}

/** FR-053: employee cannot fill undeclared extra shifts. */
function assertExtraShiftDeclared(shift, shiftKey) {
  if (!shift?.declared) {
    throw new AppError(
      `Extra shift "${shiftKey}" is not available — ask your admin to declare it first`,
      403
    );
  }
}

const PAST_DATE_BLOCKED_MESSAGE =
  'Past dates cannot be marked directly — submit an unlock request for this date';

async function findActiveApprovedUnlock({ employeeId, companyId, dateKey }) {
  const request = await UnlockRequest.findOne({
    employee_id: employeeId,
    company_id: companyId,
    requested_date: dateKeyToUtcDate(dateKey),
    status: UNLOCK_REQUEST_STATUS.APPROVED,
  }).sort({ decided_at: -1 });

  if (!request || !isUnlockWindowActive(request.unlock_expires_at)) {
    return null;
  }
  return request;
}

function canEmployeeEditAttendance({ attendance, timezone, dateKey, todayKey }) {
  if (isUnlockWindowActive(attendance?.unlock_expires_at)) {
    return true;
  }
  if (dateKey !== todayKey) {
    return false;
  }
  if (attendance?.lock_attendance) {
    return false;
  }
  if (isCompanyLocalLockCutoffReached(timezone)) {
    return false;
  }
  return true;
}

function assertEmployeeCanEditAttendance({ attendance, timezone, dateKey, todayKey }) {
  if (isUnlockWindowActive(attendance?.unlock_expires_at)) {
    return;
  }
  if (dateKey !== todayKey) {
    throw new AppError(PAST_DATE_BLOCKED_MESSAGE, 403);
  }
  if (attendance.lock_attendance) {
    throw new AppError('Attendance is locked for this date — submit an unlock request to edit', 403);
  }
  if (isCompanyLocalLockCutoffReached(timezone)) {
    throw new AppError("Today's attendance cutoff (11:59 PM) has passed", 403);
  }
}

async function loadEmployeeAttendanceContext(employeeProfile, requestedDateKey, { writable } = {}) {
  const company = await loadEmployeeCompanyContext(employeeProfile);
  const timezone = company.timezone;
  const todayKey = getCompanyTodayDateKey(timezone);
  const dateKey = requestedDateKey
    ? parseRequiredDateKey(requestedDateKey, 'Attendance-Date')
    : todayKey;

  if (dateKey > todayKey) {
    throw new AppError('Cannot access attendance for a future date', 400);
  }

  if (dateKey === todayKey) {
    const { attendance } = await getOrCreateTodayAttendance(employeeProfile, company);
    if (writable) {
      assertEmployeeCanEditAttendance({ attendance, timezone, dateKey, todayKey });
    }
    return { attendance, dateKey, timezone, company, todayKey };
  }

  const unlock = await findActiveApprovedUnlock({
    employeeId: employeeProfile._id,
    companyId: company._id,
    dateKey,
  });

  let attendance = await Attendance.findOne({
    employee_id: employeeProfile._id,
    date: dateKeyToUtcDate(dateKey),
  });

  if (writable) {
    if (!unlock) {
      throw new AppError(PAST_DATE_BLOCKED_MESSAGE, 403);
    }
    if (!attendance) {
      const created = await getOrCreateAttendanceForEmployeeDate({
        company,
        employeeProfile,
        dateKey,
        actorUserId: employeeProfile.user_id,
        actorRole: COMPANY_ROLE.EMPLOYEE,
      });
      attendance = created.attendance;
    }
    attendance.lock_attendance = false;
    attendance.unlocked_via_request_id = unlock._id;
    attendance.unlock_expires_at = unlock.unlock_expires_at;
    attendance.$locals.allowLockedEdit = true;
    assertEmployeeCanEditAttendance({ attendance, timezone, dateKey, todayKey });
    return { attendance, dateKey, timezone, company, todayKey };
  }

  if (!attendance && !unlock) {
    throw new AppError(
      'No attendance record for this date — submit an unlock request to create one',
      404
    );
  }
  if (!attendance && unlock) {
    const created = await getOrCreateAttendanceForEmployeeDate({
      company,
      employeeProfile,
      dateKey,
      actorUserId: employeeProfile.user_id,
      actorRole: COMPANY_ROLE.EMPLOYEE,
    });
    attendance = created.attendance;
    attendance.lock_attendance = false;
    attendance.unlocked_via_request_id = unlock._id;
    attendance.unlock_expires_at = unlock.unlock_expires_at;
    await attendance.save();
  }

  return { attendance, dateKey, timezone, company, todayKey };
}

async function loadEmployeeCompanyContext(employeeProfile) {
  const company = await Company.findById(employeeProfile.company_id);
  if (!company) {
    throw new AppError('Company not found for employee', 500);
  }
  return company;
}

async function getOrCreateAttendanceForEmployeeDate({
  company,
  employeeProfile,
  dateKey,
  actorUserId,
  actorRole = COMPANY_ROLE.EMPLOYEE,
}) {
  const timezone = company.timezone;
  const storedDate = dateKeyToUtcDate(dateKey);

  let attendance = await Attendance.findOne({
    employee_id: employeeProfile._id,
    date: storedDate,
  });

  if (!attendance) {
    attendance = await Attendance.create({
      company_id: company._id,
      employee_id: employeeProfile._id,
      date: storedDate,
      lock_attendance: false,
    });

    await writeActivityLog({
      companyId: company._id,
      actorUserId: actorUserId || employeeProfile.user_id,
      actorRole,
      actionType: 'attendance.created',
      targetType: 'Attendance',
      targetId: attendance._id,
      metadata: { date: dateKey },
    });
  }

  return { attendance, dateKey, timezone };
}

async function getOrCreateTodayAttendance(employeeProfile, company) {
  const todayKey = getCompanyTodayDateKey(company.timezone);
  return getOrCreateAttendanceForEmployeeDate({
    company,
    employeeProfile,
    dateKey: todayKey,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
  });
}

function snapshotShiftMarks(attendance) {
  return {
    day: Boolean(attendance.shifts?.day?.marked),
    night: Boolean(attendance.shifts?.night?.marked),
    extra_day: Boolean(attendance.shifts?.extra_day?.marked),
    extra_night: Boolean(attendance.shifts?.extra_night?.marked),
  };
}

/** FR-042: once marked true, employee cannot revert to false. */
function assertShiftMarksNotReverted(attendance, beforeMarks) {
  for (const key of [
    SHIFT_KEY.DAY,
    SHIFT_KEY.NIGHT,
    SHIFT_KEY.EXTRA_DAY,
    SHIFT_KEY.EXTRA_NIGHT,
  ]) {
    if (beforeMarks[key] && !attendance.shifts[key].marked) {
      throw new AppError('Confirmed shifts cannot be unchecked', 400);
    }
  }
}

async function saveAttendanceWithShiftGuards(attendance, beforeMarks) {
  assertShiftMarksNotReverted(attendance, beforeMarks);
  await attendance.save();
}

function serializeRegularShift(shift) {
  if (!shift || !shift.marked) {
    return null;
  }
  return {
    marked: shift.marked,
    amount: shift.amount ?? null,
    comment: shift.comment ?? null,
    workPictures: shift.work_picture ?? [],
    geoLocation: shift.geo_location ?? null,
    status: shift.status,
  };
}

/** FR-053: omit extra shift data until admin has declared it. */
function serializeExtraShift(shift) {
  if (!shift?.declared) {
    return null;
  }
  return {
    declared: true,
    declaredAt: shift.declared_at ?? null,
    marked: Boolean(shift.marked),
    amount: shift.amount ?? null,
    comment: shift.comment ?? null,
    workPictures: shift.work_picture ?? [],
    geoLocation: shift.geo_location ?? null,
    status: shift.status,
  };
}

function serializeAttendanceRecord(attendance, dateKey, timezone) {
  const todayKey = getCompanyTodayDateKey(timezone);
  return {
    id: attendance._id,
    date: dateKey,
    timezone,
    lockAttendance: attendance.lock_attendance,
    unlockedViaRequestId: attendance.unlocked_via_request_id || null,
    unlockExpiresAt: attendance.unlock_expires_at || null,
    canEdit: canEmployeeEditAttendance({
      attendance,
      timezone,
      dateKey,
      todayKey,
    }),
    shifts: {
      day: serializeRegularShift(attendance.shifts.day),
      night: serializeRegularShift(attendance.shifts.night),
      extraDay: serializeExtraShift(attendance.shifts.extra_day),
      extraNight: serializeExtraShift(attendance.shifts.extra_night),
    },
    createdAt: attendance.created_at,
    updatedAt: attendance.updated_at,
  };
}

function serializeAttendance(attendance, todayKey, timezone) {
  return serializeAttendanceRecord(attendance, todayKey, timezone);
}

function assertShiftReadyForUpload(shift, shiftKey) {
  if (isExtraShiftKey(shiftKey)) {
    assertExtraShiftDeclared(shift, shiftKey);
    if (!shift.marked) {
      throw new AppError('Confirm this extra shift before uploading work pictures', 400);
    }
    return;
  }
  if (!shift.marked) {
    throw new AppError('Confirm this shift before uploading work pictures', 400);
  }
}

function assertShiftReadyForSubmit(shift, shiftKey) {
  if (isExtraShiftKey(shiftKey)) {
    assertExtraShiftDeclared(shift, shiftKey);
    if (!shift.marked) {
      throw new AppError('Confirm this extra shift before submitting details', 400);
    }
    return;
  }
  if (!shift.marked) {
    throw new AppError('Confirm this shift before submitting details', 400);
  }
}

function assertShiftReadyForEdit(shift, shiftKey) {
  if (isExtraShiftKey(shiftKey)) {
    assertExtraShiftDeclared(shift, shiftKey);
    if (!shift.marked || shift.amount == null || !shift.comment) {
      throw new AppError('Submit extra shift details before editing', 400);
    }
    return;
  }
  if (!shift.marked) {
    throw new AppError('Shift is not confirmed for today', 400);
  }
  if (shift.amount == null || !shift.comment) {
    throw new AppError('Submit shift details before editing', 400);
  }
}

async function getTodayAttendanceForEmployee(employeeProfile, requestedDateKey) {
  const { attendance, dateKey, timezone } = await loadEmployeeAttendanceContext(
    employeeProfile,
    requestedDateKey,
    { writable: false }
  );
  return serializeAttendance(attendance, dateKey, timezone);
}

/**
 * Paginated attendance history for the authenticated employee (read-only; does not create rows).
 */
async function listAttendanceForEmployee(employeeProfile, { startDate, endDate, page, limit }) {
  const company = await loadEmployeeCompanyContext(employeeProfile);
  const timezone = company.timezone || 'Asia/Kolkata';
  const todayKey = getCompanyTodayDateKey(timezone);

  const { startDate: startDateKey, endDate: endDateKey, dateRange } = resolveDateRangeFilter({
    startDate,
    endDate,
    timezone,
    todayKey,
    defaultWindowDays: DEFAULT_LIST_DAYS,
  });

  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Number.parseInt(limit, 10) || DEFAULT_LIST_LIMIT)
  );
  const skip = (pageNum - 1) * limitNum;

  const filter = {
    employee_id: employeeProfile._id,
    company_id: company._id,
    date: dateRange,
  };

  const [total, records] = await Promise.all([
    Attendance.countDocuments(filter),
    Attendance.find(filter).sort({ date: -1 }).skip(skip).limit(limitNum),
  ]);

  return {
    timezone,
    startDate: startDateKey,
    endDate: endDateKey,
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limitNum),
    items: records.map((attendance) =>
      serializeAttendanceRecord(attendance, utcDateToDateKey(attendance.date), timezone)
    ),
  };
}

/**
 * FR-041/042: confirm day/night shift (irreversible).
 * FR-052/053: confirm extra_day/extra_night only when admin has declared it.
 */
async function confirmTodayShift({ employeeProfile, shiftKey, dateKey: requestedDateKey }) {
  assertEmployeeShiftKey(shiftKey);
  const { attendance, dateKey, timezone, company } = await loadEmployeeAttendanceContext(
    employeeProfile,
    requestedDateKey,
    { writable: true }
  );

  const beforeMarks = snapshotShiftMarks(attendance);
  const shift = attendance.shifts[shiftKey];

  if (isExtraShiftKey(shiftKey)) {
    assertExtraShiftDeclared(shift, shiftKey);
  }

  if (shift.marked) {
    return serializeAttendance(attendance, dateKey, timezone);
  }

  shift.marked = true;
  if (!shift.status) {
    shift.status = SHIFT_STATUS.PENDING_VERIFICATION;
  }

  attendance.markModified(`shifts.${shiftKey}`);
  await saveAttendanceWithShiftGuards(attendance, beforeMarks);

  const actionType = isExtraShiftKey(shiftKey)
    ? 'extra_shift.confirmed'
    : 'attendance.shift_confirmed';

  await writeActivityLog({
    companyId: company._id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType,
    targetType: 'Attendance',
    targetId: attendance._id,
    metadata: { date: dateKey, shift_key: shiftKey },
  });

  return serializeAttendance(attendance, dateKey, timezone);
}

function validateGeoLocation(geoLocation) {
  if (!geoLocation || typeof geoLocation !== 'object') {
    throw new AppError('geoLocation with lat and lng is required', 400);
  }
  const lat = Number(geoLocation.lat);
  const lng = Number(geoLocation.lng);
  if (Number.isNaN(lat) || lat < -90 || lat > 90) {
    throw new AppError('geoLocation.lat must be between -90 and 90', 400);
  }
  if (Number.isNaN(lng) || lng < -180 || lng > 180) {
    throw new AppError('geoLocation.lng must be between -180 and 180', 400);
  }
  return { lat, lng };
}

function validateAmount(amount) {
  const value = Number(amount);
  if (Number.isNaN(value) || value <= 0) {
    throw new AppError('amount must be a number greater than 0', 400);
  }
  return value;
}

function validateComment(comment) {
  if (typeof comment !== 'string' || !comment.trim()) {
    throw new AppError('comment is required', 400);
  }
  return comment.trim();
}

/**
 * FR-043: initial submit for a confirmed shift (amount, comment, geo). Work pictures
 * may be uploaded before or after submit via the work-pictures endpoint.
 */
async function submitTodayShift({ employeeProfile, shiftKey, amount, comment, geoLocation, dateKey: requestedDateKey }) {
  assertEmployeeShiftKey(shiftKey);
  const { attendance, dateKey, timezone, company } = await loadEmployeeAttendanceContext(
    employeeProfile,
    requestedDateKey,
    { writable: true }
  );

  const beforeMarks = snapshotShiftMarks(attendance);
  const shift = attendance.shifts[shiftKey];
  assertShiftReadyForSubmit(shift, shiftKey);

  const parsedAmount = validateAmount(amount);
  const parsedComment = validateComment(comment);
  const parsedGeo = validateGeoLocation(geoLocation);

  const hadSubmission = shift.amount != null && shift.comment;

  shift.amount = parsedAmount;
  shift.comment = parsedComment;
  shift.geo_location = parsedGeo;
  shift.status = SHIFT_STATUS.PENDING_VERIFICATION;

  attendance.markModified(`shifts.${shiftKey}`);
  await saveAttendanceWithShiftGuards(attendance, beforeMarks);

  const actionType = isExtraShiftKey(shiftKey)
    ? hadSubmission
      ? 'extra_shift.resubmitted'
      : 'extra_shift.submitted'
    : hadSubmission
      ? 'attendance.shift_resubmitted'
      : 'attendance.shift_submitted';

  await writeActivityLog({
    companyId: company._id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType,
    targetType: 'Attendance',
    targetId: attendance._id,
    metadata: { date: dateKey, shift_key: shiftKey },
  });

  return serializeAttendance(attendance, dateKey, timezone);
}

/**
 * FR-044: edit amount and/or comment before lock.
 */
async function updateTodayShiftDetails({ employeeProfile, shiftKey, amount, comment, dateKey: requestedDateKey }) {
  assertEmployeeShiftKey(shiftKey);

  if (amount === undefined && comment === undefined) {
    throw new AppError('Provide amount and/or comment to update', 400);
  }

  const { attendance, dateKey, timezone, company } = await loadEmployeeAttendanceContext(
    employeeProfile,
    requestedDateKey,
    { writable: true }
  );

  const beforeMarks = snapshotShiftMarks(attendance);
  const shift = attendance.shifts[shiftKey];
  assertShiftReadyForEdit(shift, shiftKey);

  const before = { amount: shift.amount, comment: shift.comment };
  const after = { ...before };

  if (amount !== undefined) {
    after.amount = validateAmount(amount);
    shift.amount = after.amount;
  }
  if (comment !== undefined) {
    after.comment = validateComment(comment);
    shift.comment = after.comment;
  }

  if (before.amount === after.amount && before.comment === after.comment) {
    return serializeAttendance(attendance, dateKey, timezone);
  }

  attendance.markModified(`shifts.${shiftKey}`);
  await saveAttendanceWithShiftGuards(attendance, beforeMarks);

  const actionType = isExtraShiftKey(shiftKey)
    ? 'extra_shift.amount_edited'
    : 'attendance.amount_edited';

  await writeActivityLog({
    companyId: company._id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType,
    targetType: 'Attendance',
    targetId: attendance._id,
    beforeValue: before,
    afterValue: after,
    metadata: { date: dateKey, shift_key: shiftKey },
  });

  return serializeAttendance(attendance, dateKey, timezone);
}

function getShiftWorkPictureUrls(shift) {
  if (!Array.isArray(shift?.work_picture)) {
    return [];
  }
  return shift.work_picture.filter(Boolean);
}

function assertUrlsBelongToShift(shift, urls, shiftKey) {
  const current = new Set(getShiftWorkPictureUrls(shift));
  const unknown = urls.filter((url) => !current.has(url));
  if (unknown.length > 0) {
    throw new AppError(
      `One or more URLs are not attached to this shift (${shiftKey})`,
      400
    );
  }
}

async function removeWorkPicturesFromShift({
  company,
  employeeProfile,
  attendance,
  dateKey,
  timezone,
  shiftKey,
  urlsToRemove,
  actionType,
}) {
  if (!urlsToRemove.length) {
    throw new AppError('Provide at least one work picture URL to remove', 400);
  }

  const beforeMarks = snapshotShiftMarks(attendance);
  const shift = attendance.shifts[shiftKey];
  assertShiftReadyForUpload(shift, shiftKey);

  assertUrlsBelongToShift(shift, urlsToRemove, shiftKey);

  await deleteImagesByUrls(urlsToRemove);

  const removeSet = new Set(urlsToRemove);
  shift.work_picture = getShiftWorkPictureUrls(shift).filter((url) => !removeSet.has(url));

  attendance.markModified(`shifts.${shiftKey}`);
  await saveAttendanceWithShiftGuards(attendance, beforeMarks);

  await writeActivityLog({
    companyId: company._id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType,
    targetType: 'Attendance',
    targetId: attendance._id,
    metadata: {
      date: dateKey,
      shift_key: shiftKey,
      removed_urls: urlsToRemove,
    },
  });

  return serializeAttendance(attendance, dateKey, timezone);
}

/**
 * DELETE work pictures by URL (removes from Cloudinary and attendance).
 */
async function deleteTodayWorkPictures({ employeeProfile, shiftKey, urls, dateKey: requestedDateKey }) {
  assertEmployeeShiftKey(shiftKey);
  const urlsToRemove = parseWorkPictureUrlList(urls, 'urls');

  const { attendance, dateKey, timezone, company } = await loadEmployeeAttendanceContext(
    employeeProfile,
    requestedDateKey,
    { writable: true }
  );

  const actionType = isExtraShiftKey(shiftKey)
    ? 'extra_shift.work_pictures_removed'
    : 'attendance.work_pictures_removed';

  return removeWorkPicturesFromShift({
    company,
    employeeProfile,
    attendance,
    dateKey,
    timezone,
    shiftKey,
    urlsToRemove,
    actionType,
  });
}

/**
 * Replace flow: remove listed URLs (Cloudinary + DB), then upload new files.
 */
async function replaceTodayWorkPictures({
  employeeProfile,
  shiftKey,
  removeUrls,
  files,
  dateKey: requestedDateKey,
}) {
  assertEmployeeShiftKey(shiftKey);

  const urlsToRemove = parseWorkPictureUrlList(removeUrls, 'removeUrls');
  const fileList = Array.isArray(files) ? files.filter((f) => f?.buffer) : [];

  if (urlsToRemove.length === 0 && fileList.length === 0) {
    throw new AppError('Provide removeUrls and/or new workPicture files to replace', 400);
  }

  const { attendance, dateKey, timezone, company } = await loadEmployeeAttendanceContext(
    employeeProfile,
    requestedDateKey,
    { writable: true }
  );

  const beforeMarks = snapshotShiftMarks(attendance);
  const shift = attendance.shifts[shiftKey];
  assertShiftReadyForUpload(shift, shiftKey);

  if (!shift.work_picture) {
    shift.work_picture = [];
  }

  if (urlsToRemove.length > 0) {
    assertUrlsBelongToShift(shift, urlsToRemove, shiftKey);
    await deleteImagesByUrls(urlsToRemove);
    const removeSet = new Set(urlsToRemove);
    shift.work_picture = getShiftWorkPictureUrls(shift).filter((url) => !removeSet.has(url));
  }

  if (fileList.length > 0) {
    const remaining = MAX_WORK_PICTURES - shift.work_picture.length;
    if (remaining <= 0) {
      throw new AppError(`Maximum ${MAX_WORK_PICTURES} work pictures per shift`, 400);
    }
    if (fileList.length > remaining) {
      throw new AppError(
        `You can upload ${remaining} more picture(s) for this shift (max ${MAX_WORK_PICTURES} total)`,
        400
      );
    }

    const folder = `workzen/attendance/${attendance._id.toString()}/${shiftKey}`;
    for (const file of fileList) {
      const publicId = `pic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        const uploadResult = await uploadImageBuffer(file.buffer, { folder, publicId });
        shift.work_picture.push(uploadResult.secure_url);
      } catch (err) {
        throw new AppError('Failed to upload work picture — try again later', 502);
      }
    }
  }

  attendance.markModified(`shifts.${shiftKey}`);
  await saveAttendanceWithShiftGuards(attendance, beforeMarks);

  const actionType = isExtraShiftKey(shiftKey)
    ? 'extra_shift.work_pictures_replaced'
    : 'attendance.work_pictures_replaced';

  await writeActivityLog({
    companyId: company._id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType,
    targetType: 'Attendance',
    targetId: attendance._id,
    metadata: {
      date: dateKey,
      shift_key: shiftKey,
      removed_urls: urlsToRemove,
      added_count: fileList.length,
    },
  });

  return serializeAttendance(attendance, dateKey, timezone);
}

async function uploadTodayWorkPictures({ employeeProfile, shiftKey, files, dateKey: requestedDateKey }) {
  assertEmployeeShiftKey(shiftKey);

  const fileList = Array.isArray(files) ? files.filter((f) => f?.buffer) : [];
  if (fileList.length === 0) {
    throw new AppError(
      'At least one workPicture file is required (multipart/form-data, field name workPicture)',
      400
    );
  }

  const { attendance, dateKey, timezone } = await loadEmployeeAttendanceContext(
    employeeProfile,
    requestedDateKey,
    { writable: true }
  );

  const beforeMarks = snapshotShiftMarks(attendance);
  const shift = attendance.shifts[shiftKey];
  assertShiftReadyForUpload(shift, shiftKey);

  if (!shift.work_picture) {
    shift.work_picture = [];
  }

  const remaining = MAX_WORK_PICTURES - shift.work_picture.length;
  if (remaining <= 0) {
    throw new AppError(`Maximum ${MAX_WORK_PICTURES} work pictures per shift`, 400);
  }
  if (fileList.length > remaining) {
    throw new AppError(
      `You can upload ${remaining} more picture(s) for this shift (max ${MAX_WORK_PICTURES} total)`,
      400
    );
  }

  const folder = `workzen/attendance/${attendance._id.toString()}/${shiftKey}`;

  for (const file of fileList) {
    const publicId = `pic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const uploadResult = await uploadImageBuffer(file.buffer, { folder, publicId });
      shift.work_picture.push(uploadResult.secure_url);
    } catch (err) {
      throw new AppError('Failed to upload work picture — try again later', 502);
    }
  }

  attendance.markModified(`shifts.${shiftKey}`);
  await saveAttendanceWithShiftGuards(attendance, beforeMarks);

  return serializeAttendance(attendance, dateKey, timezone);
}

module.exports = {
  getTodayAttendanceForEmployee,
  listAttendanceForEmployee,
  getOrCreateAttendanceForEmployeeDate,
  serializeAttendanceRecord,
  confirmTodayShift,
  submitTodayShift,
  updateTodayShiftDetails,
  uploadTodayWorkPictures,
  deleteTodayWorkPictures,
  replaceTodayWorkPictures,
  assertEmployeeShiftKey,
  isExtraShiftKey,
};
