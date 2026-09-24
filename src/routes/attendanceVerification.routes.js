const express = require('express');
const attendanceVerificationController = require('../controller/attendanceVerification.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireCompanyAdmin } = require('../helper/companyAdmin.helper');
const { forbidActiveMemberWriteAccess } = require('../helper/membership.guard');
const { requireCompanyAttendanceViewer } = require('../helper/companyAttendanceAccess.helper');

const router = express.Router();

const viewer = [requireAuth, requireCompanyAttendanceViewer];
const adminWrite = [requireAuth, forbidActiveMemberWriteAccess, requireCompanyAdmin];

router.get('/', ...viewer, asyncHandler(attendanceVerificationController.list));
router.get('/record', ...viewer, asyncHandler(attendanceVerificationController.getDetail));
router.post('/shifts/verify', ...adminWrite, asyncHandler(attendanceVerificationController.verifyShift));
router.post('/shifts/comment-thread/reply', ...adminWrite, asyncHandler(attendanceVerificationController.replyToThread));

module.exports = router;
