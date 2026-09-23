const express = require('express');
const attendanceController = require('../controller/attendance.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireActiveEmployee } = require('../helper/membership.guard');
const { handleWorkPictureUpload } = require('../helper/attendanceUpload.helper');

const router = express.Router();

const employeeAttendance = [requireAuth, requireActiveEmployee];

router.get('/me/today', employeeAttendance, asyncHandler(attendanceController.getToday));

router.post('/me/today/shifts/confirm', employeeAttendance, asyncHandler(attendanceController.confirmShift));

router.post(
  '/me/today/shifts/work-pictures',
  handleWorkPictureUpload,
  employeeAttendance,
  asyncHandler(attendanceController.uploadWorkPicture)
);

router.put('/me/today/shifts/submit', employeeAttendance, asyncHandler(attendanceController.submitShift));

router.patch('/me/today/shifts', employeeAttendance, asyncHandler(attendanceController.updateShiftDetails));

module.exports = router;
