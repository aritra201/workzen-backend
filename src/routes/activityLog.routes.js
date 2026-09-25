const express = require('express');
const activityLogController = require('../controller/activityLog.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireCompanyAttendanceViewer } = require('../helper/companyAttendanceAccess.helper');

const router = express.Router();

const viewer = [requireAuth, requireCompanyAttendanceViewer];

// Attendance-scoped audit list only (append-only writes elsewhere; FR-082).
router.get('/record', ...viewer, asyncHandler(activityLogController.getDetail));
router.get('/', ...viewer, asyncHandler(activityLogController.listForAttendance));

module.exports = router;
