const unlockRequestService = require('../service/unlockRequest.service');
const { AppError } = require('../utils/AppError');

function employeeFromRequest(req) {
  return req.employment.employeeProfile;
}

async function create(req, res) {
  const { attendanceId } = req.body;
  if (!attendanceId) {
    throw new AppError('attendanceId is required', 400);
  }

  const request = await unlockRequestService.createUnlockRequest({
    employeeProfile: employeeFromRequest(req),
    attendanceId,
  });

  res.status(201).json({
    message: 'Unlock request submitted',
    request,
  });
}

async function listMine(req, res) {
  const { status, startDate, endDate, page, limit } = req.query;
  const result = await unlockRequestService.listMyUnlockRequests(employeeFromRequest(req), {
    status,
    startDate,
    endDate,
    page,
    limit,
  });
  res.status(200).json(result);
}

async function cancelMine(req, res) {
  const result = await unlockRequestService.cancelMyUnlockRequest(
    employeeFromRequest(req),
    req.params.requestId
  );
  res.status(200).json(result);
}

async function list(req, res) {
  const { status, employeeId, startDate, endDate, page, limit } = req.query;
  const result = await unlockRequestService.listUnlockRequestsForAdmin(req.company, {
    status,
    employeeId,
    startDate,
    endDate,
    page,
    limit,
  });
  res.status(200).json(result);
}

async function decide(req, res) {
  const { attendanceId, status, decisionNote } = req.body;
  if (!attendanceId || !status) {
    throw new AppError('attendanceId and status are required', 400);
  }

  const request = await unlockRequestService.decideUnlockRequest({
    company: req.company,
    adminUserId: req.user._id,
    attendanceId,
    status,
    decisionNote,
  });

  const approved = request.status === 'approved';
  res.status(200).json({
    message: approved ? 'Unlock request approved' : 'Unlock request denied',
    request,
  });
}

module.exports = {
  create,
  listMine,
  cancelMine,
  list,
  decide,
};
