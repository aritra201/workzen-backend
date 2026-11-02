const env = require('../config/env');

function isFcmConfigured() {
  const { fcm } = env;
  return Boolean(
    fcm.enabled &&
      fcm.apiBaseUrl &&
      fcm.channelId > 0 &&
      fcm.orgApiKey &&
      fcm.orgApiSecret
  );
}

async function fcmFetch(path, { method = 'GET', body } = {}) {
  const url = `${env.fcm.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    'Content-Type': 'application/json',
    channelid: String(env.fcm.channelId),
    'x-api-key': env.fcm.orgApiKey,
    'x-api-secret': env.fcm.orgApiSecret,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { message: text };
  }

  if (!response.ok) {
    const message =
      parsed?.message || parsed?.error || `FCM API ${response.status}: ${text.slice(0, 200)}`;
    const err = new Error(message);
    err.statusCode = response.status;
    err.fcmBody = parsed;
    throw err;
  }

  return parsed;
}

/** Standard text notification — omit icon/banner URLs so FCM does not show a big picture. */
function templateDetailsFromVariables(templateVariables) {
  const tv = templateVariables && typeof templateVariables === 'object' ? templateVariables : {};
  const landing = tv.value_3 || env.fcm.webOrigin || env.clientUrl || '';
  const details = {
    title: tv.value_1 || 'WorkZen',
    content: tv.value_2 || '',
    landing_page_url: landing,
    primary_button_name: 'Open',
    primary_button_link: landing,
    primary_button_new_tab: 'Y',
    expire_in: env.fcm.expireInMinutes,
    is_active: true,
  };

  const icon = (tv.value_4 || env.fcm.notificationIconUrl || '').trim();
  const banner = (tv.value_5 || env.fcm.notificationBannerUrl || '').trim();
  if (icon) {
    details.notification_icon_link = icon;
  }
  if (banner) {
    details.banner_image_link = banner;
  }

  return details;
}

/**
 * Prod FCM API only (see repo external.service.js — do not change that server):
 * POST /send-auto-notification with tokens + templateDetails.
 */
async function sendTemplateNotification({ name, tokens, templateVariables }) {
  if (!isFcmConfigured()) {
    return { skipped: true, reason: 'fcm_not_configured' };
  }

  const tv =
    templateVariables && typeof templateVariables === 'object' ? templateVariables : {};

  const uniqueTokens = [...new Set((tokens || []).map((t) => String(t).trim()).filter(Boolean))];
  if (!uniqueTokens.length) {
    return { skipped: true, reason: 'no_tokens' };
  }

  const payload = {
    name: name || `workzen_${Date.now()}`,
    status: 'sent',
    tokens: uniqueTokens,
    templateDetails: templateDetailsFromVariables(tv),
  };

  const result = await fcmFetch('/send-auto-notification', {
    method: 'POST',
    body: payload,
  });

  return { sent: true, mode: 'send_auto_notification', fcmResponse: result };
}

async function linkFcmSubscriberProfile({ subscriberId, user, displayName }) {
  if (!isFcmConfigured()) {
    return { skipped: true, reason: 'fcm_not_configured' };
  }

  const id = Number(subscriberId);
  if (!Number.isInteger(id) || id < 1) {
    const err = new Error('Invalid subscriberId');
    err.statusCode = 400;
    throw err;
  }

  return fcmFetch(`/subscriber/${id}`, {
    method: 'PUT',
    body: {
      name: displayName || null,
      email: user.email || null,
      ref_id: user.fcm_ref_id,
      subscriber_type: 'registered',
    },
  });
}

async function createFcmPlatformSubscriber({ token, pageUrl, userAgent }) {
  if (!isFcmConfigured()) {
    return null;
  }

  const trimmed = String(token || '').trim();
  if (!trimmed) {
    return null;
  }

  const form = new FormData();
  form.append('token', trimmed);
  form.append('channel', String(env.fcm.channelId));
  form.append('subscriber_type', 'anonymous');
  form.append('url', pageUrl || env.fcm.webOrigin || env.clientUrl || '');
  form.append('browser', userAgent ? String(userAgent).slice(0, 512) : 'WorkZen');
  form.append('os', 'web');

  const response = await fetch(`${env.fcm.apiBaseUrl}/subscriber`, {
    method: 'POST',
    body: form,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const message = parsed?.message || text || `FCM subscriber create ${response.status}`;
    const err = new Error(message);
    err.statusCode = response.status;
    throw err;
  }

  const id = parsed?.data?.id ?? parsed?.data?.subscriber?.id ?? parsed?.id;
  const num = Number(id);
  return Number.isInteger(num) && num > 0 ? num : null;
}

module.exports = {
  isFcmConfigured,
  sendTemplateNotification,
  linkFcmSubscriberProfile,
  createFcmPlatformSubscriber,
};
