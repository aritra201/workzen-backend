const attendanceVerificationService = require('../service/attendanceVerification.service');
const { SHIFT_KEY } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { parseObjectId } = require('../utils/objectId.helper');

const ALL_SHIFT_KEYS = new Set([
  SHIFT_KEY.DAY,
  SHIFT_KEY.NIGHT,
  SHIFT_KEY.EXTRA_DAY,
  SHIFT_KEY.EXTRA_NIGHT,
]);

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

function shiftKeyFromBodyOrHeader(req) {
  const raw =
    req.body?.shiftKey ??
    req.body?.shift_key ??
    req.headers['shift-key'] ??
    req.headers['x-shift-key'];
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

function optionalShiftKeyFromQuery(req) {
  const raw = req.query.shiftKey;
  if (!raw) {
    return undefined;
  }
  const shiftKey = String(raw).trim().toLowerCase();
  if (!ALL_SHIFT_KEYS.has(shiftKey)) {
    throw new AppError('shiftKey must be day, night, extra_day, or extra_night', 400);
  }
  return shiftKey;
}

async function list(req, res) {
  const { employeeId, startDate, endDate, status, page, limit } = req.query;
  const data = await attendanceVerificationService.listCompanyAttendance(req.company, {
    employeeId,
    startDate,
    endDate,
    status,
    page,
    limit,
  });
  res.status(200).json(data);
}

async function getDetail(req, res) {
  const shiftKey = optionalShiftKeyFromQuery(req);
  const data = await attendanceVerificationService.getCompanyAttendanceDetail(
    req.company,
    attendanceIdFromQuery(req),
    { shiftKey }
  );
  res.status(200).json(data);
}

async function verifyShift(req, res) {
  const attendanceId = attendanceIdFromBody(req);
  const shiftKey = shiftKeyFromBodyOrHeader(req);
  const data = await attendanceVerificationService.verifyAttendanceShift({
    company: req.company,
    adminUserId: req.user._id,
    attendanceId,
    shiftKey,
  });
  res.status(200).json(data);
}

async function replyToThread(req, res) {
  const attendanceId = attendanceIdFromBody(req);
  const shiftKey = shiftKeyFromBodyOrHeader(req);
  const { text } = req.body;
  const data = await attendanceVerificationService.addAdminCommentThreadReply({
    company: req.company,
    adminUserId: req.user._id,
    attendanceId,
    shiftKey,
    text,
  });
  res.status(200).json(data);
}

module.exports = {
  list,
  getDetail,
  verifyShift,
  replyToThread,
};
