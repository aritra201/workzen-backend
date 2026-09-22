/**
 * Wraps an async controller/middleware function so a thrown error or
 * rejected promise is forwarded to next(err) instead of crashing the
 * process or hanging the request.
 *
 * Usage: router.post('/x', asyncHandler(controller.doThing));
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
