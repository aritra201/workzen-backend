const { User, Company } = require('../models');
const { AUTH_PROVIDER } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { assertUserCanAuthenticate } = require('./membershipContext.service');
const { issueTokenPair, verifyRefreshToken, signAccessToken, signRefreshToken } = require('../helper/jwt.helper');
const { generateRawTokenAndHash, hashToken } = require('../helper/token.helper');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../helper/email.helper');
const { verifyGoogleIdToken } = require('../helper/google.helper');
const env = require('../config/env');

/**
 * FR-001/002: manual company registration. Creates the User (inactive,
 * unverified) and the Company record together, then emails a verification
 * link. Both writes happen in a transaction so we never end up with a User
 * and no Company (or vice versa) if one write fails.
 */
async function registerCompanyManual({ companyName, email, password }) {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new AppError('An account with this email already exists', 409);
  }

  const session = await User.startSession();
  let user;
  let company;

  try {
    await session.withTransaction(async () => {
      user = new User({
        email,
        password_hash: password, // hashed by the User pre-save hook
        auth_provider: AUTH_PROVIDER.LOCAL,
        is_active: false,
        is_email_verified: false,
      });

      const { rawToken, tokenHash } = generateRawTokenAndHash();
      user.email_verification_token_hash = tokenHash;
      user.email_verification_expires = new Date(
        Date.now() + env.tokenExpiry.emailVerificationHours * 60 * 60 * 1000
      );

      await user.save({ session });

      company = new Company({
        admin_user_id: user._id,
        company_name: companyName,
      });
      await company.save({ session });

      // Send the email inside the try block but after both writes succeed;
      // if sending fails, the transaction below still commits — the user can
      // request a resend (FR-003 allows this).
      await sendVerificationEmail({ to: user.email, rawToken });
    });
  } finally {
    session.endSession();
  }

  return { userId: user._id, companyId: company._id };
}

/**
 * FR-003: consumes an email verification token and activates the account.
 */
async function verifyEmail(rawToken) {
  const tokenHash = hashToken(rawToken);

  const user = await User.findOne({
    email_verification_token_hash: tokenHash,
  }).select('+email_verification_token_hash +email_verification_expires');

  if (!user) {
    throw new AppError('Invalid or already-used verification link', 400);
  }
  if (user.email_verification_expires < new Date()) {
    throw new AppError('Verification link has expired — request a new one', 400);
  }

  user.is_active = true;
  user.is_email_verified = true;
  user.email_verification_token_hash = undefined;
  user.email_verification_expires = undefined;
  await user.save();

  return { userId: user._id };
}

/**
 * FR-003: resend a verification email for a still-inactive local account.
 * Always responds the same way whether or not the email exists, to avoid
 * leaking which emails are registered.
 */
async function resendVerificationEmail(email) {
  const user = await User.findOne({
    email: email.toLowerCase(),
    auth_provider: AUTH_PROVIDER.LOCAL,
  });

  if (!user || user.is_active) {
    return; // silent no-op — see docstring
  }

  const { rawToken, tokenHash } = generateRawTokenAndHash();
  user.email_verification_token_hash = tokenHash;
  user.email_verification_expires = new Date(
    Date.now() + env.tokenExpiry.emailVerificationHours * 60 * 60 * 1000
  );
  await user.save();

  await sendVerificationEmail({ to: user.email, rawToken });
}

/**
 * FR-004/005: Google OAuth signup or login for a company admin.
 * If the Google account is new to WorkZen, creates the User + a Company stub
 * with no company_name yet — the caller (controller) uses `needsCompanyName`
 * to tell the frontend to block the dashboard until FR-005's mandatory step
 * is completed.
 */
async function googleAuthCompanyAdmin(idToken) {
  const { googleId, email } = await verifyGoogleIdToken(idToken);

  let user = await User.findOne({ google_id: googleId });

  if (!user) {
    // Also guard against a pre-existing local account with the same email —
    // don't silently create a second, disconnected identity.
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
          is_active: true, // FR-004: no email verification step for Google
          is_email_verified: true,
        });
        await user.save({ session });

        company = new Company({
          admin_user_id: user._id,
          company_name: null, // FR-005: must be set before dashboard access
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

/**
 * FR-006/009: manual login for any local account (admin, member, or
 * employee — role is determined by whichever profile module looks the
 * user up afterwards, not by this generic auth check).
 */
async function loginManual({ email, password }) {
  const user = await User.findOne({
    email: email.toLowerCase(),
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
    throw new AppError('Please verify your email before logging in', 403);
  }

  return await issueAndPersistTokens(user);
}

/**
 * Generic Google login for an already-linked account (used once the
 * Invitations module exists for member/employee Google sign-in too).
 */
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

/**
 * FR-008: rotates access + refresh tokens. The stored hash of the current
 * refresh token is checked so a previously-issued (and since-rotated) token
 * can't be replayed.
 */
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

/**
 * FR-007: forgot password — always responds the same regardless of whether
 * the email exists, to avoid leaking registered emails.
 */
async function forgotPassword(email) {
  const user = await User.findOne({
    email: email.toLowerCase(),
    auth_provider: AUTH_PROVIDER.LOCAL,
  });

  if (!user) return;

  const { rawToken, tokenHash } = generateRawTokenAndHash();
  user.password_reset_token_hash = tokenHash;
  user.password_reset_expires = new Date(
    Date.now() + env.tokenExpiry.passwordResetMinutes * 60 * 1000
  );
  await user.save();

  await sendPasswordResetEmail({ to: user.email, rawToken });
}

/**
 * FR-008: resets the password for a local account.
 */
async function resetPassword({ rawToken, newPassword }) {
  const tokenHash = hashToken(rawToken);

  const user = await User.findOne({
    password_reset_token_hash: tokenHash,
  }).select('+password_reset_token_hash +password_reset_expires');

  if (!user) {
    throw new AppError('Invalid or already-used reset link', 400);
  }
  if (user.password_reset_expires < new Date()) {
    throw new AppError('Reset link has expired — request a new one', 400);
  }

  user.password_hash = newPassword; // re-hashed by pre-save hook
  user.password_reset_token_hash = undefined;
  user.password_reset_expires = undefined;
  // Invalidate any existing session on password change.
  user.current_refresh_token_hash = undefined;
  await user.save();
}

/**
 * FR-009: issues a fresh access/refresh pair and persists the refresh token's hash
 * on the user document (enabling rotation/revocation in refreshTokens()).
 */
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
  verifyEmail,
  resendVerificationEmail,
  googleAuthCompanyAdmin,
  loginManual,
  loginGoogle,
  refreshTokens,
  forgotPassword,
  resetPassword,
  issueAndPersistTokens,
};
