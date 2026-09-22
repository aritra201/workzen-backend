const express = require('express');
const rateLimit = require('express-rate-limit');
const memberController = require('../controller/member.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireCompanyAdmin } = require('../helper/companyAdmin.helper');

const router = express.Router();

const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many invitations — please try again later.' },
});

router.use(requireAuth, requireCompanyAdmin);

router.get('/', asyncHandler(memberController.list));
router.post('/invitations', inviteLimiter, asyncHandler(memberController.invite));
router.patch('/:memberId', asyncHandler(memberController.updateStatus));

module.exports = router;
