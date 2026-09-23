const express = require('express');
const extraShiftController = require('../controller/extraShift.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireCompanyAdmin } = require('../helper/companyAdmin.helper');

const router = express.Router();

router.use(requireAuth, requireCompanyAdmin);

router.get('/', asyncHandler(extraShiftController.list));
router.post('/declare', asyncHandler(extraShiftController.declare));

module.exports = router;
