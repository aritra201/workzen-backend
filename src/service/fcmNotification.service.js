const { User, Company, EmployeeProfile } = require('../models');
const { SHIFT_KEY } = require('../utils/enums');
const env = require('../config/env');
const { sendTemplateNotification, isFcmConfigured } = require('./fcmClient.service');

const SHIFT_LABELS = {
  [SHIFT_KEY.DAY]: 'Day shift',
  [SHIFT_KEY.NIGHT]: 'Night shift',
  [SHIFT_KEY.EXTRA_DAY]: 'Extra day shift',
  [SHIFT_KEY.EXTRA_NIGHT]: 'Extra night shift',
  [SHIFT_KEY.HALF_SHIFT_DAY]: 'Half day shift',
  [SHIFT_KEY.HALF_SHIFT_NIGHT]: 'Half night shift',
};

function shiftLabel(shiftKey) {
  return SHIFT_LABELS[shiftKey] || String(shiftKey || 'shift');
}

function buildTemplateVariables({ title, body, path }) {
  const origin = env.fcm.webOrigin || env.clientUrl;
  const url = path ? `${origin}${path.startsWith('/') ? path : `/${path}`}` : origin;
  return {
    value_1: title,
    value_2: body,
    value_3: url,
    ...(env.fcm.notificationIconUrl ? { value_4: env.fcm.notificationIconUrl } : {}),
    ...(env.fcm.notificationBannerUrl ? { value_5: env.fcm.notificationBannerUrl } : {}),
  };
}

async function collectFcmTokensForUserIds(userIds) {
  const uniqueIds = [...new Set(userIds.map((id) => String(id)).filter(Boolean))];
  if (!uniqueIds.length) {
    return [];
  }

  const users = await User.find({ _id: { $in: uniqueIds } }).select('fcm_tokens');
  const tokens = [];
  for (const user of users) {
    for (const t of user.fcm_tokens || []) {
      if (t && String(t).trim()) {
        tokens.push(String(t).trim());
      }
    }
  }
  return [...new Set(tokens)];
}

async function notifyUserIds({ userIds, campaignName, title, body, path }) {
  if (!isFcmConfigured()) {
    return;
  }

  try {
    const tokens = await collectFcmTokensForUserIds(userIds);
    if (!tokens.length) {
      return;
    }

    await sendTemplateNotification({
      name: campaignName,
      tokens,
      templateVariables: buildTemplateVariables({ title, body, path }),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[fcm]', campaignName, err?.message || err);
  }
}

async function notifyCompanyAdmin({ companyId, campaignName, title, body, path }) {
  const company = await Company.findById(companyId).select('admin_user_id company_name');
  if (!company?.admin_user_id) {
    return;
  }
  await notifyUserIds({
    userIds: [company.admin_user_id],
    campaignName,
    title,
    body,
    path,
  });
}

async function notifyEmployeeUser({ employeeProfileId, campaignName, title, body, path }) {
  const employee = await EmployeeProfile.findById(employeeProfileId).select('user_id employee_name');
  if (!employee?.user_id) {
    return;
  }
  await notifyUserIds({
    userIds: [employee.user_id],
    campaignName,
    title,
    body,
    path,
  });
}

async function notifyAdminEmployeeMarkedShift({
  companyId,
  employeeName,
  dateKey,
  shiftKey,
}) {
  const name = employeeName || 'An employee';
  await notifyCompanyAdmin({
    companyId,
    campaignName: `workzen_attendance_marked_${Date.now()}`,
    title: 'Attendance marked',
    body: `${name} marked ${shiftLabel(shiftKey)} for ${dateKey}.`,
    path: '/admin/verification',
  });
}

async function notifyEmployeeShiftVerified({
  employeeProfileId,
  dateKey,
  shiftKey,
}) {
  await notifyEmployeeUser({
    employeeProfileId,
    campaignName: `workzen_shift_verified_${Date.now()}`,
    title: 'Shift verified',
    body: `Your ${shiftLabel(shiftKey)} on ${dateKey} was verified.`,
    path: '/employee/attendance/history',
  });
}

async function notifyAdminUnlockRequested({
  companyId,
  employeeName,
  dateKey,
}) {
  const name = employeeName || 'An employee';
  await notifyCompanyAdmin({
    companyId,
    campaignName: `workzen_unlock_requested_${Date.now()}`,
    title: 'Unlock request',
    body: `${name} requested to unlock attendance for ${dateKey}.`,
    path: '/admin/unlock-requests',
  });
}

async function notifyEmployeeUnlockDecision({
  employeeProfileId,
  dateKey,
  approved,
  decisionNote,
}) {
  const statusText = approved ? 'approved' : 'denied';
  const note = decisionNote ? ` Note: ${decisionNote}` : '';
  await notifyEmployeeUser({
    employeeProfileId,
    campaignName: `workzen_unlock_${statusText}_${Date.now()}`,
    title: `Unlock ${statusText}`,
    body: `Your unlock request for ${dateKey} was ${statusText}.${note}`,
    path: approved ? '/employee/attendance' : '/employee/unlock-requests',
  });
}

module.exports = {
  notifyAdminEmployeeMarkedShift,
  notifyEmployeeShiftVerified,
  notifyAdminUnlockRequested,
  notifyEmployeeUnlockDecision,
};
