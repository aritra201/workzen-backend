const express = require('express');
const rateLimit = require('express-rate-limit');
const unlockRequestController = require('../controller/unlockRequest.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireCompanyAdmin } = require('../helper/companyAdmin.helper');
const { requireActiveEmployee } = require('../helper/membership.guard');

const router = express.Router();

const employeeUnlock = [requireAuth, requireActiveEmployee];
const adminUnlock = [requireAuth, requireCompanyAdmin];

const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many unlock requests — please try again later.' },
});

router.post('/', ...employeeUnlock, createLimiter, asyncHandler(unlockRequestController.create));
router.get('/me', ...employeeUnlock, asyncHandler(unlockRequestController.listMine));
router.delete('/me/:requestId', ...employeeUnlock, asyncHandler(unlockRequestController.cancelMine));

router.get('/', ...adminUnlock, asyncHandler(unlockRequestController.list));
router.post('/decide', ...adminUnlock, asyncHandler(unlockRequestController.decide));

module.exports = router;
