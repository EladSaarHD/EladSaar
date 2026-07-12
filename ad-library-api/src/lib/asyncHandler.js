'use strict';

// Express 4 doesn't forward rejected promises to the error handler, so wrap
// async route handlers with this to route thrown/rejected errors to next().
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
