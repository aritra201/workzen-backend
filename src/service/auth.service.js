const { User, Company } = require('../models');
const { AUTH_PROVIDER } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { assertUserCanAuthenticate } = require('./membershipContext.service');
const { verifyRefreshToken, signAccessToken, signRefreshToken } = require('../helper/jwt.helper');
const { hashToken } = require('../helper/token.helper');
const { generateNumericOtp, hashOtp } = require('../helper/otp.helper');
const { sendVerificationOtpEmail, sendPasswordResetOtpEmail } = require('../helper/email.helper');
const { verifyGoogleIdToken } = require('../helper/google.helper');
const env = require('../config/env');

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function emailVerificationExpiresAt() {
  return new Date(
    Date.now() + env.tokenExpiry.emailVerificationOtpMinutes * 60 * 1000
  );
}

function passwordResetExpiresAt() {
  return new Date(Date.now() + env.tokenExpiry.passwordResetOtpMinutes * 60 * 1000);
}

async function issueAndStoreEmailVerificationOtp(user) {
  const { rawOtp, otpHash } = generateNumericOtp();
  user.email_verification_token_hash = otpHash;
  user.email_verification_expires = emailVerificationExpiresAt();
  await user.save();
  await sendVerificationOtpEmail({ to: user.email, otp: rawOtp });
}

async function issueAndStorePasswordResetOtp(user) {
  const { rawOtp, otpHash } = generateNumericOtp();
  user.password_reset_token_hash = otpHash;
  user.password_reset_expires = passwordResetExpiresAt();
  await user.save();
  await sendPasswordResetOtpEmail({ to: user.email, otp: rawOtp });
}

/**
 * FR-001/002: manual company registration. Sends a 4-digit email OTP (web + mobile).
 */
async function registerCompanyManual({ companyName, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new AppError('An account with this email already exists', 409);
  }

  const session = await User.startSession();
  let user;
  let company;

  try {
    await session.withTransaction(async () => {
      user = new User({
        email: normalizedEmail,
        password_hash: password,
        auth_provider: AUTH_PROVIDER.LOCAL,
        is_active: false,
        is_email_verified: false,
      });

      const { rawOtp, otpHash } = generateNumericOtp();
      user.email_verification_token_hash = otpHash;
      user.email_verification_expires = emailVerificationExpiresAt();

      await user.save({ session });

      company = new Company({
        admin_user_id: user._id,
        company_name: companyName,
      });
      await company.save({ session });

      await sendVerificationOtpEmail({ to: user.email, otp: rawOtp });
    });
  } finally {
    session.endSession();
  }

  return { userId: user._id, companyId: company._id, email: user.email };
}

/**
 * FR-003: verify email with 4-digit OTP.
 */
async function verifyEmailWithOtp({ email, otp }) {
  const normalizedEmail = normalizeEmail(email);
  const otpHash = hashOtp(otp);

  const user = await User.findOne({
    email: normalizedEmail,
    auth_provider: AUTH_PROVIDER.LOCAL,
  }).select('+email_verification_token_hash +email_verification_expires');

  if (!user || !user.email_verification_token_hash) {
    throw new AppError('Invalid verification code', 400);
  }
  if (user.email_verification_expires < new Date()) {
    throw new AppError('Verification code has expired — request a new one', 400);
  }
  if (user.email_verification_token_hash !== otpHash) {
    throw new AppError('Invalid verification code', 400);
  }

  user.is_active = true;
  user.is_email_verified = true;
  user.email_verification_token_hash = undefined;
  user.email_verification_expires = undefined;
  await user.save();

  return { userId: user._id };
}

async function resendVerificationEmail(email) {
  const user = await User.findOne({
    email: normalizeEmail(email),
    auth_provider: AUTH_PROVIDER.LOCAL,
  }).select('+email_verification_token_hash +email_verification_expires');

  if (!user || user.is_active) {
    return;
  }

  await issueAndStoreEmailVerificationOtp(user);
}

async function googleAuthCompanyAdmin(idToken) {
  const { googleId, email } = await verifyGoogleIdToken(idToken);

  let user = await User.findOne({ google_id: googleId });

  if (!user) {
    const existingLocal = await User.findOne({ email });
    if (existingLocal) {
      throw new AppError(
        'An account with this email already exists — log in with your password instead',
        409
      );
    }

    const session = await User.startSession();
    let company;
    try {
      await session.withTransaction(async () => {
        user = new User({
          email,
          auth_provider: AUTH_PROVIDER.GOOGLE,
          google_id: googleId,
          is_active: true,
          is_email_verified: true,
        });
        await user.save({ session });

        company = new Company({
          admin_user_id: user._id,
          company_name: null,
        });
        await company.save({ session });
      });
    } finally {
      session.endSession();
    }

    const tokens = await issueAndPersistTokens(user);
    return { ...tokens, needsCompanyName: true };
  }

  if (!user.is_active) {
    throw new AppError('Account is not active', 403);
  }

  const company = await Company.findOne({ admin_user_id: user._id });
  const tokens = await issueAndPersistTokens(user);
  return { ...tokens, needsCompanyName: !!(company && !company.company_name) };
}

async function loginManual({ email, password }) {
  const user = await User.findOne({
    email: normalizeEmail(email),
    auth_provider: AUTH_PROVIDER.LOCAL,
  }).select('+password_hash');

  const invalidCredentialsError = new AppError('Invalid email or password', 401);

  if (!user) {
    throw invalidCredentialsError;
  }

  const passwordMatches = await user.comparePassword(password);
  if (!passwordMatches) {
    throw invalidCredentialsError;
  }

  if (!user.is_active) {
    throw new AppError('Please verify your email with the OTP we sent before logging in', 403);
  }

  return await issueAndPersistTokens(user);
}

async function loginGoogle(idToken) {
  const { googleId } = await verifyGoogleIdToken(idToken);

  const user = await User.findOne({ google_id: googleId });
  if (!user) {
    throw new AppError('No account found for this Google identity', 404);
  }
  if (!user.is_active) {
    throw new AppError('Account is not active', 403);
  }

  return await issueAndPersistTokens(user);
}

async function refreshTokens(rawRefreshToken) {
  const payload = verifyRefreshToken(rawRefreshToken);

  const user = await User.findById(payload.sub).select('+current_refresh_token_hash');
  if (!user) {
    throw new AppError('User no longer exists', 401);
  }

  const presentedHash = hashToken(rawRefreshToken);
  if (user.current_refresh_token_hash !== presentedHash) {
    throw new AppError('Refresh token has been rotated or revoked', 401);
  }

  return await issueAndPersistTokens(user);
}

async function forgotPassword(email) {
  const user = await User.findOne({
    email: normalizeEmail(email),
    auth_provider: AUTH_PROVIDER.LOCAL,
  }).select('+password_reset_token_hash +password_reset_expires');

  if (!user) {
    return;
  }

  await issueAndStorePasswordResetOtp(user);
}

async function resetPasswordWithOtp({ email, otp, newPassword }) {
  const normalizedEmail = normalizeEmail(email);
  const otpHash = hashOtp(otp);

  const user = await User.findOne({
    email: normalizedEmail,
    auth_provider: AUTH_PROVIDER.LOCAL,
  }).select('+password_reset_token_hash +password_reset_expires');

  if (!user || !user.password_reset_token_hash) {
    throw new AppError('Invalid reset code', 400);
  }
  if (user.password_reset_expires < new Date()) {
    throw new AppError('Reset code has expired — request a new one', 400);
  }
  if (user.password_reset_token_hash !== otpHash) {
    throw new AppError('Invalid reset code', 400);
  }

  user.password_hash = newPassword;
  user.password_reset_token_hash = undefined;
  user.password_reset_expires = undefined;
  user.current_refresh_token_hash = undefined;
  await user.save();
}

async function issueAndPersistTokens(user) {
  await assertUserCanAuthenticate(user);

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  user.current_refresh_token_hash = hashToken(refreshToken);
  await user.save();

  return { accessToken, refreshToken, userId: user._id };
}

module.exports = {
  registerCompanyManual,
  verifyEmailWithOtp,
  resendVerificationEmail,
  googleAuthCompanyAdmin,
  loginManual,
  loginGoogle,
  refreshTokens,
  forgotPassword,
  resetPasswordWithOtp,
  issueAndPersistTokens,
};
