const attendanceService = require('../service/attendance.service');
const attendanceVerificationService = require('../service/attendanceVerification.service');
const { collectWorkPictureFiles } = require('../helper/attendanceUpload.helper');
const { SHIFT_KEY } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { parseObjectId } = require('../utils/objectId.helper');

const ALL_SHIFT_KEYS = new Set([
  SHIFT_KEY.DAY,
  SHIFT_KEY.NIGHT,
  SHIFT_KEY.EXTRA_DAY,
  SHIFT_KEY.EXTRA_NIGHT,
]);

/** Header: `Shift-Key: day | night | extra_day | extra_night` */
function shiftKeyFromRequest(req) {
  const raw = req.headers['shift-key'] || req.headers['x-shift-key'];
  if (!raw) {
    throw new AppError(
      'Shift-Key header is required (day, night, extra_day, or extra_night)',
      400
    );
  }
  const shiftKey = String(raw).trim().toLowerCase();
  if (!ALL_SHIFT_KEYS.has(shiftKey)) {
    throw new AppError('Shift-Key must be day, night, extra_day, or extra_night', 400);
  }
  return shiftKey;
}

function employeeFromRequest(req) {
  return req.employment.employeeProfile;
}

function attendanceIdFromQuery(req) {
  const raw = req.query.attendanceId ?? req.query.attendance_id;
  if (!raw) {
    throw new AppError('attendanceId query parameter is required', 400);
  }
  return parseObjectId(String(raw).trim(), 'attendanceId');
}

function attendanceIdFromBody(req) {
  const raw = req.body?.attendanceId ?? req.body?.attendance_id;
  if (!raw) {
    throw new AppError('attendanceId is required in the request body', 400);
  }
  return parseObjectId(String(raw).trim(), 'attendanceId');
}

function shiftKeyFromBody(req) {
  const raw = req.body?.shiftKey ?? req.body?.shift_key;
  if (!raw) {
    throw new AppError(
      'shiftKey is required in the request body (day, night, extra_day, or extra_night)',
      400
    );
  }
  const shiftKey = String(raw).trim().toLowerCase();
  if (!ALL_SHIFT_KEYS.has(shiftKey)) {
    throw new AppError('shiftKey must be day, night, extra_day, or extra_night', 400);
  }
  return shiftKey;
}

/** Optional header: `Attendance-Date: yyyy-MM-dd` — required for unlocked past dates. */
function attendanceDateFromRequest(req) {
  const raw = req.headers['attendance-date'] || req.headers['x-attendance-date'];
  if (!raw) {
    return undefined;
  }
  return String(raw).trim();
}

async function getToday(req, res) {
  const data = await attendanceService.getTodayAttendanceForEmployee(
    employeeFromRequest(req),
    attendanceDateFromRequest(req)
  );
  res.status(200).json(data);
}

async function listMyAttendance(req, res) {
  const { startDate, endDate, page, limit } = req.query;
  const data = await attendanceService.listAttendanceForEmployee(employeeFromRequest(req), {
    startDate,
    endDate,
    page,
    limit,
  });
  res.status(200).json(data);
}

async function confirmShift(req, res) {
  const shiftKey = shiftKeyFromRequest(req);
  const data = await attendanceService.confirmTodayShift({
    employeeProfile: employeeFromRequest(req),
    shiftKey,
    dateKey: attendanceDateFromRequest(req),
  });
  res.status(200).json(data);
}

async function submitShift(req, res) {
  const shiftKey = shiftKeyFromRequest(req);
  const { amount, comment, geoLocation } = req.body;

  const data = await attendanceService.submitTodayShift({
    employeeProfile: employeeFromRequest(req),
    shiftKey,
    amount,
    comment,
    geoLocation,
    dateKey: attendanceDateFromRequest(req),
  });
  res.status(200).json(data);
}

async function updateShiftDetails(req, res) {
  const shiftKey = shiftKeyFromRequest(req);
  const { amount, comment } = req.body;

  const data = await attendanceService.updateTodayShiftDetails({
    employeeProfile: employeeFromRequest(req),
    shiftKey,
    amount,
    comment,
    dateKey: attendanceDateFromRequest(req),
  });
  res.status(200).json(data);
}

async function uploadWorkPicture(req, res) {
  const shiftKey = shiftKeyFromRequest(req);
  const files = collectWorkPictureFiles(req);
  const data = await attendanceService.uploadTodayWorkPictures({
    employeeProfile: employeeFromRequest(req),
    shiftKey,
    files,
    dateKey: attendanceDateFromRequest(req),
  });
  res.status(200).json(data);
}

async function deleteWorkPictures(req, res) {
  const shiftKey = shiftKeyFromRequest(req);
  const urls = req.body?.urls ?? req.body?.workPictureUrls;

  const data = await attendanceService.deleteTodayWorkPictures({
    employeeProfile: employeeFromRequest(req),
    shiftKey,
    urls,
    dateKey: attendanceDateFromRequest(req),
  });

  res.status(200).json({
    message: 'Work picture(s) removed',
    attendance: data,
  });
}

async function replaceWorkPictures(req, res) {
  const shiftKey = shiftKeyFromRequest(req);
  const removeUrls = req.body?.removeUrls ?? req.body?.urls;
  const files = collectWorkPictureFiles(req);

  const data = await attendanceService.replaceTodayWorkPictures({
    employeeProfile: employeeFromRequest(req),
    shiftKey,
    removeUrls,
    files,
    dateKey: attendanceDateFromRequest(req),
  });

  res.status(200).json({
    message: 'Work picture(s) updated',
    attendance: data,
  });
}

async function getMyAttendanceRecord(req, res) {
  const rawShift = req.query.shiftKey;
  let shiftKey;
  if (rawShift) {
    shiftKey = String(rawShift).trim().toLowerCase();
    if (!ALL_SHIFT_KEYS.has(shiftKey)) {
      throw new AppError('shiftKey must be day, night, extra_day, or extra_night', 400);
    }
  }
  const data = await attendanceVerificationService.getEmployeeAttendanceDetail(
    employeeFromRequest(req),
    attendanceIdFromQuery(req),
    { shiftKey }
  );
  res.status(200).json(data);
}

async function replyCommentThread(req, res) {
  const attendanceId = attendanceIdFromBody(req);
  const shiftKey = shiftKeyFromBody(req);
  const { text } = req.body;
  const thread = await attendanceVerificationService.addEmployeeCommentThreadReply({
    employeeProfile: employeeFromRequest(req),
    attendanceId,
    shiftKey,
    text,
  });
  res.status(200).json({ commentThread: thread });
}

module.exports = {
  getToday,
  listMyAttendance,
  getMyAttendanceRecord,
  confirmShift,
  submitShift,
  updateShiftDetails,
  uploadWorkPicture,
  deleteWorkPictures,
  replaceWorkPictures,
  replyCommentThread,
};
