const authService = require('../service/auth.service');
const { resolveMemberships } = require('../service/membershipContext.service');
const { AppError } = require('../utils/AppError');

async function register(req, res) {
  const { companyName, email, password } = req.body;

  if (!companyName || !email || !password) {
    throw new AppError('companyName, email, and password are required', 400);
  }
  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const result = await authService.registerCompanyManual({ companyName, email, password });

  res.status(201).json({
    message: 'Account created. Check your email to verify your account.',
    userId: result.userId,
    companyId: result.companyId,
  });
}

async function verifyEmail(req, res) {
  const { token } = req.query;
  if (!token) {
    throw new AppError('token is required', 400);
  }

  await authService.verifyEmail(token);
  res.status(200).json({ message: 'Email verified — you can now log in.' });
}

async function resendVerification(req, res) {
  const { email } = req.body;
  if (!email) {
    throw new AppError('email is required', 400);
  }

  await authService.resendVerificationEmail(email);
  // Deliberately generic response — see service docstring.
  res.status(200).json({
    message: 'If that email is registered and unverified, a new link has been sent.',
  });
}

async function googleAuth(req, res) {
  const { idToken } = req.body;
  if (!idToken) {
    throw new AppError('idToken is required', 400);
  }

  const result = await authService.googleAuthCompanyAdmin(idToken);
  res.status(200).json(result);
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    throw new AppError('email and password are required', 400);
  }

  const result = await authService.loginManual({ email, password });
  res.status(200).json(result);
}

async function loginGoogle(req, res) {
  const { idToken } = req.body;
  if (!idToken) {
    throw new AppError('idToken is required', 400);
  }

  const result = await authService.loginGoogle(idToken);
  res.status(200).json(result);
}

async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    throw new AppError('refreshToken is required', 400);
  }

  const result = await authService.refreshTokens(refreshToken);
  res.status(200).json(result);
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) {
    throw new AppError('email is required', 400);
  }

  await authService.forgotPassword(email);
  res.status(200).json({
    message: 'If that email is registered, a password reset link has been sent.',
  });
}

async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    throw new AppError('token and newPassword are required', 400);
  }
  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  await authService.resetPassword({ rawToken: token, newPassword });
  res.status(200).json({ message: 'Password updated — you can now log in.' });
}

async function me(req, res) {
  const { _id, email, auth_provider, is_active, is_email_verified } = req.user;
  const memberships = await resolveMemberships(_id);

  res.status(200).json({
    _id,
    email,
    auth_provider,
    is_active,
    is_email_verified,
    memberships,
  });
}

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  googleAuth,
  login,
  loginGoogle,
  refresh,
  forgotPassword,
  resetPassword,
  me,
};
