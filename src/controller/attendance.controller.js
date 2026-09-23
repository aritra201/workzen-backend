const attendanceService = require('../service/attendance.service');
const { collectWorkPictureFiles } = require('../helper/attendanceUpload.helper');
const { SHIFT_KEY } = require('../utils/enums');
const { AppError } = require('../utils/AppError');

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

async function getToday(req, res) {
  const data = await attendanceService.getTodayAttendanceForEmployee(employeeFromRequest(req));
  res.status(200).json(data);
}

async function confirmShift(req, res) {
  const shiftKey = shiftKeyFromRequest(req);
  const data = await attendanceService.confirmTodayShift({
    employeeProfile: employeeFromRequest(req),
    shiftKey,
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
  });

  res.status(200).json({
    message: 'Work picture(s) updated',
    attendance: data,
  });
}

module.exports = {
  getToday,
  confirmShift,
  submitShift,
  updateShiftDetails,
  uploadWorkPicture,
  deleteWorkPictures,
  replaceWorkPictures,
};
