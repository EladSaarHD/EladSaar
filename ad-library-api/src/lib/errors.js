'use strict';

// Error taxonomy. Each carries an HTTP status and a stable machine code so
// the error handler can turn any thrown ApiError into a clean JSON body.
class ApiError extends Error {
  constructor(message, { status = 500, code = 'internal_error' } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

class InvalidParamsError extends ApiError {
  constructor(message) {
    super(message, { status: 400, code: 'invalid_params' });
  }
}

class UnauthorizedError extends ApiError {
  constructor(message = 'Missing or invalid API key') {
    super(message, { status: 401, code: 'unauthorized' });
  }
}

class NotFoundError extends ApiError {
  constructor(message = 'Not found') {
    super(message, { status: 404, code: 'not_found' });
  }
}

// Facebook returned a stale-session signal (HTTP 403 or error 1357004) that
// survived a re-bootstrap attempt.
class TokenExpiredError extends ApiError {
  constructor(message = 'Upstream session expired and could not be refreshed') {
    super(message, { status: 503, code: 'token_expired' });
  }
}

// Facebook blocked us, rate-limited us, or returned an unusable payload.
class UpstreamBlockedError extends ApiError {
  constructor(message = 'Upstream request was blocked or returned no data') {
    super(message, { status: 502, code: 'upstream_blocked' });
  }
}

module.exports = {
  ApiError,
  InvalidParamsError,
  UnauthorizedError,
  NotFoundError,
  TokenExpiredError,
  UpstreamBlockedError,
};
