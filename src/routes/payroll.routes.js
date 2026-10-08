const express = require('express');
const payrollController = require('../controller/payroll.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireCompanyAttendanceViewer } = require('../helper/companyAttendanceAccess.helper');

const router = express.Router();

const viewer = [requireAuth, requireCompanyAttendanceViewer];

router.get('/', ...viewer, asyncHandler(payrollController.list));

module.exports = router;
