const employeeInvitationService = require('../service/employeeInvitation.service');
const { AppError } = require('../utils/AppError');

async function preview(req, res) {
  const { token } = req.query;
  if (!token) {
    throw new AppError('token is required', 400);
  }

  const data = await employeeInvitationService.getEmployeeInvitationPreview(token);
  res.status(200).json(data);
}

async function acceptManual(req, res) {
  const { token, password } = req.body;
  if (!token || !password) {
    throw new AppError('token and password are required', 400);
  }

  const result = await employeeInvitationService.acceptEmployeeInvitationManual({
    rawToken: token,
    password,
  });

  res.status(200).json({
    message: 'Invitation accepted — welcome to WorkZen',
    ...result,
  });
}

async function acceptGoogle(req, res) {
  const { token, idToken, employeeName } = req.body;
  if (!token || !idToken) {
    throw new AppError('token and idToken are required', 400);
  }

  const result = await employeeInvitationService.acceptEmployeeInvitationGoogle({
    rawToken: token,
    idToken,
    employeeName,
  });

  res.status(200).json({
    message: 'Invitation accepted — welcome to WorkZen',
    ...result,
  });
}

module.exports = {
  preview,
  acceptManual,
  acceptGoogle,
};
