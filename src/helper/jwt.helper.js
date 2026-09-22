const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError } = require('../utils/AppError');

/**
 * Access token payload carries just enough to authorize a request without a
 * DB round trip: user id, whether the account is active, and — once the
 * Company/Employee/Member module exists — the company_id + role for that
 * membership. For now (Auth module only) we keep it to identity fields.
 */
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      is_active: user.is_active,
    },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessTtl }
  );
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user._id.toString() }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshTtl,
  });
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwt.accessSecret);
  } catch (err) {
    throw new AppError('Invalid or expired access token', 401);
  }
}

function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, env.jwt.refreshSecret);
  } catch (err) {
    throw new AppError('Invalid or expired refresh token', 401);
  }
}

function issueTokenPair(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  issueTokenPair,
};
