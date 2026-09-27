const mongoose = require('mongoose');
const { ActivityLog, Attendance, User } = require('../models');
const { AppError } = require('../utils/AppError');
const { parseObjectId } = require('../utils/objectId.helper');

const MAX_LIST_ITEMS = 500;

function parseRequiredAttendanceId(attendanceId) {
  if (attendanceId === undefined || attendanceId === null || attendanceId === '') {
    throw new AppError('attendanceId query parameter is required', 400);
  }
  return parseObjectId(String(attendanceId).trim(), 'attendanceId');
}

function parseRequiredActivityLogId(activityLogId) {
  if (activityLogId === undefined || activityLogId === null || activityLogId === '') {
    throw new AppError('activityLogId query parameter is required', 400);
  }
  return parseObjectId(String(activityLogId).trim(), 'activityLogId');
}

function attendanceLogMatchFilter(attendanceObjectId) {
  const id = new mongoose.Types.ObjectId(attendanceObjectId);
  return {
    $or: [
      { target_type: 'Attendance', target_id: id },
      { 'metadata.attendance_id': id },
    ],
  };
}

function isAttendanceRelatedLog(log) {
  if (log.target_type === 'Attendance') {
    return true;
  }
  return Boolean(log.metadata?.attendance_id);
}

const USER_ID_VALUE_KEYS = ['verified_by', 'declared_by', 'approved_by', 'decided_by'];

function collectUserIdsFromValue(value, ids) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  for (const key of USER_ID_VALUE_KEYS) {
    if (value[key]) {
      ids.add(String(value[key]));
    }
  }
}

function enrichValueWithUserEmails(value, emailById) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const out = { ...value };
  for (const key of USER_ID_VALUE_KEYS) {
    const id = out[key];
    if (!id) {
      continue;
    }
    const email = emailById.get(String(id));
    if (email) {
      out[`${key}_email`] = email;
    }
  }
  return out;
}

function serializeActivityLog(log, actorEmail = null, emailById = null) {
  const beforeValue = log.before_value ?? null;
  const afterValue = log.after_value ?? null;
  return {
    activityLogId: log._id,
    actorUserId: log.actor_user_id,
    actorRole: log.actor_role,
    actorEmail,
    actionType: log.action_type,
    targetType: log.target_type,
    targetId: log.target_id,
    beforeValue: emailById ? enrichValueWithUserEmails(beforeValue, emailById) : beforeValue,
    afterValue: emailById ? enrichValueWithUserEmails(afterValue, emailById) : afterValue,
    metadata: log.metadata ?? null,
    createdAt: log.created_at,
  };
}

async function loadActorEmails(actorUserIds) {
  if (!actorUserIds.length) {
    return new Map();
  }
  const users = await User.find({ _id: { $in: actorUserIds } }).select('email').lean();
  return new Map(users.map((u) => [String(u._id), u.email]));
}

/**
 * All audit entries for one attendance row (modal list — no pagination).
 */
async function listAttendanceActivityLogs(company, attendanceId) {
  const attendanceObjectId = parseRequiredAttendanceId(attendanceId);

  const exists = await Attendance.exists({
    _id: attendanceObjectId,
    company_id: company._id,
  });
  if (!exists) {
    throw new AppError('Attendance record not found', 404);
  }

  const filter = {
    company_id: company._id,
    ...attendanceLogMatchFilter(attendanceObjectId),
  };

  const logs = await ActivityLog.find(filter)
    .sort({ created_at: -1, _id: -1 })
    .limit(MAX_LIST_ITEMS)
    .lean();

  const actorIds = new Set(logs.map((log) => String(log.actor_user_id)));
  for (const log of logs) {
    collectUserIdsFromValue(log.before_value, actorIds);
    collectUserIdsFromValue(log.after_value, actorIds);
  }
  const emailByActorId = await loadActorEmails([...actorIds]);

  return {
    attendanceId: attendanceObjectId,
    total: logs.length,
    items: logs.map((log) =>
      serializeActivityLog(
        log,
        emailByActorId.get(String(log.actor_user_id)) ?? null,
        emailByActorId
      )
    ),
  };
}

async function getAttendanceActivityLogDetail(company, activityLogId) {
  const id = parseRequiredActivityLogId(activityLogId);

  const log = await ActivityLog.findOne({
    _id: id,
    company_id: company._id,
  }).lean();

  if (!log || !isAttendanceRelatedLog(log)) {
    throw new AppError('Activity log entry not found', 404);
  }

  const relatedIds = new Set([String(log.actor_user_id)]);
  collectUserIdsFromValue(log.before_value, relatedIds);
  collectUserIdsFromValue(log.after_value, relatedIds);
  const emailById = await loadActorEmails([...relatedIds]);

  return serializeActivityLog(
    log,
    emailById.get(String(log.actor_user_id)) ?? null,
    emailById
  );
}

module.exports = {
  listAttendanceActivityLogs,
  getAttendanceActivityLogDetail,
};
