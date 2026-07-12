'use strict';

const crypto = require('crypto');
const config = require('../../config');
const session = require('./session');
const { httpFetch } = require('./http');
const { RateLimiter } = require('./rateLimiter');
const { TokenExpiredError, UpstreamBlockedError } = require('./errors');
const {
  GRAPHQL_URL,
  LIBRARY_URL,
  FRIENDLY_NAMES,
  FALLBACK_DOC_IDS,
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

function findSearchMain(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.ad_library_main?.search_results_connection) return value.ad_library_main;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findSearchMain(child);
    if (found) return found;
  }
  return null;
}

function findDeeplinkAd(value) {
  if (!value || typeof value !== 'object') return null;
  const ad = value.ad_library_main?.deeplink_ad_archive_result?.deeplink_ad_archive;
  if (ad) return ad;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findDeeplinkAd(child);
    if (found) return found;
  }
  return null;
}

function applicationJsonPayloads(html) {
  const payloads = [];
  const scripts = String(html || '').matchAll(
    /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const match of scripts) {
    try {
      payloads.push(JSON.parse(match[1]));
    } catch {
      // Ignore unrelated or malformed JSON script tags.
    }
  }
  return payloads;
}

function parseDetailsHtml(html) {
  for (const payload of applicationJsonPayloads(html)) {
    const ad = findDeeplinkAd(payload);
    if (ad) return { ad_library_main: { ad_details: { ad } } };
  }
  throw new UpstreamBlockedError('Could not extract ad details from Ad Library HTML');
}

function discoverRuntimeMetadata(html, javascriptSources = []) {
  const combined = [String(html || ''), ...javascriptSources.map(String)].join('\n');
  const findId = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const after = combined.match(new RegExp(`${escaped}[^0-9]{0,300}(\\d{15,20})`));
    if (after) return after[1];
    const before = combined.match(new RegExp(`(\\d{15,20})[^0-9]{0,300}${escaped}`));
    return before ? before[1] : null;
  };
  const versionMatch = combined.match(/["']v["']\s*:\s*["']([a-f0-9]{6})["']/i);
  return {
    docIds: {
      search: findId('AdLibrarySearchPaginationQuery'),
      details: findId('AdLibraryV3AdDetailsQuery'),
    },
    frontendVersion: versionMatch ? versionMatch[1] : null,
  };
}

function extractScriptUrls(html) {
  const urls = [];
  for (const match of String(html || '').matchAll(/<script\b[^>]*src=["']([^"']+\.js[^"']*)["']/gi)) {
    const raw = match[1].replace(/&amp;/g, '&');
    try {
      const url = new URL(raw, LIBRARY_URL);
      if (url.protocol === 'https:' && url.hostname.endsWith('fbcdn.net')) urls.push(url.href);
    } catch {
      // Ignore malformed URLs.
    }
  }
  return [...new Set(urls)];
}

let runtimeMetadata = null;
let runtimeMetadataAt = 0;
const continuationSessions = new Map();

async function refreshRuntimeMetadata({ force = false } = {}) {
  if (!force && runtimeMetadata && Date.now() - runtimeMetadataAt < 6 * 60 * 60 * 1000) {
    return runtimeMetadata;
  }
  const { res, html } = await session.fetchDocument(
    `${LIBRARY_URL}?active_status=all&ad_type=all&country=${config.defaultCountry}&media_type=all`
  );
  if (!res.ok) return runtimeMetadata;
  const urls = extractScriptUrls(html).slice(0, 20);
  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await httpFetch(url, { headers: { 'user-agent': session.userAgent } });
      return response.ok ? response.text() : '';
    })
  );
  const sources = settled.filter((x) => x.status === 'fulfilled').map((x) => x.value);
  const discovered = discoverRuntimeMetadata(html, sources);
  runtimeMetadata = {
    docIds: {
      search: discovered.docIds.search || FALLBACK_DOC_IDS.search,
      details: discovered.docIds.details || FALLBACK_DOC_IDS.details,
    },
    frontendVersion: discovered.frontendVersion || null,
  };
  runtimeMetadataAt = Date.now();
  return runtimeMetadata;
}

function findSearchConfig(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.sessionId && (Object.hasOwn(value, 'query') || Object.hasOwn(value, 'queryString'))) {
    return value;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findSearchConfig(child);
    if (found) return found;
  }
  return null;
}

function parseInitialSearchHtml(html) {
  let main = null;
  let configState = null;
  for (const payload of applicationJsonPayloads(html)) {
    main ||= findSearchMain(payload);
    configState ||= findSearchConfig(payload);
  }
  if (main) {
    return {
      ad_library_main: main,
      __continuation: configState
        ? {
            sessionID: configState.sessionId,
            collationToken: configState.collationToken ?? null,
          }
        : null,
    };
  }
  throw new UpstreamBlockedError('Could not extract initial search data from Ad Library HTML');
}

async function requestInitialSearch(variables) {
  const params = new URLSearchParams({
    active_status: variables.activeStatus || 'all',
    ad_type: String(variables.adType || 'ALL').toLowerCase(),
    country: variables.countries?.[0] || config.defaultCountry || 'US',
    is_targeted_country: String(Boolean(variables.isTargetedCountry)),
    media_type: variables.mediaType || 'all',
    q: variables.queryString || '',
    search_type: variables.searchType || 'keyword_unordered',
  });
  if (variables.viewAllPageID && variables.viewAllPageID !== '0') {
    params.set('view_all_page_id', variables.viewAllPageID);
  }
  const url = `${LIBRARY_URL}?${params.toString()}`;
  const { res, html, cookie } = await session.fetchDocument(url);
  if (!res.ok) {
    throw new UpstreamBlockedError(`Initial search GET failed with HTTP ${res.status}`);
  }
  const data = parseInitialSearchHtml(html);
  const lsd = session.extractLsd(html);
  if (data.__continuation && lsd && cookie) {
    const stateID = crypto.randomUUID();
    continuationSessions.set(stateID, { lsd, cookie, fetchedAt: Date.now() });
    data.__continuation.stateID = stateID;
  }
  return data;
}

async function requestInitialDetails(variables) {
  const params = new URLSearchParams({ id: String(variables.adArchiveID) });
  const url = `${LIBRARY_URL}?${params.toString()}`;
  const { res, html } = await session.fetchDocument(url);
  if (!res.ok) {
    throw new UpstreamBlockedError(`Ad details GET failed with HTTP ${res.status}`);
  }
  return parseDetailsHtml(html);
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
  const storedSession = variables.continuationStateID
    ? continuationSessions.get(variables.continuationStateID)
    : null;
  const sess = storedSession || (await session.getSession({ force }));
  const friendlyName = FRIENDLY_NAMES[kind];
  const runtime = await refreshRuntimeMetadata();
  const docId = runtime?.docIds?.[kind] || sess.docIds?.[kind] || FALLBACK_DOC_IDS[kind];
  const withRuntimeVersion =
    runtime?.frontendVersion && kind === 'search'
      ? { ...variables, v: runtime.frontendVersion }
      : variables;
  const { continuationStateID: _stateID, ...currentVariables } = withRuntimeVersion;

  const res = await limiter.schedule(() =>
    postGraphql({ friendlyName, docId, variables: currentVariables, sess })
  );

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

  if (kind === 'search' && json.data) {
    json.data.__continuation = {
      sessionID: currentVariables.sessionID,
      collationToken: currentVariables.collationToken ?? null,
      stateID: variables.continuationStateID || null,
    };
  }
  return json.data;
}

// Public entry point. Runs `attempt` with a retry policy:
//   - stale session / 403  → invalidate + re-bootstrap, retry once
//   - 429 / transient      → exponential backoff with jitter, up to maxRetries
async function request({ kind, variables }) {
  if (kind === 'search' && !variables.cursor) {
    return requestInitialSearch(variables);
  }
  if (kind === 'details') {
    return requestInitialDetails(variables);
  }

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

module.exports = {
  request,
  parseResponse,
  isStaleSession,
  parseInitialSearchHtml,
  parseDetailsHtml,
  discoverRuntimeMetadata,
  extractScriptUrls,
  refreshRuntimeMetadata,
  findSearchMain,
  findDeeplinkAd,
};
