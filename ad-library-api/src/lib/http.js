'use strict';

const config = require('../../config');
const { UpstreamBlockedError } = require('./errors');

// Optional proxy support. Routing fetch through a proxy needs a custom
// dispatcher, but a ProxyAgent must be paired with the *same* undici realm's
// fetch — mixing the installed undici's agent with Node's built-in fetch
// throws UND_ERR_INVALID_ARG. So when a proxy is set we use the installed
// undici's own fetch; otherwise we use Node's built-in fetch and pull in no
// extra dependency at all.
let dispatcher;
let proxyFetch;
if (config.proxyUrl) {
  try {
    const undici = require('undici');
    dispatcher = new undici.ProxyAgent(config.proxyUrl);
    proxyFetch = undici.fetch;
  } catch (err) {
    console.warn(`[http] proxy configured but undici unavailable: ${err.message}`);
  }
}

// Thin wrapper around fetch. A network-level failure (DNS, refused connection,
// TLS, or a proxy that rejects the CONNECT) makes fetch *throw* rather than
// return a response, so we translate those into a typed, retryable upstream
// error.
async function httpFetch(url, options = {}) {
  // A hard ceiling on the WHOLE exchange (headers + body): without one, a socket that Meta stops answering
  // stalls a scan until undici gives up after ~5 minutes with a bare `terminated`. A timeout is reported as
  // the same retryable network fault so the existing backoff/retry path handles it.
  const timeoutMs = options.timeoutMs || config.requestTimeoutMs;
  const { timeoutMs: _ignored, ...fetchOptions } = options;
  if (timeoutMs > 0 && !fetchOptions.signal) fetchOptions.signal = AbortSignal.timeout(timeoutMs);
  try {
    if (dispatcher && proxyFetch) return await proxyFetch(url, { ...fetchOptions, dispatcher });
    return await fetch(url, fetchOptions);
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const wrapped = new UpstreamBlockedError(
      `Network request to Facebook failed (${timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : err.cause?.code || err.message})`
    );
    wrapped.retryable = 'backoff';
    throw wrapped;
  }
}

// Reading the body can fail AFTER the headers arrived (connection reset / `terminated` mid-stream). That is
// the same transient network fault as a failed request and must go through the same retry path instead of
// escaping as a raw TypeError that fails the whole shard.
async function readText(res) {
  try {
    return await res.text();
  } catch (err) {
    const wrapped = new UpstreamBlockedError(
      `Network request to Facebook failed (reading response: ${err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timed out' : err.cause?.code || err.message})`
    );
    wrapped.retryable = 'backoff';
    throw wrapped;
  }
}

module.exports = { httpFetch, readText };
