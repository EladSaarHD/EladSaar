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
  try {
    if (dispatcher && proxyFetch) return await proxyFetch(url, { ...options, dispatcher });
    return await fetch(url, options);
  } catch (err) {
    const wrapped = new UpstreamBlockedError(
      `Network request to Facebook failed (${err.cause?.code || err.message})`
    );
    wrapped.retryable = 'backoff';
    throw wrapped;
  }
}

module.exports = { httpFetch };
