/**
 * Standard application error. Controllers/middleware read `statusCode` to
 * set the HTTP response; anything not an AppError is treated as an
 * unexpected 500 by the global error handler.
 */
class AppError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { AppError };
