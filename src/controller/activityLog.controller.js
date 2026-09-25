const activityLogService = require('../service/activityLog.service');

async function listForAttendance(req, res) {
  const { attendanceId } = req.query;
  const data = await activityLogService.listAttendanceActivityLogs(req.company, attendanceId);
  res.status(200).json(data);
}

async function getDetail(req, res) {
  const activityLogId = req.query.activityLogId ?? req.query.activity_log_id;
  const data = await activityLogService.getAttendanceActivityLogDetail(
    req.company,
    activityLogId
  );
  res.status(200).json(data);
}

module.exports = {
  listForAttendance,
  getDetail,
};
