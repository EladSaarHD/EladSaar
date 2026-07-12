'use strict';

const config = require('../../config');
const session = require('./session');
const { httpFetch } = require('./http');
const { RateLimiter } = require('./rateLimiter');
const { TokenExpiredError, UpstreamBlockedError } = require('./errors');
const {
  GRAPHQL_URL,
  LIBRARY_URL,
  FRIENDLY_NAMES,
  ASBD_ID,
  UPSTREAM_ERROR_CODES,
} = require('../constants');

const limiter = new RateLimiter({ minDelayMs: config.minRequestDelayMs, concurrency: 1 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Facebook prefixes JSON responses with an anti-hijacking `for (;;);`. Strip
// it, parse, and unwrap the occasional double-`data` envelope.
function parseResponse(text) {
  let body = text;
  if (body.startsWith('for (;;);')) body = body.slice(9);

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new UpstreamBlockedError('Upstream returned a non-JSON payload');
  }

  if (json && json.data && json.data.data) json = { ...json, data: json.data.data };
  return json;
}

// Detects the stale-session signal in a parsed payload (error code 1357004).
function isStaleSession(json) {
  if (!json || !Array.isArray(json.errors)) return false;
  return json.errors.some(
    (e) => e && (e.code === UPSTREAM_ERROR_CODES.STALE_SESSION || e.api_error_code === UPSTREAM_ERROR_CODES.STALE_SESSION)
  );
}

// Build the form body with the minimal set of params known to work
// unauthenticated, then POST it.
async function postGraphql({ friendlyName, docId, variables, sess }) {
  const form = new URLSearchParams({
    av: '0',
    __user: '0',
    __a: '1',
    lsd: sess.lsd,
    fb_api_req_friendly_name: friendlyName,
    fb_api_caller_class: 'RelayModern',
    variables: JSON.stringify(variables),
    doc_id: docId,
    server_timestamps: 'true',
  });

  const res = await httpFetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': session.userAgent,
      'x-fb-lsd': sess.lsd,
      'x-fb-friendly-name': friendlyName,
      'x-asbd-id': ASBD_ID,
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      origin: 'https://www.facebook.com',
      referer: LIBRARY_URL,
      cookie: sess.cookie,
    },
    body: form.toString(),
    redirect: 'follow',
  });

  return res;
}

// One rate-limited attempt: fetch, classify HTTP status, parse. Throws typed
// errors the retry loop understands.
async function attempt({ kind, variables, force }) {
  const sess = await session.getSession({ force });
  const friendlyName = FRIENDLY_NAMES[kind];
  const docId = sess.docIds[kind];

  const res = await limiter.schedule(() => postGraphql({ friendlyName, docId, variables, sess }));

  if (res.status === 403) {
    const err = new TokenExpiredError('Upstream returned HTTP 403 (session likely stale)');
    err.retryable = 'refresh';
    throw err;
  }
  if (res.status === 429) {
    const err = new UpstreamBlockedError('Upstream returned HTTP 429 (rate limited)');
    err.retryable = 'backoff';
    throw err;
  }
  if (!res.ok) {
    const err = new UpstreamBlockedError(`Upstream returned HTTP ${res.status}`);
    err.retryable = 'backoff';
    throw err;
  }

  const json = parseResponse(await res.text());

  if (isStaleSession(json)) {
    const err = new TokenExpiredError('Upstream reported a stale session (1357004)');
    err.retryable = 'refresh';
    throw err;
  }
  if (json && Array.isArray(json.errors) && json.errors.length && !json.data) {
    const msg = json.errors[0] && json.errors[0].message;
    throw new UpstreamBlockedError(`Upstream GraphQL error: ${msg || 'unknown'}`);
  }
  if (!json || !json.data) {
    const err = new UpstreamBlockedError('Upstream returned an empty payload');
    err.retryable = 'backoff';
    throw err;
  }

  return json.data;
}

// Public entry point. Runs `attempt` with a retry policy:
//   - stale session / 403  → invalidate + re-bootstrap, retry once
//   - 429 / transient      → exponential backoff with jitter, up to maxRetries
async function request({ kind, variables }) {
  let refreshed = false;
  let lastErr;

  for (let i = 0; i <= config.maxRetries; i += 1) {
    try {
      return await attempt({ kind, variables, force: refreshed && i === 0 ? false : refreshed });
    } catch (err) {
      lastErr = err;

      if (err.retryable === 'refresh' && !refreshed) {
        session.invalidate();
        refreshed = true;
        continue; // immediate retry with a fresh session
      }

      if (err.retryable === 'backoff' && i < config.maxRetries) {
        const base = config.backoffBaseMs * 2 ** i;
        const jitter = Math.floor(base * 0.3 * pseudoRandom(i));
        await sleep(base + jitter);
        continue;
      }

      throw err;
    }
  }

  throw lastErr;
}

// Deterministic-ish jitter that avoids Math.random (kept simple and testable).
function pseudoRandom(i) {
  const x = Math.sin((i + 1) * 99991) * 10000;
  return x - Math.floor(x);
}

module.exports = { request, parseResponse, isStaleSession };
