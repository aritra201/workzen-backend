const employeeService = require('../service/employee.service');
const { AppError } = require('../utils/AppError');

function employeeContextFromRequest(req) {
  return {
    userId: req.user._id,
    employeeProfileId: req.employment?.employeeProfile?._id,
  };
}

async function getMyProfile(req, res) {
  const profile = await employeeService.getMyEmployeeProfile(employeeContextFromRequest(req));
  res.status(200).json(profile);
}

async function updateMyProfile(req, res) {
  const profile = await employeeService.updateMyEmployeeProfile({
    ...employeeContextFromRequest(req),
    body: req.body,
  });
  res.status(200).json(profile);
}

async function uploadMyProfilePicture(req, res) {
  const profile = await employeeService.uploadMyEmployeeProfilePicture({
    ...employeeContextFromRequest(req),
    file: req.file,
  });
  res.status(200).json(profile);
}

async function list(req, res) {
  const employees = await employeeService.listEmployees(req.company._id);
  res.status(200).json({ employees });
}

async function invite(req, res) {
  const { employeeName, employeeEmail } = req.body;
  if (!employeeName || !employeeEmail) {
    throw new AppError('employeeName and employeeEmail are required', 400);
  }

  const result = await employeeService.inviteEmployee({
    company: req.company,
    adminUserId: req.user._id,
    employeeName,
    employeeEmail,
  });

  res.status(201).json({
    message: 'Employee invitation sent',
    ...result,
  });
}

async function resendInvite(req, res) {
  const { employeeEmail } = req.body;
  if (!employeeEmail) {
    throw new AppError('employeeEmail is required', 400);
  }

  const result = await employeeService.resendEmployeeInvitation({
    company: req.company,
    adminUserId: req.user._id,
    employeeEmail,
  });

  res.status(200).json({
    message: 'Employee invitation resent',
    ...result,
  });
}

async function updateStatus(req, res) {
  const { isActive } = req.body;
  const employee = await employeeService.setEmployeeActive({
    company: req.company,
    adminUserId: req.user._id,
    employeeId: req.params.employeeId,
    isActive,
  });

  res.status(200).json(employee);
}

module.exports = {
  getMyProfile,
  updateMyProfile,
  uploadMyProfilePicture,
  list,
  invite,
  resendInvite,
  updateStatus,
};
