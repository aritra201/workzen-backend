const express = require('express');
const rateLimit = require('express-rate-limit');
const memberInvitationController = require('../controller/memberInvitation.controller');
const employeeInvitationController = require('../controller/employeeInvitation.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

const acceptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts — please try again later.' },
});

router.get('/members/preview', asyncHandler(memberInvitationController.preview));
router.post('/members/accept', acceptLimiter, asyncHandler(memberInvitationController.acceptManual));
router.post(
  '/members/accept/google',
  acceptLimiter,
  asyncHandler(memberInvitationController.acceptGoogle)
);

router.get('/employees/preview', asyncHandler(employeeInvitationController.preview));
router.post(
  '/employees/accept',
  acceptLimiter,
  asyncHandler(employeeInvitationController.acceptManual)
);
router.post(
  '/employees/accept/google',
  acceptLimiter,
  asyncHandler(employeeInvitationController.acceptGoogle)
);

module.exports = router;
