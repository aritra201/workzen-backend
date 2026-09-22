const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const { AppError } = require('../utils/AppError');

const client = new OAuth2Client(env.google.clientId);

/**
 * Verifies a Google ID token sent by the frontend after a successful
 * "Sign in with Google" flow, and returns the trustworthy identity fields
 * from it. Never trust an email/name passed directly from the client —
 * always re-derive them from the verified token payload.
 */
async function verifyGoogleIdToken(idToken) {
  if (!idToken) {
    throw new AppError('Google idToken is required', 400);
  }

  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: env.google.clientId,
    });
  } catch (err) {
    throw new AppError('Invalid Google token', 401);
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new AppError('Google token did not contain an email', 401);
  }
  if (!payload.email_verified) {
    throw new AppError('Google account email is not verified', 401);
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || null,
    picture: payload.picture || null,
  };
}

module.exports = { verifyGoogleIdToken };
