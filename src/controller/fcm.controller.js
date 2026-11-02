const fcmLinkService = require('../service/fcmLink.service');
const env = require('../config/env');
const { isFcmConfigured } = require('../service/fcmClient.service');
const { AppError } = require('../utils/AppError');
async function linkSubscriber(req, res) {
  const { subscriberId, token } = req.body;
  if (
    (subscriberId === undefined || subscriberId === null || subscriberId === '') &&
    (!token || !String(token).trim())
  ) {
    throw new AppError('subscriberId or token is required', 400);
  }

  const result = await fcmLinkService.registerFcmSubscriberForUser({
    userId: req.user._id,
    subscriberId,
    token,
    pageUrl: req.get('referer') || undefined,
    userAgent: req.get('user-agent') || undefined,
  });

  res.status(200).json(result);
}

async function getFcmStatus(req, res) {
  res.status(200).json({
    enabled: isFcmConfigured(),
    channelId: isFcmConfigured() ? env.fcm.channelId : null,
  });
}

module.exports = { linkSubscriber, getFcmStatus };
