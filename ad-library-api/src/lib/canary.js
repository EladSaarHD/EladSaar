'use strict';

const client = require('./graphqlClient');
const { buildSearchVariables } = require('./variables');
const { normalizeSearchResponse } = require('./normalize');
const rateEvents = require('./rateEvents');

// A canary that only fetches page 1 cannot see a broken continuation: every scan was silently
// capped at its first page from mid-July because the old watchdog never asked for page 2. This
// exercises the full path — first page, then a continuation cursor — and records the result.
let last = null;
let inFlight = null;

async function runCanary({ query = 'running shoes', country = 'US' } = {}) {
  const startedAt = Date.now();
  const result = { ok: false, checked_at: startedAt, query, country, steps: {} };
  // Meta rate-limited us recently: a live check would only add load and report a misleading "broken".
  const lastLimit = rateEvents.recent(1)[0];
  if (lastLimit && startedAt - lastLimit.at < 2 * 3600000) {
    const minutes = Math.max(1, Math.round((2 * 3600000 - (startedAt - lastLimit.at)) / 60000));
    result.ok = null;
    result.skipped = true;
    result.error = `Meta rate-limited this connection recently; the live check is paused (about ${minutes} min left) so it does not add load`;
    result.ms = 0;
    last = result;
    return result;
  }
  try {
    const first = normalizeSearchResponse(await client.request({
      kind: 'search',
      variables: buildSearchVariables({ q: query, country, active_status: 'active', sort: 'impressions', first: 30 }),
    }));
    result.steps.first_page = { ads: first.ads.length, has_next_page: first.page_info.has_next_page, count: first.count };
    if (!first.ads.length) throw new Error('first page returned no ads');
    if (!first.page_info.has_next_page || !first.page_info.end_cursor) {
      throw new Error('first page offered no continuation cursor (expected one for a high-volume query)');
    }
    const second = normalizeSearchResponse(await client.request({
      kind: 'search',
      variables: buildSearchVariables({ q: query, country, active_status: 'active', sort: 'impressions', first: 30, cursor: first.page_info.end_cursor }),
    }));
    result.steps.continuation = { ads: second.ads.length, has_next_page: second.page_info.has_next_page };
    if (!second.ads.length) throw new Error('continuation page returned no ads');
    result.ok = true;
  } catch (error) {
    result.error = String(error.message || error).slice(0, 300);
    result.meta_error_code = error.metaErrorCode || null;
  }
  result.ms = Date.now() - startedAt;
  last = result;
  return result;
}

// Coalesce concurrent callers and honour a short freshness window so the endpoint cannot be used
// to hammer Meta.
async function checkCanary({ maxAgeMs = 60 * 1000 } = {}) {
  if (last && Date.now() - last.checked_at < maxAgeMs) return { ...last, cached: true };
  if (!inFlight) inFlight = runCanary().finally(() => { inFlight = null; });
  return inFlight;
}

function lastCanary() {
  return last;
}

function startCanarySchedule({ intervalHours = 6, initialDelayMs = 90 * 1000, log = console } = {}) {
  if (!intervalHours || intervalHours <= 0) return null;
  const tick = async () => {
    const result = await checkCanary({ maxAgeMs: 0 });
    if (!result.ok) log.error(`[canary] FAILED: ${result.error}`);
  };
  const first = setTimeout(() => { tick(); }, initialDelayMs);
  const timer = setInterval(tick, intervalHours * 3600 * 1000);
  first.unref?.();
  timer.unref?.();
  return { first, timer };
}

module.exports = { runCanary, checkCanary, lastCanary, startCanarySchedule };
