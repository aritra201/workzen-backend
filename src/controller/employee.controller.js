const { Company } = require('../models');
const employeeService = require('../service/employee.service');
const { AppError } = require('../utils/AppError');
const { parseObjectId } = require('../utils/objectId.helper');

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
  const { page, limit, employeeId } = req.query;
  if (page != null || limit != null || employeeId) {
    const data = await employeeService.listEmployeesPaginated(req.company._id, {
      page,
      limit,
      employeeId,
    });
    res.status(200).json(data);
    return;
  }
  const employees = await employeeService.listEmployees(req.company._id);
  res.status(200).json({ employees });
}

async function listPresent(req, res) {
  const { page, limit, employeeId } = req.query;
  const data = await employeeService.listPresentEmployees(req.company._id, {
    page,
    limit,
    employeeId,
  });
  res.status(200).json(data);
}

async function listDropdownForAdmin(req, res) {
  const employees = await employeeService.listEmployeeDropdownOptions(req.company._id);
  res.status(200).json({ employees });
}

async function listDropdown(req, res) {
  const { companyId } = req.query;
  if (!companyId) {
    throw new AppError('companyId is required', 400);
  }

  const companyObjectId = parseObjectId(companyId, 'companyId');
  const company = await Company.findById(companyObjectId);
  if (!company) {
    throw new AppError('Company not found', 404);
  }

  const employees = await employeeService.listEmployeeDropdownOptions(company._id);
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
  listPresent,
  listDropdown,
  listDropdownForAdmin,
  invite,
  resendInvite,
  updateStatus,
};
