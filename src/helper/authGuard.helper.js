const { verifyAccessToken } = require('./jwt.helper');
const { AppError } = require('../utils/AppError');
const { User } = require('../models');

/**
 * Verifies the Authorization: Bearer <token> header, loads the user, and
 * attaches it to req.user. Rejects if the token is invalid/expired or the
 * account is deactivated since the token was issued.
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new AppError('Missing or malformed Authorization header', 401);
    }

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);

    if (!user) {
      throw new AppError('User no longer exists', 401);
    }
    if (!user.is_active) {
      throw new AppError('Account is not active', 403);
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAuth };
