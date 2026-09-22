const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controller/auth.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');

const router = express.Router();

// FR-091 (NFR): rate limit auth endpoints that are attractive to abuse
// (brute-force login, invite spam via resend/forgot-password).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts — please try again later.' },
});

router.post('/register', authLimiter, asyncHandler(authController.register));
router.get('/verify-email', asyncHandler(authController.verifyEmail));
router.post('/resend-verification', authLimiter, asyncHandler(authController.resendVerification));

router.post('/google', authLimiter, asyncHandler(authController.googleAuth));
router.post('/login', authLimiter, asyncHandler(authController.login));
router.post('/login/google', authLimiter, asyncHandler(authController.loginGoogle));

router.post('/refresh', asyncHandler(authController.refresh));

router.post('/forgot-password', authLimiter, asyncHandler(authController.forgotPassword));
router.post('/reset-password', authLimiter, asyncHandler(authController.resetPassword));

router.get('/me', requireAuth, asyncHandler(authController.me));

module.exports = router;
