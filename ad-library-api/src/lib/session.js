'use strict';

const config = require('../../config');
const { httpFetch } = require('./http');
const { UpstreamBlockedError } = require('./errors');
const {
  LIBRARY_URL,
  FRIENDLY_NAMES,
  FALLBACK_DOC_IDS,
  DEFAULT_USER_AGENT,
} = require('../constants');

// ---- Pure parsers (unit-tested against a captured HTML fixture) ----

// The lsd token appears in a bootstrap payload as ["LSD",[],{"token":"..."}].
function extractLsd(html) {
  const m =
    html.match(/"LSD",\[\],\{"token":"([^"]+)"/) ||
    html.match(/"DTSGInitData",\[\],\{"token":"([^"]+)"/) ||
    html.match(/name="lsd"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

// doc_ids rotate constantly, so we scrape the current one out of the page's
// JS bundles rather than trusting a hardcoded value. Two patterns are seen in
// the wild; we try both, per friendly name, and fall back to constants.
function findDocId(html, friendlyName) {
  // Pattern A: __d("AdLibrarySearchPaginationQuery_facebookRelayOperation", ... , 25464...)
  const reA = new RegExp(
    `${friendlyName}[\\s\\S]{0,400}?(?:"?(?:doc_?id|queryID|id)"?\\s*[:=]\\s*)"?(\\d{15,})"?`
  );
  const a = html.match(reA);
  if (a) return a[1];

  // Pattern B: {"name":"AdLibrarySearchPaginationQuery","queryID":"25464..."}
  const reB = new RegExp(
    `"(?:queryID|doc_?id|id)"\\s*:\\s*"(\\d{15,})"[\\s\\S]{0,120}?${friendlyName}`
  );
  const b = html.match(reB);
  if (b) return b[1];

  return null;
}

function discoverDocIds(html) {
  return {
    search: findDocId(html, FRIENDLY_NAMES.search) || FALLBACK_DOC_IDS.search,
    details: findDocId(html, FRIENDLY_NAMES.details) || FALLBACK_DOC_IDS.details,
  };
}

// Turn a set-cookie header list into a "k=v; k=v" Cookie string, keeping only
// what unauthenticated calls need (datr is the important one).
function cookieFromSetCookie(setCookieHeaders) {
  const wanted = ['datr', 'wd', 'dpr', 'sb'];
  const jar = {};
  for (const line of setCookieHeaders) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (wanted.includes(name)) jar[name] = value;
  }
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function getSetCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

// ---- Session state + bootstrap ----

const userAgent = config.userAgent || DEFAULT_USER_AGENT;
let cached = null; // { lsd, docIds, cookie, fetchedAt }

async function bootstrap() {
  const url = `${LIBRARY_URL}?active_status=all&ad_type=all&country=${config.defaultCountry}&media_type=all`;
  const res = await httpFetch(url, {
    headers: {
      'user-agent': userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'upgrade-insecure-requests': '1',
    },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new UpstreamBlockedError(`Bootstrap GET failed with HTTP ${res.status}`);
  }

  const html = await res.text();
  const lsd = extractLsd(html);
  if (!lsd) {
    throw new UpstreamBlockedError('Could not extract lsd token from ads/library page');
  }

  let cookie = cookieFromSetCookie(getSetCookies(res));
  if (!cookie) {
    // Fall back to a synthetic datr so the GraphQL call still has a cookie.
    cookie = `datr=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }

  cached = { lsd, docIds: discoverDocIds(html), cookie, fetchedAt: Date.now() };
  return cached;
}

function isExpired(session) {
  const ageMs = Date.now() - session.fetchedAt;
  return ageMs >= config.sessionTtlSeconds * 1000;
}

async function getSession({ force = false } = {}) {
  if (!force && cached && !isExpired(cached)) return cached;
  return bootstrap();
}

function invalidate() {
  cached = null;
}

// Test/introspection helpers.
function peek() {
  return cached;
}

module.exports = {
  getSession,
  invalidate,
  bootstrap,
  peek,
  userAgent,
  // exported for unit tests:
  extractLsd,
  discoverDocIds,
  findDocId,
  cookieFromSetCookie,
};
