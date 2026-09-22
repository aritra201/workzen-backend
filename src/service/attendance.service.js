const { Attendance, EmployeeProfile, Company } = require('../models');
const { SHIFT_KEY, SHIFT_STATUS, COMPANY_ROLE } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { uploadImageBuffer } = require('../helper/cloudinary.helper');
const { MAX_WORK_PICTURES } = require('../helper/attendanceUpload.helper');
const {
  getCompanyTodayDateKey,
  dateKeyToUtcDate,
  utcDateToDateKey,
  isCompanyLocalLockCutoffReached,
} = require('../utils/timezone.helper');

const REGULAR_SHIFTS = new Set([SHIFT_KEY.DAY, SHIFT_KEY.NIGHT]);

function assertRegularShiftKey(shiftKey) {
  if (!REGULAR_SHIFTS.has(shiftKey)) {
    throw new AppError('Only day and night shifts can be managed here', 400);
  }
}

function assertNotLocked(attendance, timezone) {
  if (attendance.lock_attendance) {
    throw new AppError('Attendance is locked for this date — submit an unlock request to edit', 403);
  }
  if (isCompanyLocalLockCutoffReached(timezone)) {
    throw new AppError("Today's attendance cutoff (11:59 PM) has passed", 403);
  }
}

async function loadEmployeeCompanyContext(employeeProfile) {
  const company = await Company.findById(employeeProfile.company_id);
  if (!company) {
    throw new AppError('Company not found for employee', 500);
  }
  return company;
}

async function getOrCreateTodayAttendance(employeeProfile, company) {
  const timezone = company.timezone;
  const todayKey = getCompanyTodayDateKey(timezone);
  const storedDate = dateKeyToUtcDate(todayKey);

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
      actorUserId: employeeProfile.user_id,
      actorRole: COMPANY_ROLE.EMPLOYEE,
      actionType: 'attendance.created',
      targetType: 'Attendance',
      targetId: attendance._id,
      metadata: { date: todayKey },
    });
  }

  return { attendance, todayKey, timezone };
}

function snapshotShiftMarks(attendance) {
  return {
    day: Boolean(attendance.shifts?.day?.marked),
    night: Boolean(attendance.shifts?.night?.marked),
  };
}

/** FR-042: once marked true, employee cannot revert to false. */
function assertShiftMarksNotReverted(attendance, beforeMarks) {
  for (const key of [SHIFT_KEY.DAY, SHIFT_KEY.NIGHT]) {
    if (beforeMarks[key] && !attendance.shifts[key].marked) {
      throw new AppError('Confirmed shifts cannot be unchecked', 400);
    }
  }
}

async function saveAttendanceWithShiftGuards(attendance, beforeMarks) {
  assertShiftMarksNotReverted(attendance, beforeMarks);
  await attendance.save();
}

function serializeShift(shift) {
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

function serializeAttendance(attendance, todayKey, timezone) {
  return {
    id: attendance._id,
    date: todayKey,
    timezone,
    lockAttendance: attendance.lock_attendance,
    shifts: {
      day: serializeShift(attendance.shifts.day),
      night: serializeShift(attendance.shifts.night),
    },
    createdAt: attendance.created_at,
    updatedAt: attendance.updated_at,
  };
}

async function getTodayAttendanceForEmployee(employeeProfile) {
  const company = await loadEmployeeCompanyContext(employeeProfile);
  const { attendance, todayKey, timezone } = await getOrCreateTodayAttendance(
    employeeProfile,
    company
  );
  return serializeAttendance(attendance, todayKey, timezone);
}

/**
 * FR-041/042: confirm a regular shift (irreversible).
 */
async function confirmTodayShift({ employeeProfile, shiftKey }) {
  assertRegularShiftKey(shiftKey);
  const company = await loadEmployeeCompanyContext(employeeProfile);
  const { attendance, todayKey, timezone } = await getOrCreateTodayAttendance(
    employeeProfile,
    company
  );

  assertNotLocked(attendance, timezone);

  const beforeMarks = snapshotShiftMarks(attendance);
  const shift = attendance.shifts[shiftKey];
  if (shift.marked) {
    return serializeAttendance(attendance, todayKey, timezone);
  }

  shift.marked = true;
  if (!shift.status) {
    shift.status = SHIFT_STATUS.PENDING_VERIFICATION;
  }

  attendance.markModified(`shifts.${shiftKey}`);
  await saveAttendanceWithShiftGuards(attendance, beforeMarks);

  await writeActivityLog({
    companyId: company._id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType: 'attendance.shift_confirmed',
    targetType: 'Attendance',
    targetId: attendance._id,
    metadata: { date: todayKey, shift_key: shiftKey },
  });

  return serializeAttendance(attendance, todayKey, timezone);
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
 * FR-043: initial submit for a confirmed shift (requires >=1 work picture already uploaded).
 */
async function submitTodayShift({ employeeProfile, shiftKey, amount, comment, geoLocation }) {
  assertRegularShiftKey(shiftKey);
  const company = await loadEmployeeCompanyContext(employeeProfile);
  const { attendance, todayKey, timezone } = await getOrCreateTodayAttendance(
    employeeProfile,
    company
  );

  assertNotLocked(attendance, timezone);

  const beforeMarks = snapshotShiftMarks(attendance);
  const shift = attendance.shifts[shiftKey];
  if (!shift.marked) {
    throw new AppError('Confirm this shift before submitting details', 400);
  }

  if (!shift.work_picture || shift.work_picture.length < 1) {
    throw new AppError('Upload at least one work picture before submitting', 400);
  }

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

  await writeActivityLog({
    companyId: company._id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType: hadSubmission ? 'attendance.shift_resubmitted' : 'attendance.shift_submitted',
    targetType: 'Attendance',
    targetId: attendance._id,
    metadata: { date: todayKey, shift_key: shiftKey },
  });

  return serializeAttendance(attendance, todayKey, timezone);
}

/**
 * FR-044: edit amount and/or comment before lock.
 */
async function updateTodayShiftDetails({ employeeProfile, shiftKey, amount, comment }) {
  assertRegularShiftKey(shiftKey);

  if (amount === undefined && comment === undefined) {
    throw new AppError('Provide amount and/or comment to update', 400);
  }

  const company = await loadEmployeeCompanyContext(employeeProfile);
  const { attendance, todayKey, timezone } = await getOrCreateTodayAttendance(
    employeeProfile,
    company
  );

  assertNotLocked(attendance, timezone);

  const beforeMarks = snapshotShiftMarks(attendance);
  const shift = attendance.shifts[shiftKey];
  if (!shift.marked) {
    throw new AppError('Shift is not confirmed for today', 400);
  }
  if (shift.amount == null || !shift.comment) {
    throw new AppError('Submit shift details before editing', 400);
  }

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
    return serializeAttendance(attendance, todayKey, timezone);
  }

  attendance.markModified(`shifts.${shiftKey}`);
  await saveAttendanceWithShiftGuards(attendance, beforeMarks);

  await writeActivityLog({
    companyId: company._id,
    actorUserId: employeeProfile.user_id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType: 'attendance.amount_edited',
    targetType: 'Attendance',
    targetId: attendance._id,
    beforeValue: before,
    afterValue: after,
    metadata: { date: todayKey, shift_key: shiftKey },
  });

  return serializeAttendance(attendance, todayKey, timezone);
}

async function uploadTodayWorkPictures({ employeeProfile, shiftKey, files }) {
  assertRegularShiftKey(shiftKey);

  const fileList = Array.isArray(files) ? files.filter((f) => f?.buffer) : [];
  if (fileList.length === 0) {
    throw new AppError('At least one workPicture file is required', 400);
  }

  const company = await loadEmployeeCompanyContext(employeeProfile);
  const { attendance, todayKey, timezone } = await getOrCreateTodayAttendance(
    employeeProfile,
    company
  );

  assertNotLocked(attendance, timezone);

  const beforeMarks = snapshotShiftMarks(attendance);
  const shift = attendance.shifts[shiftKey];
  if (!shift.marked) {
    throw new AppError('Confirm this shift before uploading work pictures', 400);
  }

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

  return serializeAttendance(attendance, todayKey, timezone);
}

/**
 * FR-047: reject explicit date access — only today supported in v1 employee API.
 */
async function assertTodayOnlyDateKey(requestedDateKey, timezone) {
  const todayKey = getCompanyTodayDateKey(timezone);
  if (requestedDateKey !== todayKey) {
    throw new AppError('Attendance can only be marked for today in your company timezone', 400);
  }
}

module.exports = {
  getTodayAttendanceForEmployee,
  confirmTodayShift,
  submitTodayShift,
  updateTodayShiftDetails,
  uploadTodayWorkPictures,
  assertTodayOnlyDateKey,
};
