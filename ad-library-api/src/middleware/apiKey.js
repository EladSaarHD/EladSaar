'use strict';

const config = require('../../config');
const { UnauthorizedError } = require('../lib/errors');

// When API_KEY is configured, every request must present it via the
// X-API-Key header or ?api_key=. /api/health is always exempt.
function apiKey(req, res, next) {
  if (!config.apiKey) return next();
  if (req.path === '/api/health') return next();

  const provided = req.get('x-api-key') || req.query.api_key;
  if (provided && provided === config.apiKey) return next();

  next(new UnauthorizedError());
}

module.exports = apiKey;
