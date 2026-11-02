const express = require('express');
const fcmController = require('../controller/fcm.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');

const router = express.Router();

router.get('/status', requireAuth, asyncHandler(fcmController.getFcmStatus));
router.post('/link', requireAuth, asyncHandler(fcmController.linkSubscriber));

module.exports = router;
