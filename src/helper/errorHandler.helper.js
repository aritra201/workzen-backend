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

  // eslint-disable-next-line no-console
  console.error('[Unhandled error]', err);
  return res.status(500).json({ message: 'Something went wrong' });
}

module.exports = errorHandler;
