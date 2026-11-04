'use strict';

const crypto = require('crypto');
const config = require('../../config');
const session = require('./session');
const { httpFetch, readText } = require('./http');
const rateEvents = require('./rateEvents');
const { AdaptiveRateLimiter } = require('./rateLimiter');
const { RateLimitedError, TokenExpiredError, UpstreamBlockedError } = require('./errors');
const {
  GRAPHQL_URL,
  LIBRARY_URL,
  FRIENDLY_NAMES,
  FALLBACK_DOC_IDS,
  ASBD_ID,
  UPSTREAM_ERROR_CODES,
  FETCH_METADATA_HEADERS,
  SORT_MODES,
} = require('../constants');

const limiter = new AdaptiveRateLimiter({ startMs: config.minRequestDelayMs, floorMs: config.fastestRequestDelayMs, maxPerHour: config.maxRequestsPerHour, concurrency: 1 });

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

// Meta reports some failures as a top-level numeric `error` (not the GraphQL `errors`
// array) with HTTP 200 and `payload: null`, e.g. 1357054 "Your Request Couldn't be
// Processed". Surface the real code instead of a generic "empty payload" so a drift in
// what Meta accepts is diagnosable from the first failed scan.
// Meta's rate-limit signals: the message text and the classic API codes (4 app limit, 17 user limit, 32 page
// limit, 341 app limit, 368 temporarily blocked, 613 call-count limit, 80004).
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 368, 613, 80004]);
function isRateLimitText(text) {
  return /rate.?limit|too many (requests|calls)|temporarily blocked|slow down/i.test(String(text || ''));
}

// A response that says "slow down", whether as a GraphQL error message or as a coded top-level rejection.
function rateLimitFrom(json) {
  if (!json || json.data) return null;
  if (Array.isArray(json.errors) && json.errors.length) {
    const msg = json.errors[0] && json.errors[0].message;
    if (isRateLimitText(msg)) return new RateLimitedError(`Meta rate limit exceeded (${String(msg).slice(0, 80)})`);
  }
  if (json.error !== undefined && json.error !== null) {
    const code = Number(json.error);
    if (RATE_LIMIT_CODES.has(code) || isRateLimitText(json.errorSummary) || isRateLimitText(json.errorDescription)) {
      return new RateLimitedError(`Meta rate limit exceeded (error ${code})`);
    }
  }
  return null;
}

function upstreamRejection(json) {
  if (!json || json.data || json.error === undefined || json.error === null) return null;
  const code = Number(json.error);
  const summary = json.errorSummary || json.errorDescription || 'no description';
  const err = new UpstreamBlockedError(
    code === UPSTREAM_ERROR_CODES.REQUEST_REJECTED
      ? `Upstream rejected the request (Meta error ${code}: ${summary}). The request no longer looks like a browser fetch — check the headers in buildPostHeaders().`
      : `Upstream rejected the request (Meta error ${code}: ${summary})`
  );
  err.metaErrorCode = code;
  return err;
}

// Headers for the GraphQL POST. The sec-fetch-* trio is REQUIRED (see constants.js).
function buildPostHeaders({ sess, friendlyName, userAgent = session.userAgent }) {
  return {
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': userAgent,
    'x-fb-lsd': sess.lsd,
    'x-fb-friendly-name': friendlyName,
    'x-asbd-id': ASBD_ID,
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    origin: 'https://www.facebook.com',
    referer: LIBRARY_URL,
    ...FETCH_METADATA_HEADERS,
    cookie: sess.cookie,
  };
}

function epochDayToIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

// Meta embeds the current frontend revision as `"v":"<6 hex>"` inside preloaded query
// variables. In the server-rendered page that JSON sits inside a JS string, so the quotes
// arrive backslash-escaped (`\"v\":\"5245b2\"`); the old regex only matched bare quotes and
// therefore never found it.
function extractFrontendVersion(text) {
  const m = String(text || '').match(/\\?["']v\\?["']\s*:\s*\\?["']([a-f0-9]{6})\\?["']/i);
  return m ? m[1] : null;
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
  return {
    docIds: {
      search: findId('AdLibrarySearchPaginationQuery'),
      details: findId('AdLibraryV3AdDetailsQuery'),
    },
    frontendVersion: extractFrontendVersion(combined),
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
const CONTINUATION_TTL_MS = 30 * 60 * 1000;
const CONTINUATION_MAX = 500;

// Each initial search stores the lsd/cookie that issued its cursor. Without eviction this
// map grew for the life of the process.
function pruneContinuationSessions(now = Date.now()) {
  for (const [id, entry] of continuationSessions) {
    if (now - entry.fetchedAt > CONTINUATION_TTL_MS) continuationSessions.delete(id);
  }
  while (continuationSessions.size > CONTINUATION_MAX) {
    continuationSessions.delete(continuationSessions.keys().next().value);
  }
}

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
  const sortMode = variables.sortData?.mode === 'SORT_BY_TIME_ACTIVE' || variables.sortData?.mode === SORT_MODES.recent.graphql
    ? SORT_MODES.recent
    : SORT_MODES.impressions;
  const params = new URLSearchParams({
    active_status: variables.activeStatus || 'all',
    ad_type: String(variables.adType || 'ALL').toLowerCase(),
    country: variables.countries?.[0] || config.defaultCountry || 'US',
    is_targeted_country: String(Boolean(variables.isTargetedCountry)),
    media_type: variables.mediaType || 'all',
    q: variables.queryString || '',
    search_type: variables.searchType || 'keyword_unordered',
    'sort_data[direction]': 'desc',
    'sort_data[mode]': sortMode.url,
  });
  if (variables.viewAllPageID && variables.viewAllPageID !== '0') {
    params.set('view_all_page_id', variables.viewAllPageID);
  }
  // Meta's date filter takes ISO dates and means "ads that ran during this window"
  // (not "launched in"). Epoch-day integers — what this used to send — are silently
  // ignored. Launch-window precision is enforced locally after collection.
  const dateMin = typeof variables.startDate?.min === 'number' ? epochDayToIso(variables.startDate.min) : variables.startDate?.min;
  const dateMax = typeof variables.startDate?.max === 'number' ? epochDayToIso(variables.startDate.max) : variables.startDate?.max;
  if (dateMin) params.set('start_date[min]', dateMin);
  if (dateMax) params.set('start_date[max]', dateMax);
  for (const platform of variables.publisherPlatforms || []) params.append('platforms[0]', String(platform).toLowerCase());
  const url = `${LIBRARY_URL}?${params.toString()}`;
  const { res, html, cookie } = await limiter.schedule(() => session.fetchDocument(url));
  if (!res.ok) {
    throw new UpstreamBlockedError(`Initial search GET failed with HTTP ${res.status}`);
  }
  const data = parseInitialSearchHtml(html);
  const lsd = session.extractLsd(html);
  if (data.__continuation && lsd && cookie !== undefined) {
    const stateID = crypto.randomUUID();
    continuationSessions.set(stateID, { lsd, cookie, v: extractFrontendVersion(html), fetchedAt: Date.now() });
    pruneContinuationSessions();
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
    headers: buildPostHeaders({ sess, friendlyName }),
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
  // Prefer the revision the cursor's own page was served with, then the discovered
  // runtime revision, then the compiled-in default.
  const frontendVersion = storedSession?.v || runtime?.frontendVersion || null;
  const withRuntimeVersion =
    frontendVersion && kind === 'search' ? { ...variables, v: frontendVersion } : variables;
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

  const json = parseResponse(await readText(res));

  if (isStaleSession(json)) {
    const err = new TokenExpiredError('Upstream reported a stale session (1357004)');
    err.retryable = 'refresh';
    throw err;
  }
  const limited = rateLimitFrom(json);
  if (limited) throw limited;
  const rejection = upstreamRejection(json);
  if (rejection) throw rejection;
  if (json && Array.isArray(json.errors) && json.errors.length && !json.data) {
    const msg = json.errors[0] && json.errors[0].message;
    throw new UpstreamBlockedError(`Upstream GraphQL error: ${msg || 'unknown'}`);
  }
  if (!json || !json.data) {
    // A syntactically valid empty response usually means Meta rejected this
    // continuation state. Backoff cannot repair that cursor and previously
    // multiplied scan time at both the GraphQL and scan layers.
    throw new UpstreamBlockedError('Upstream returned an empty payload');
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
// The server-rendered first page occasionally comes back unparseable (a login/challenge variant)
// or fails outright. The same first page can be fetched through the GraphQL POST — smaller (10 ads, no
// total count) but it needs no HTML — so fall back to it rather than failing the whole shard.
function shouldFallbackToPost(err) {
  return err instanceof UpstreamBlockedError && !err.metaErrorCode
    && /Initial search GET failed|Could not extract initial search data|Network request to Facebook failed/.test(err.message || '');
}

async function searchFirstPageViaPost(variables) {
  return requestWithRetries({ kind: 'search', variables: { ...variables, cursor: null, continuationStateID: null } });
}

async function requestSearchFirstPage(variables) {
  try {
    return await requestInitialSearch(variables);
  } catch (err) {
    if (!shouldFallbackToPost(err)) throw err;
    console.warn(`[graphql] first-page HTML failed (${err.message}); falling back to GraphQL POST`);
    return searchFirstPageViaPost(variables);
  }
}

// Signals that Meta is pushing back (as opposed to a deterministic, coded rejection of one cursor).
function isPressureSignal(err) {
  return err instanceof UpstreamBlockedError && !err.metaErrorCode
    && /429|rate limit|empty payload|Initial search GET failed|Could not extract initial search data|Network request to Facebook failed|HTTP 5\d\d/.test(err.message || '');
}

async function requestRaw({ kind, variables }) {
  if (kind === 'search' && !variables.cursor) return requestSearchFirstPage(variables);
  if (kind === 'details') return requestInitialDetails(variables);
  return requestWithRetries({ kind, variables });
}

async function request(args) {
  try {
    const data = await requestRaw(args);
    limiter.reward();
    return data;
  } catch (err) {
    if (isPressureSignal(err) && err.retryable !== 'backoff' && err.retryable !== 'ratelimit') limiter.penalize(err.message); // 'backoff' ones were counted in the retry loop
    throw err;
  }
}

async function requestWithRetries({ kind, variables }) {
  let refreshed = false;
  let rateLimitHits = 0;
  let lastErr;

  for (let i = 0; i <= config.maxRetries + config.rateLimitRetries; i += 1) {
    try {
      return await attempt({ kind, variables, force: refreshed && i === 0 ? false : refreshed });
    } catch (err) {
      lastErr = err;

      if (err.retryable === 'refresh' && !refreshed) {
        session.invalidate();
        refreshed = true;
        continue; // immediate retry with a fresh session
      }

      if (err.retryable === 'ratelimit') {
        const event = limiter.rateLimited(err.message);
        rateEvents.record(event);
        console.warn(`[graphql] Meta rate limit (${event.requests_10m} requests in the last 10 min, ${event.requests_60m} in 60): cooling down ${Math.round(event.cooldown_ms / 60000)} min`);
        rateLimitHits += 1;
        if (rateLimitHits > config.rateLimitRetries) {
          err.message = `Meta rate limit exceeded; gave up after ${rateLimitHits} cool-down(s). Wait and try again later.`;
          throw err;
        }
        continue; // the limiter holds the next request until the cool-down ends
      }
      if (err.retryable === 'backoff') limiter.penalize(err.message);
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
  getPacing: () => limiter.stats(),
  rateLimitFrom,
  isRateLimitText,
  isPressureSignal,
  request,
  parseResponse,
  isStaleSession,
  parseInitialSearchHtml,
  parseDetailsHtml,
  discoverRuntimeMetadata,
  extractFrontendVersion,
  upstreamRejection,
  buildPostHeaders,
  epochDayToIso,
  pruneContinuationSessions,
  shouldFallbackToPost,
  searchFirstPageViaPost,
  extractScriptUrls,
  refreshRuntimeMetadata,
  findSearchMain,
  findDeeplinkAd,
};
