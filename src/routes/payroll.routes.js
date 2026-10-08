const express = require('express');
const payrollController = require('../controller/payroll.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireCompanyAttendanceViewer } = require('../helper/companyAttendanceAccess.helper');
const { requireActiveEmployee } = require('../helper/membership.guard');

const router = express.Router();

const viewer = [requireAuth, requireCompanyAttendanceViewer];
const employeePayroll = [requireAuth, requireActiveEmployee];

router.get('/me', ...employeePayroll, asyncHandler(payrollController.listMy));
router.get('/export', ...viewer, asyncHandler(payrollController.exportCsv));
router.get('/', ...viewer, asyncHandler(payrollController.list));

module.exports = router;
