'use strict';

const { ApiError } = require('../lib/errors');

// Turns thrown errors into a consistent JSON envelope. Known ApiError
// subclasses map to their status/code; anything else is a 500. Upstream
// diagnostics are logged server-side but not leaked to the client.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      console.error(`[${err.code}] ${err.message}`);
    }
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

  console.error('[internal_error]', err && err.stack ? err.stack : err);
  return res
    .status(500)
    .json({ error: { code: 'internal_error', message: 'Internal server error' } });
}

module.exports = errorHandler;
