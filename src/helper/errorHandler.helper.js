const { AppError } = require('../utils/AppError');

/**
 * Express error-handling middleware (must be registered last, with 4 args).
 * Converts AppError instances into their intended status code; anything
 * else is logged and returned as a generic 500 so internals never leak.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (typeof err.message === 'string' && err.message.startsWith('Email not sent:')) {
    return res.status(503).json({ message: err.message });
  }

  if (err.code === 'ETIMEDOUT' && err.command === 'CONN') {
    return res.status(503).json({
      message:
        'Email could not be sent (SMTP connection timed out). On Render free tier use RESEND_API_KEY instead of Gmail SMTP.',
    });
  }

  // eslint-disable-next-line no-console
  console.error('[Unhandled error]', err);
  return res.status(500).json({ message: 'Something went wrong' });
}

module.exports = errorHandler;
