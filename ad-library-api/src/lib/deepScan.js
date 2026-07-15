'use strict';

function iso(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }

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
  for (const query of [...new Set((queries || []).map((x) => String(x).trim()).filter(Boolean))]) {
    for (const country of [...new Set((countries || ['US']).map((x) => String(x).toUpperCase()))]) {
      for (const window of windows) {
        result.push({ query, country, ...window });
        if (result.length >= Math.max(1, Math.min(Number(maxShards) || 300, 1000))) return result;
      }
    }
  }
  return result;
}

function expandQueries(queries, { mode = 'deep', maxQueries = 120 } = {}) {
  const discovery = [
    'free worldwide shipping', 'buy 1 get 1 free', '50% off today', 'limited time offer',
    'order now free shipping', 'selling fast', 'last chance shop now', 'viral product',
    'new arrival shop now', 'exclusive online offer', 'today only discount', 'shop now pay later',
    'free delivery today', 'best seller back in stock', 'customers love this product',
  ];
  const modifiers = [
    (q) => q, (q) => `buy ${q}`, (q) => `${q} shop now`, (q) => `${q} free shipping`,
    (q) => `${q} 50% off`, (q) => `${q} sale`, (q) => `${q} order now`,
    (q) => `best ${q}`, (q) => `new ${q}`, (q) => `${q} today only`,
    (q) => `${q} worldwide shipping`, (q) => `${q} limited offer`,
    (q) => `${q} buy 1 get 1`, (q) => `viral ${q}`, (q) => `${q} selling fast`,
  ];
  const result = mode === 'dropshipping' ? [...discovery] : [];
  for (const query of queries || []) {
    const clean = String(query).trim();
    if (!clean) continue;
    for (const make of modifiers) result.push(make(clean));
  }
  return [...new Set(result)].slice(0, Math.max(1, Math.min(Number(maxQueries) || 120, 300)));
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

const SCAN_WINDOWS = [3, 7, 14, 21, 30, 60, 90];

function normalizeScanWindow(value) {
  const days = Number(value ?? 30);
  if (!SCAN_WINDOWS.includes(days)) {
    throw new Error(`Launch window must be one of: ${SCAN_WINDOWS.join(', ')} days`);
  }
  return days;
}

async function collectShardPages({
  initialParams, targetAds, maxPages = 3, fetchPage, saveAds, getUniqueCount, pause = async () => {},
}) {
  let params = { ...initialParams };
  let pages = 0;
  let uniqueAds = getUniqueCount();
  let exhausted = false;
  let pageError = null;
  while (pages < maxPages && uniqueAds < targetAds) {
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
    if (!next) { exhausted = true; break; }
    params = { ...params, cursor: next };
    await pause();
  }
  return { pages, uniqueAds, targetReached: uniqueAds >= targetAds, exhausted, pageError };
}

module.exports = {
  buildScanShards, collectShardPages, expandQueries, extractStoreDomain, normalizeScanWindow,
  scoreDropshippingAd, scoreMomentum,
};
