'use strict';

function iso(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }

function validIsoDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && iso(date) === text ? text : null;
}

function isWithinShardWindow(ad, shard) {
  const start = validIsoDate(ad?.start_date);
  const shardStart = validIsoDate(shard?.startDate);
  const shardEnd = validIsoDate(shard?.endDate);
  return Boolean(start && shardStart && shardEnd && start >= shardStart && start <= shardEnd);
}

function filterAdsToShardWindow(ads, shard) {
  const source = Array.isArray(ads) ? ads : [];
  const valid = source.filter((ad) => isWithinShardWindow(ad, shard));
  return { ads: valid, discarded: source.length - valid.length };
}

// Split on OR separators (`|`, `,`, newline) — but never inside a double-quoted phrase, so
// `"Buy 2, Get 1 Free"` stays one term. An unbalanced quote falls back to a plain split.
function splitQueryInput(input) {
  const text = String(input || '');
  const tokens = [];
  let current = '';
  let inQuote = false;
  for (const ch of text) {
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote && (ch === ',' || ch === '|' || ch === '\n')) {
      tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  tokens.push(current);
  return inQuote ? text.split(/[\n,|]+/) : tokens;
}

// Parse user query input into `{ text, exact }` terms. A term wrapped in double quotes is an
// EXACT PHRASE request and is searched with Meta's `keyword_exact_phrase` mode (verified
// live: 1,286 → 826 results for the same words). Previously the quotes were stripped and
// every term silently ran as an unordered keyword search. Single quotes are still just
// stripped. Pass `{ exactPhrase: false }` to restore the legacy "ignore quotes" behaviour.
function parseQueryTerms(value, { exactPhrase = true } = {}) {
  const inputs = Array.isArray(value) ? value : [value];
  const terms = [];
  const seen = new Set();
  for (const input of inputs) {
    for (const token of splitQueryInput(input)) {
      let clean = token.trim();
      let exact = false;
      while (clean.length >= 2 && ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'")))) {
        if (clean.startsWith('"')) exact = true;
        clean = clean.slice(1, -1).trim();
      }
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      terms.push({ text: clean, exact: exact && exactPhrase });
    }
  }
  return terms;
}

function normalizeQueryTerms(value) {
  return [...new Set(parseQueryTerms(value).map((term) => term.text))];
}

function buildScanShards({ queries, countries, lookbackDays = 180, windowDays = 30, maxShards = 300, today }) {
  const end = new Date(`${today || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const windows = [];
  let remaining = Math.max(1, Math.min(Number(lookbackDays) || 180, 1825));
  let windowEnd = end;
  const size = Math.max(1, Math.min(Number(windowDays) || 30, 365));
  while (remaining > 0) {
    const days = Math.min(size, remaining);
    const windowStart = addDays(windowEnd, -(days - 1));
    windows.push({ startDate: iso(windowStart), endDate: iso(windowEnd) });
    windowEnd = addDays(windowStart, -1);
    remaining -= days;
  }
  const result = [];
  // Accept plain strings (legacy) or plan entries `{ query, searchType, origin }`.
  const entries = (Array.isArray(queries) ? queries : [queries]).flatMap((entry) => (
    entry && typeof entry === 'object' && (entry.query || entry.pageId)
      ? [{ query: String(entry.query || '').trim(), searchType: entry.searchType, origin: entry.origin, pageId: entry.pageId }]
      : normalizeQueryTerms(entry).map((query) => ({ query }))
  )).filter((entry) => entry.query || entry.pageId);
  for (const entry of entries) {
    for (const country of [...new Set((countries || ['US']).map((x) => String(x).toUpperCase()))]) {
      for (const window of windows) {
        const shard = { query: entry.query, country, ...window };
        // Only carry non-default fields so legacy shard shapes are unchanged.
        if (entry.searchType && entry.searchType !== 'keyword_unordered') shard.searchType = entry.searchType;
        if (entry.origin && entry.origin !== 'seed') shard.origin = entry.origin;
        if (entry.pageId) shard.pageId = String(entry.pageId);
        result.push(shard);
        if (result.length >= Math.max(1, Math.min(Number(maxShards) || 300, 1000))) return result;
      }
    }
  }
  return result;
}

const DISCOVERY_PHRASES = [
  'free worldwide shipping', 'buy 1 get 1 free', '50% off today', 'limited time offer',
  'order now free shipping', 'selling fast', 'last chance shop now', 'viral product',
  'new arrival shop now', 'exclusive online offer', 'today only discount', 'shop now pay later',
  'free delivery today', 'best seller back in stock', 'customers love this product',
];

// Index 0 is the identity (the seed itself); the rest are buyer-intent variants.
const QUERY_MODIFIERS = [
  (q) => q, (q) => `buy ${q}`, (q) => `${q} shop now`, (q) => `${q} free shipping`,
  (q) => `${q} 50% off`, (q) => `${q} sale`, (q) => `${q} order now`,
  (q) => `best ${q}`, (q) => `new ${q}`, (q) => `${q} today only`,
  (q) => `${q} worldwide shipping`, (q) => `${q} limited offer`,
  (q) => `${q} buy 1 get 1`, (q) => `viral ${q}`, (q) => `${q} selling fast`,
];

// Ordered query plan: the user's own terms FIRST (exact phrases keep their search type), then
// whichever expansions were requested.
//
//   expansion: 'none'       seeds only
//              'modifiers'  + buyer-intent variants ("buy X", "X free shipping", …)
//              'discovery'  + generic promo phrases (dropshipping store finder)
//              'auto'       legacy: modifiers, plus discovery when mode is 'dropshipping'
//
// Order matters now that pagination works. A scan stops as soon as it reaches its target, so
// with the old order (discovery first) a dropshipping scan would spend its whole budget on
// generic "free worldwide shipping" ads and never reach the user's product. The old order
// was only harmless because broken pagination capped every query at a single page. With
// no seeds at all (store-finder mode) the discovery phrases are the plan.
function buildQueryPlan(queries, { mode = 'deep', maxQueries = 120, expansion = 'auto', exactPhrase = true } = {}) {
  const alreadyParsed = Array.isArray(queries) && queries.length > 0
    && queries.every((q) => q && typeof q === 'object' && 'text' in q);
  const seeds = alreadyParsed ? queries : parseQueryTerms(queries, { exactPhrase });
  const wantModifiers = expansion === 'modifiers' || expansion === 'auto';
  const wantDiscovery = expansion === 'discovery' || (expansion === 'auto' && mode === 'dropshipping');
  const plan = [];
  const seen = new Set();
  const add = (query, searchType, origin) => {
    const key = `${searchType}:${query}`;
    if (!query || seen.has(key)) return;
    seen.add(key);
    plan.push({ query, searchType, origin });
  };
  for (const seed of seeds) add(seed.text, seed.exact ? 'keyword_exact_phrase' : 'keyword_unordered', 'seed');
  if (wantModifiers) {
    for (const make of QUERY_MODIFIERS.slice(1)) {
      for (const seed of seeds) add(make(seed.text), 'keyword_unordered', 'modifier');
    }
  }
  if (wantDiscovery) for (const phrase of DISCOVERY_PHRASES) add(phrase, 'keyword_unordered', 'discovery');
  return plan.slice(0, Math.max(1, Math.min(Number(maxQueries) || 120, 300)));
}

// Legacy string-only view of the plan (kept for callers/tests that just want the phrases).
function expandQueries(queries, options = {}) {
  return buildQueryPlan(queries, options).map((entry) => entry.query);
}

function extractStoreDomain(ad) {
  const creative = ad?.creative || {};
  const raw = creative.link_url || creative.cards?.find((card) => card?.link_url)?.link_url;
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    if (!host || /(^|\.)(facebook|instagram|messenger|threads)\.com$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

function scoreDropshippingAd(ad) {
  const creative = ad?.creative || {};
  const text = [creative.body, creative.title, creative.caption, creative.cta_text].filter(Boolean).join(' ').toLowerCase();
  const url = String(creative.link_url || creative.cards?.[0]?.link_url || '').toLowerCase();
  let score = 0; const signals = [];
  if (/shop\s*now|buy\s*now|order\s*now/.test(text)) { score += 2; signals.push('purchase CTA'); }
  if (/\b\d{1,2}%\s*off\b|free\s+(worldwide\s+)?shipping|today\s+only|limited\s+time|buy\s+\d|get\s+\d/.test(text)) { score += 3; signals.push('direct-response offer'); }
  if (/\/products?\/|myshopify\.com|shop\.app/.test(url)) { score += 3; signals.push('product-page URL'); }
  else if (url && !/facebook\.com|instagram\.com/.test(url)) { score += 1; signals.push('external storefront'); }
  if (/worldwide|ships?\s+to|delivery|customers|best\s*seller|viral|selling\s+fast/.test(text)) { score += 1; signals.push('commerce language'); }
  if ((creative.images?.length || 0) + (creative.videos?.length || 0) + (creative.cards?.length || 0) > 1) { score += 1; signals.push('multiple product assets'); }
  if (ad?.is_active) score += 1;
  if (/amazon\.|walmart\.|etsy\.|ebay\./.test(url)) { score -= 3; signals.push('marketplace destination'); }
  return { score: Math.max(0, score), signals };
}

function scoreMomentum(ad, { today } = {}) {
  const now = new Date(`${today || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const start = ad?.start_date ? new Date(`${ad.start_date}T00:00:00Z`) : null;
  const ageDays = start && Number.isFinite(start.getTime()) ? Math.max(0, Math.floor((now - start) / 86400000)) : null;
  const recency = ageDays === null ? 0 : Math.max(0, 60 - Math.min(60, ageDays));
  const impressionsUpper = ad?.transparency?.impressions?.upper ?? null;
  const impressionSignal = impressionsUpper ? Math.min(30, Math.log10(Math.max(1, impressionsUpper)) * 5) : 0;
  const score = Math.round(recency + (ad?.is_active ? 15 : 0) + Math.min(10, (ad?.publisher_platforms || []).length * 2) + impressionSignal);
  return { score, ageDays, impressionsUpper };
}

// Scale = how hard an advertiser is leaning on this creative. Built from signals Meta really
// publishes for commercial ads: variant count (`collation_count`), how long it has run,
// whether it is live, and placement breadth. 0–100, heuristic — NOT spend, sales or profit.
// (Momentum reserves up to 30 points for numeric impressions, which Meta publishes for
// ~0.002% of commercial ads in the stored data, so that term is effectively dead.)
function scoreScale(ad, { today } = {}) {
  const now = new Date(`${today || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const start = ad?.start_date ? new Date(`${ad.start_date}T00:00:00Z`) : null;
  const end = ad?.end_date ? new Date(`${ad.end_date}T00:00:00Z`) : null;
  const stop = !ad?.is_active && end && Number.isFinite(end.getTime()) ? end : now;
  const runDays = start && Number.isFinite(start.getTime()) ? Math.max(0, Math.floor((stop - start) / 86400000)) : null;
  const variants = Math.max(1, Number(ad?.collation_count) || 1);
  const longevity = runDays === null ? 0 : Math.min(40, Math.log2(1 + runDays) * 6);
  const variantPoints = Math.min(40, Math.log2(variants) * 12);
  const score = Math.round(longevity + variantPoints + (ad?.is_active ? 10 : 0) + Math.min(10, (ad?.publisher_platforms || []).length * 3));
  return { score: Math.min(100, score), runDays, variants };
}

const SCAN_WINDOWS = [3, 7, 14, 21, 30, 60, 90];

function normalizeScanWindow(value) {
  const days = Number(value ?? 30);
  if (!SCAN_WINDOWS.includes(days)) {
    throw new Error(`Launch window must be one of: ${SCAN_WINDOWS.join(', ')} days`);
  }
  return days;
}

async function collectShardPages({
  initialParams, targetAds, maxPages = 3, fetchPage, saveAds, getUniqueCount, pause = async () => {}, shouldStop = null,
}) {
  let params = { ...initialParams };
  let pages = 0;
  let uniqueAds = getUniqueCount();
  let exhausted = false;
  let pageError = null;
  // `maxPages` may be a function of progress, so a budget can follow what the scan actually finds.
  const pageLimit = () => (typeof maxPages === 'function' ? maxPages({ pages, uniqueAds }) : maxPages);
  while (pages < pageLimit() && uniqueAds < targetAds) {
    let payload;
    try {
      payload = await fetchPage(params);
    } catch (error) {
      // Keep a successful initial page when Meta rejects its continuation
      // cursor instead of waiting through nested retries and losing progress.
      if (!pages || !params.cursor) throw error;
      pageError = error;
      exhausted = true;
      break;
    }
    pages += 1;
    saveAds(payload.ads || [], params);
    uniqueAds = getUniqueCount();
    const next = payload.page_info?.has_next_page && payload.page_info?.end_cursor;
    if (uniqueAds >= targetAds) break;
    // Caller-supplied early exit (e.g. a launch-window scan that has paged past its window).
    if (shouldStop && shouldStop(payload.ads || [], { pages })) { exhausted = true; break; }
    if (!next) { exhausted = true; break; }
    params = { ...params, cursor: next };
    await pause();
  }
  return { pages, uniqueAds, targetReached: uniqueAds >= targetAds, exhausted, pageError };
}

// Pages needed to deliver `remaining` more ads. The server-rendered first page carries ~30
// ads; every continuation is fixed at 10 regardless of the requested `first`. Pad a little
// for overlap and sparse pages, and bound it so one shard can never run away.
function pageBudget(remaining, { pageSize = 10, firstPageSize = 30, cap = 250 } = {}) {
  const need = Math.max(0, Math.ceil((Math.max(0, remaining) - firstPageSize) / pageSize));
  return Math.max(1, Math.min(cap, 1 + need + Math.ceil(need * 0.25) + 2));
}

// Budget that follows the scan's real yield. A windowed scan in impression order discards the ads that
// launched before the window, so a fixed page budget sized for `remaining` ads stops far short of the target
// (observed: ~25% kept for a broad term over 90 days). Once ~10 pages have been seen, scale the budget by
// the observed kept-per-fetched ratio, bounded by `cap`. Early on the ratio is assumed to be 1.
function createDensityBudget({ target, startUnique, cap, minSample = 100, minDensity = 0.04 }) {
  return ({ pages, uniqueAds }) => {
    const fetched = pages ? 30 + 10 * (pages - 1) : 0;
    const kept = Math.max(0, uniqueAds - startUnique);
    const density = fetched >= minSample ? Math.max(minDensity, Math.min(1, kept / fetched)) : 1;
    const remaining = Math.max(0, target - uniqueAds);
    return Math.min(cap, pages + Math.ceil(pageBudget(remaining, { cap }) / density));
  };
}

// Launch-window early exit for `recent` (month-grouped, newest first) scans. Ads arrive
// grouped by launch month, newest month first, so once whole pages sit entirely in months
// before the window's first month no later page can hold an in-window ad. Requires
// `patience` consecutive such pages to tolerate month-boundary noise.
function createWindowEarlyStop({ windowStart, patience = 2 }) {
  const startMonth = String(windowStart || '').slice(0, 7);
  let olderPages = 0;
  return (ads) => {
    const dated = (ads || []).map((ad) => validIsoDate(ad?.start_date)).filter(Boolean);
    if (!startMonth || !dated.length) return false;
    const allOlder = dated.every((date) => date.slice(0, 7) < startMonth);
    olderPages = allOlder ? olderPages + 1 : 0;
    return olderPages >= patience;
  };
}

module.exports = {
  buildQueryPlan, buildScanShards, collectShardPages, createDensityBudget, createWindowEarlyStop, expandQueries, extractStoreDomain,
  filterAdsToShardWindow, isWithinShardWindow, normalizeQueryTerms, normalizeScanWindow, pageBudget,
  parseQueryTerms, scoreDropshippingAd, scoreMomentum, scoreScale,
};
