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

function serializeActivityLog(log, actorEmail = null) {
  return {
    activityLogId: log._id,
    actorUserId: log.actor_user_id,
    actorRole: log.actor_role,
    actorEmail,
    actionType: log.action_type,
    targetType: log.target_type,
    targetId: log.target_id,
    beforeValue: log.before_value ?? null,
    afterValue: log.after_value ?? null,
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

  const actorIds = [...new Set(logs.map((log) => String(log.actor_user_id)))];
  const emailByActorId = await loadActorEmails(actorIds);

  return {
    attendanceId: attendanceObjectId,
    total: logs.length,
    items: logs.map((log) =>
      serializeActivityLog(log, emailByActorId.get(String(log.actor_user_id)) ?? null)
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

  const actor = await User.findById(log.actor_user_id).select('email').lean();
  return serializeActivityLog(log, actor?.email ?? null);
}

module.exports = {
  listAttendanceActivityLogs,
  getAttendanceActivityLogDetail,
};
