const { User } = require('../models');
const { AppError } = require('../utils/AppError');
const { fcmRefIdFromUserId } = require('../helper/fcmRefId.helper');
const { linkFcmSubscriberProfile, isFcmConfigured, createFcmPlatformSubscriber } = require('./fcmClient.service');

async function registerFcmSubscriberForUser({ userId, subscriberId, token, pageUrl, userAgent }) {
  if (!isFcmConfigured()) {
    return { linked: false, reason: 'fcm_not_configured' };
  }

  const trimmedToken = typeof token === 'string' ? token.trim() : '';
  let id = subscriberId != null && subscriberId !== '' ? Number(subscriberId) : null;

  if (!Number.isInteger(id) || id < 1) {
    if (!trimmedToken) {
      throw new AppError('subscriberId or token is required', 400);
    }
    id = await createFcmPlatformSubscriber({
      token: trimmedToken,
      pageUrl,
      userAgent,
    });
    if (!id) {
      throw new AppError('Could not register push subscription on FCM platform', 502);
    }
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (!user.fcm_ref_id) {
    user.fcm_ref_id = fcmRefIdFromUserId(user._id);
  }

  const subscriberIds = new Set(user.fcm_subscriber_ids || []);
  subscriberIds.add(id);
  user.fcm_subscriber_ids = [...subscriberIds];

  if (trimmedToken) {
    const tokens = new Set(user.fcm_tokens || []);
    tokens.add(trimmedToken);
    user.fcm_tokens = [...tokens];
  }

  await user.save();

  let fcmPlatformLinked = false;
  let platformError = null;

  try {
    await linkFcmSubscriberProfile({
      subscriberId: id,
      user,
      displayName: user.email,
    });
    fcmPlatformLinked = true;
  } catch (err) {
    platformError = err?.message || String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[fcm] Platform subscriber link failed for user ${user._id} subscriber ${id}:`,
      platformError
    );
  }

  if (!trimmedToken && !fcmPlatformLinked) {
    throw new AppError(
      platformError ||
        'Could not link push subscription — allow notifications and try again',
      400
    );
  }

  return {
    linked: true,
    subscriberId: id,
    fcmRefId: user.fcm_ref_id,
    fcmPlatformLinked,
    ...(platformError && !fcmPlatformLinked ? { platformError } : {}),
  };
}

module.exports = { registerFcmSubscriberForUser };
