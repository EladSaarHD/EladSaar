'use strict';

const crypto = require('crypto');
const db = require('../db');
const { buildSearchVariables } = require('./variables');
const { runListQuery } = require('./listQuery');
const { CONTINUATION_PAGE_SIZE } = require('../constants');
const {
  buildQueryPlan, buildScanShards, collectShardPages, createWindowEarlyStop, extractStoreDomain,
  filterAdsToShardWindow, pageBudget, parseQueryTerms, normalizeScanWindow, scoreDropshippingAd,
  scoreMomentum, scoreScale,
} = require('./deepScan');
const payloadStore = require('./payloadStore');
const registry = require('./registry');

const createJobStmt = db.prepare(`INSERT INTO scan_jobs
  (id,status,config_json,total_shards,completed_shards,unique_ads,discarded_ads,created_at,updated_at,shards_json,request_hash)
  VALUES (@id,'queued',@config_json,@total_shards,0,0,0,@now,@now,@shards_json,@request_hash)`);
// Only queue rows that carry a shard plan (jobs inserted by older code or by tests that call runScan
// directly have none and are never picked up).
const getQueuedStmt = db.prepare("SELECT * FROM scan_jobs WHERE status='queued' AND shards_json IS NOT NULL ORDER BY created_at ASC, rowid ASC LIMIT 1");
const findDuplicateStmt = db.prepare("SELECT * FROM scan_jobs WHERE request_hash=? AND status IN ('queued','running') ORDER BY created_at ASC LIMIT 1");
const queueDepthStmt = db.prepare("SELECT COUNT(*) AS n FROM scan_jobs WHERE status IN ('queued','running') AND shards_json IS NOT NULL");
const aheadStmt = db.prepare(`SELECT COUNT(*) AS n FROM scan_jobs WHERE status IN ('queued','running') AND shards_json IS NOT NULL
  AND (created_at < @created OR (created_at = @created AND rowid < (SELECT rowid FROM scan_jobs WHERE id=@id)))`);
const MAX_QUEUE = 25;
const getJobStmt = db.prepare('SELECT * FROM scan_jobs WHERE id = ?');
const updateProgressStmt = db.prepare(`UPDATE scan_jobs SET status=@status, completed_shards=@completed,
  unique_ads=(SELECT COUNT(*) FROM scan_ads WHERE scan_id=@id), discarded_ads=@discarded,
  error=@error, updated_at=@now WHERE id=@id`);
// Lightweight heartbeat written while a shard is still paging, so a long single-shard scan
// reports live unique-ad counts instead of sitting at 0 until the shard ends.
const heartbeatStmt = db.prepare(`UPDATE scan_jobs SET unique_ads=(SELECT COUNT(*) FROM scan_ads WHERE scan_id=@id),
  discarded_ads=@discarded, updated_at=@now WHERE id=@id AND status='running'`);
const getActiveJobStmt = db.prepare("SELECT * FROM scan_jobs WHERE status IN ('queued','running') ORDER BY created_at ASC LIMIT 1");
const getAdStmt = db.prepare('SELECT * FROM scan_ads WHERE scan_id=? AND ad_archive_id=?');
const upsertAdStmt = db.prepare(`INSERT INTO scan_ads
  (scan_id,ad_archive_id,page_id,page_name,start_date,is_active,impressions_upper,momentum_score,dropship_score,
   signals_json,matched_queries_json,countries_json,payload_json,first_seen,last_seen,meta_rank,variant_count,scale_score)
  VALUES (@scan_id,@ad_archive_id,@page_id,@page_name,@start_date,@is_active,@impressions_upper,@momentum_score,@dropship_score,
   @signals_json,@matched_queries_json,@countries_json,@payload_json,@first_seen,@last_seen,@meta_rank,@variant_count,@scale_score)
  ON CONFLICT(scan_id,ad_archive_id) DO UPDATE SET
   page_id=excluded.page_id,page_name=excluded.page_name,start_date=excluded.start_date,is_active=excluded.is_active,
   impressions_upper=excluded.impressions_upper,momentum_score=MAX(scan_ads.momentum_score,excluded.momentum_score),
   dropship_score=MAX(scan_ads.dropship_score,excluded.dropship_score),signals_json=excluded.signals_json,
   matched_queries_json=excluded.matched_queries_json,countries_json=excluded.countries_json,
   payload_json=excluded.payload_json,last_seen=excluded.last_seen,
   meta_rank=CASE WHEN scan_ads.meta_rank IS NULL THEN excluded.meta_rank
                  WHEN excluded.meta_rank IS NULL THEN scan_ads.meta_rank
                  ELSE MIN(scan_ads.meta_rank, excluded.meta_rank) END,
   variant_count=excluded.variant_count,scale_score=MAX(scan_ads.scale_score,excluded.scale_score)`);

// Scan workers live in this Node process. A queued/running row found at boot
// was interrupted and must not block future scans indefinitely.
// (Queued scans that already have a shard plan are kept and resumed by pump() below.)
// A scan that was RUNNING when the service stopped is re-queued once (its writes are idempotent upserts, so
// starting over only fills gaps); a second interruption, or a job with no stored plan, is failed with its
// partial results kept — a scan that keeps crashing the service must not loop forever.
function recoverInterruptedScans() {
  const now = Date.now();
  const resumed = db.prepare(`UPDATE scan_jobs SET status='queued', attempts=attempts+1, updated_at=?,
    error='Resumed after a service restart.'
    WHERE status='running' AND shards_json IS NOT NULL AND attempts < 1`).run(now).changes;
  const failed = db.prepare(`UPDATE scan_jobs SET status='failed',
    error=COALESCE(error || ' ', '') || 'Interrupted by service restart; collected results remain available.',
    updated_at=? WHERE status='running' OR (status='queued' AND shards_json IS NULL)`).run(now).changes;
  return { resumed, failed };
}
recoverInterruptedScans();

// Progress: finished scans are 100%. While running, take the larger of shard progress and
// collected/target, capped at 99 — a one-shard scan that has gathered 600 of 1,000 ads is 60%
// done, not 0%.
function scanProgress(row, config) {
  if (row.status === 'complete') return 100;
  const shardPct = row.total_shards ? Math.round(row.completed_shards / row.total_shards * 100) : 0;
  const target = Number(config?.targetAds) || 0;
  const collectedPct = target ? Math.round(Math.min(row.unique_ads, target) / target * 100) : 0;
  return Math.min(99, Math.max(shardPct, collectedPct));
}

function parseJob(row) {
  if (!row) return null;
  const config = JSON.parse(row.config_json);
  const job = { id: row.id, status: row.status, config, total_shards: row.total_shards,
    completed_shards: row.completed_shards, unique_ads: row.unique_ads, discarded_ads: row.discarded_ads || 0,
    error: row.error, progress: scanProgress(row, config),
    created_at: row.created_at, updated_at: row.updated_at };
  // Scans ahead of this one (a running scan counts); 0 when it is next / running.
  if (row.status === 'queued' && row.shards_json) job.queue_position = aheadStmt.get({ id: row.id, created: row.created_at }).n;
  return job;
}

function getJob(id) { return parseJob(getJobStmt.get(id)); }

function mergeUnique(existing, value) {
  const values = existing ? JSON.parse(existing) : [];
  if (!values.includes(value)) values.push(value);
  return values;
}

function saveAd(scanId, ad, query, country, opts = {}) {
  db.transaction(() => saveAdRows(scanId, ad, query, country, opts))();
}

function saveAdRows(scanId, ad, query, country, { rank = null, seed = true } = {}) {
  if (!ad.ad_archive_id) return;
  const existing = getAdStmt.get(scanId, ad.ad_archive_id);
  const dropship = scoreDropshippingAd(ad);
  const momentum = scoreMomentum(ad);
  const scale = scoreScale(ad);
  const now = Date.now();
  const payload = { ...ad, dropship_score: dropship.score, dropship_signals: dropship.signals,
    momentum_score: momentum.score, impressions_upper: momentum.impressionsUpper,
    scale_score: scale.score, run_days: scale.runDays, variant_count: scale.variants };
  upsertAdStmt.run({
    scan_id: scanId, ad_archive_id: ad.ad_archive_id, page_id: ad.page_id, page_name: ad.page_name,
    start_date: ad.start_date, is_active: ad.is_active == null ? null : Number(ad.is_active),
    impressions_upper: momentum.impressionsUpper, momentum_score: momentum.score, dropship_score: dropship.score,
    signals_json: JSON.stringify(dropship.signals),
    matched_queries_json: JSON.stringify(mergeUnique(existing?.matched_queries_json, query)),
    countries_json: JSON.stringify(mergeUnique(existing?.countries_json, country)),
    payload_json: '', first_seen: existing?.first_seen || now, last_seen: now,
    meta_rank: rank, variant_count: scale.variants, scale_score: scale.score,
  });
  payloadStore.save(ad.ad_archive_id, payload, now);
  registry.recordSighting(scanId, ad, { domain: extractStoreDomain(ad), scale, now, seedHit: seed });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A modifier/discovery shard that mostly re-returns ads we already hold is wasted traffic. Stop
// it once `window` consecutive pages together contributed fewer than `minNewRatio` new ads.
function createNoveltyStop({ countUnique, window = 3, minNewRatio = 0.1, pageSize = CONTINUATION_PAGE_SIZE }) {
  let previous = countUnique();
  const deltas = [];
  return () => {
    const current = countUnique();
    deltas.push(current - previous);
    previous = current;
    if (deltas.length > window) deltas.shift();
    return deltas.length === window && deltas.reduce((a, b) => a + b, 0) < minNewRatio * window * pageSize;
  };
}

async function runScan(id, shards, config) {
  updateProgressStmt.run({ id, status: 'running', completed: 0, discarded: 0, error: null, now: Date.now() });
  let completed = 0;
  let discarded = 0;
  let skipped = 0;
  let continuationFailures = 0;
  let earlyStops = 0;
  let noveltyStops = 0;
  let lastError = null;
  const countUnique = () => db.prepare('SELECT COUNT(*) AS n FROM scan_ads WHERE scan_id=?').get(id).n;
  try {
    for (const shard of shards) {
      const sortMode = config.sort === 'recent' ? 'recent' : 'impressions';
      const initialParams = { q: shard.query, country: shard.country, start_date: shard.startDate, end_date: shard.endDate,
        active_status: config.activeStatus || 'all', media_type: config.mediaType || 'all',
        platform: config.platform || null, first: 50, sort: sortMode };
      if (shard.searchType && !shard.pageId) initialParams.search_type = shard.searchType;
      // Advertiser sweep: every active ad from one page. No keyword, and no launch window — the point
      // is the advertiser's whole footprint, not what they started recently.
      if (shard.pageId) initialParams.page_id = shard.pageId;
      const label = shard.query || `page:${shard.pageId}`;
      const isSeed = !shard.origin || shard.origin === 'seed';
      const fetchPage = async (params) => {
        let error = null;
        // The GraphQL layer already retries rate limits and transient network faults. This outer
        // loop covers what it cannot: the HTML first page (which bypasses that policy) and a
        // one-off continuation blip 100 pages deep. A deterministic rejection from Meta (a coded
        // upstream error) is never retried — repeating it only burns time.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const variables = buildSearchVariables(params);
            return await runListQuery({ cacheKind: 'deep-scan', cacheParams: params, variables, fresh: false });
          } catch (caught) {
            error = caught;
            if (caught?.metaErrorCode || caught?.status === 400) break;
            if (attempt < 1) await sleep(params.cursor ? (config.continuationRetryPauseMs ?? 4000) : (config.initialRetryPauseMs ?? 5000));
          }
        }
        throw error || new Error('Shard page failed');
      };
      // Position in Meta's own ordering across this shard's pages (before any local filtering).
      let position = 0;
      let lastHeartbeat = 0;
      let stopCheck = null;
      if (sortMode === 'recent' && !shard.pageId) {
        const windowStop = createWindowEarlyStop({ windowStart: shard.startDate });
        stopCheck = (ads, info) => { const stop = windowStop(ads, info); if (stop) earlyStops += 1; return stop; };
      }
      if (shard.origin && shard.origin !== 'seed') {
        const novelty = createNoveltyStop({ countUnique });
        const previous = stopCheck;
        stopCheck = (ads, info) => {
          if (previous && previous(ads, info)) return true;
          const stop = novelty();
          if (stop) noveltyStops += 1;
          return stop;
        };
      }
      try {
        const result = await collectShardPages({
          initialParams,
          targetAds: config.targetAds,
          maxPages: config.maxPagesPerShard || pageBudget(config.targetAds - countUnique(), { cap: 400 }),
          fetchPage,
          saveAds: (ads) => {
            const filtered = shard.pageId ? { ads, discarded: 0 } : filterAdsToShardWindow(ads, shard);
            discarded += filtered.discarded;
            const rankOf = new Map(ads.map((ad, index) => [ad, position + index]));
            filtered.ads.forEach((ad) => saveAd(id, ad, label, shard.country, { rank: rankOf.get(ad), seed: isSeed }));
            position += ads.length;
            if (Date.now() - lastHeartbeat >= (config.heartbeatMs ?? 4000)) {
              lastHeartbeat = Date.now();
              heartbeatStmt.run({ id, discarded, now: lastHeartbeat });
            }
          },
          getUniqueCount: countUnique,
          pause: () => sleep(config.pagePauseMs ?? 1000),
          shouldStop: stopCheck,
        });
        if (result.pageError) continuationFailures += 1;
      } catch (error) {
        skipped += 1;
        lastError = error;
      }
      completed += 1;
      const unique = countUnique();
      const warnings = [];
      if (skipped) warnings.push(`${skipped} shard(s) skipped after bounded retries${lastError ? `: ${String(lastError.message || lastError).slice(0, 160)}` : ''}`);
      if (continuationFailures) warnings.push(`${continuationFailures} continuation cursor(s) failed mid-pagination; ads collected before the failure were preserved`);
      if (discarded) warnings.push(`Discarded ${discarded} out-of-window ad(s) with missing, invalid, or non-matching start_date`);
      updateProgressStmt.run({ id, status: unique >= config.targetAds ? 'complete' : 'running', completed, discarded, error: warnings.join('. ') || null, now: Date.now() });
      if (unique >= config.targetAds) break;
      await sleep(config.requestPauseMs ?? 1000);
    }
    const unique = countUnique();
    const notes = [];
    if (skipped) notes.push(`${skipped} shard(s) skipped after bounded retries; collected results remain usable`);
    if (continuationFailures) notes.push(`${continuationFailures} continuation cursor(s) failed mid-pagination; ads collected before the failure were preserved`);
    if (earlyStops) notes.push(`${earlyStops} shard(s) stopped early after paging past the ${config.lookbackDays}-day launch window`);
    if (noveltyStops) notes.push(`${noveltyStops} expansion shard(s) stopped early because they only returned ads already collected`);
    if (discarded) notes.push(`Discarded ${discarded} out-of-window ad(s) with missing, invalid, or non-matching start_date.`);
    if (unique < config.targetAds) {
      notes.push(`Collected ${unique} unique ads of the ${config.targetAds} target. The selected countries, filters and ${config.lookbackDays}-day launch window were exhausted; no duplicate or invented ads were added.`);
    }
    updateProgressStmt.run({ id, status: 'complete', completed, discarded, error: notes.join(' ') || null, now: Date.now() });
  } catch (error) {
    updateProgressStmt.run({ id, status: 'failed', completed, discarded, error: String(error.message || error).slice(0, 500), now: Date.now() });
  }
}

function createScan(input) {
  // Default: queue behind a running scan. `queue: false` restores the strict "409 while busy" behaviour.
  const active = input.queue === false ? parseJob(getActiveJobStmt.get()) : null;
  if (active) {
    const error = new Error(`Scan ${active.id} is already ${active.status}`);
    error.code = 'scan_active';
    error.status = 409;
    error.activeScan = active;
    throw error;
  }
  const exactPhrase = input.exactPhrase !== false;
  const terms = parseQueryTerms(input.queries, { exactPhrase }).slice(0, 30);
  const queries = terms.map((term) => term.text);
  const mode = input.mode === 'dropshipping' ? 'dropshipping' : 'deep';
  const sort = String(input.sort || 'impressions').toLowerCase();
  if (!['impressions', 'recent'].includes(sort)) throw new Error('Invalid sort. Allowed: impressions, recent');
  const expansion = String(input.expansion || (mode === 'dropshipping' && !terms.length ? 'discovery' : 'none')).toLowerCase();
  if (!['none', 'modifiers', 'discovery'].includes(expansion)) throw new Error('Invalid expansion. Allowed: none, modifiers, discovery');
  // Expansion history: modifier variants ("buy X", "X free shipping", …) were a workaround for
  // pagination that stopped after one page. They are strict subsets of the seed's result pool, so
  // with working pagination they only re-fetch the same ads. They remain available, opt-in.
  const plan = buildQueryPlan(terms, { mode, maxQueries: 300, expansion });
  // Advertiser sweep: explicit Facebook page IDs, collected without a keyword or launch window.
  const rawPageIds = Array.isArray(input.pageIds) ? input.pageIds : String(input.pageIds || '').split(/[\s,|]+/);
  const pageIds = [...new Set(rawPageIds.map((id) => String(id).trim()).filter((id) => /^\d{5,20}$/.test(id)))].slice(0, 25);
  for (const pageId of pageIds) plan.push({ query: '', pageId, searchType: 'page', origin: 'seed' });
  const countries = [...new Set((input.countries || ['US']).map((x) => String(x).toUpperCase()))].slice(0, 20);
  if (!plan.length) throw new Error('At least one query is required');
  const targetAds = Math.max(30, Math.min(Number(input.targetAds) || 1000, 10000));
  const maxShards = Math.min(500, Math.max(1, Math.ceil(targetAds / 12)));
  const lookbackDays = normalizeScanWindow(input.lookbackDays);
  const config = { mode, queries, queryExpression: [...terms.map((t) => (t.exact ? `"${t.text}"` : t.text)), ...pageIds.map((id) => `page:${id}`)].join(' | '),
    exactTerms: terms.filter((t) => t.exact).map((t) => t.text), expansion, sort, pageIds,
    expandedQueries: plan.filter((entry) => entry.query).map((entry) => entry.query), countries, targetAds, lookbackDays,
    windowDays: lookbackDays, activeStatus: input.activeStatus || 'active',
    mediaType: input.mediaType || 'all', platform: input.platform || null };
  const shards = buildScanShards({ queries: plan, countries, lookbackDays,
    windowDays: lookbackDays, maxShards });
  // Idempotency: an identical request that is still queued/running IS that job. A client that lost its
  // connection mid-scan (fetch failed) can simply ask again and re-attach instead of colliding with it.
  const requestHash = crypto.createHash('sha1').update(JSON.stringify({
    plan: plan.map((entry) => [entry.query, entry.searchType, entry.pageId || null, entry.origin || 'seed']),
    countries, targetAds, lookbackDays, sort, mode, activeStatus: config.activeStatus, mediaType: config.mediaType, platform: config.platform,
  })).digest('hex');
  const duplicate = findDuplicateStmt.get(requestHash);
  if (duplicate) return { ...parseJob(duplicate), attached_to_existing: true };
  if (queueDepthStmt.get().n >= MAX_QUEUE) {
    const error = new Error(`Scan queue is full (${MAX_QUEUE}); wait for running scans to finish`);
    error.code = 'queue_full';
    error.status = 429;
    throw error;
  }
  const id = crypto.randomUUID(); const now = Date.now();
  createJobStmt.run({ id, config_json: JSON.stringify(config), total_shards: shards.length, now,
    shards_json: JSON.stringify(shards), request_hash: requestHash });
  setImmediate(pump);
  return getJob(id);
}

// Single worker: scans run one at a time (Meta politeness), FIFO. A finished/failed scan hands over to
// the next queued one; queued scans survive a restart.
let worker = null;
function pump() {
  if (worker) return;
  const row = getQueuedStmt.get();
  if (!row) return;
  let shards;
  let config;
  try {
    shards = JSON.parse(row.shards_json);
    config = JSON.parse(row.config_json);
  } catch (error) {
    updateProgressStmt.run({ id: row.id, status: 'failed', completed: 0, discarded: 0, error: 'Unreadable queued scan plan', now: Date.now() });
    setImmediate(pump);
    return;
  }
  worker = runScan(row.id, shards, config)
    .catch(() => {})
    .finally(() => { worker = null; setImmediate(pump); });
}

function seedSet(id) {
  const job = getJob(id);
  const pageLabels = (job?.config?.pageIds || []).map((pageId) => `page:${pageId}`);
  return { seeds: new Set([...(job?.config?.queries || []), ...pageLabels]), sort: job?.config?.sort || 'impressions' };
}

function listAds(id, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
  const offset = Math.max(0, Number(options.offset) || 0);
  const { seeds, sort: scanSort } = seedSet(id);
  // `impressions`: for scans collected in Meta's impression order the stored rank IS the
  // impression ranking (Meta publishes no numeric impressions for commercial ads), so sort by it;
  // older rows and non-impression scans fall back to the numeric field.
  const impressionOrder = scanSort === 'recent'
    ? 'impressions_upper DESC NULLS LAST, start_date DESC'
    : 'meta_rank IS NULL, meta_rank ASC, impressions_upper DESC NULLS LAST, start_date DESC';
  const sortColumns = { momentum: 'momentum_score DESC, start_date DESC', impressions: impressionOrder,
    recent: 'start_date DESC', dropship: 'dropship_score DESC, momentum_score DESC',
    scale: 'scale_score DESC, variant_count DESC, start_date ASC', variants: 'variant_count DESC, scale_score DESC',
    rank: 'meta_rank IS NULL, meta_rank ASC' };
  const order = sortColumns[options.sort] || sortColumns.momentum;
  const minDropship = Math.max(0, Number(options.dropshipMin) || 0);
  const minScale = Math.max(0, Number(options.scaleMin) || 0);
  const onlyImpressions = options.onlyImpressions ? 1 : 0;
  const where = 'scan_id = ? AND dropship_score >= ? AND scale_score >= ? AND (? = 0 OR impressions_upper IS NOT NULL)';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM scan_ads WHERE ${where}`).get(id, minDropship, minScale, onlyImpressions).n;
  const rows = db.prepare(`SELECT s.*, p.payload AS stored_payload FROM scan_ads s
    LEFT JOIN ad_payloads p ON p.ad_archive_id = s.ad_archive_id
    WHERE ${where.replace(/\b(scan_id|dropship_score|scale_score|impressions_upper)\b/g, 's.$1')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(id, minDropship, minScale, onlyImpressions, limit, offset);
  return { total, limit, offset, ads: rows.map((row) => {
    const matched = JSON.parse(row.matched_queries_json);
    // Scan-specific numbers come from this scan's own columns (the shared payload is the latest version).
    return { ...payloadStore.payloadOf(row),
      scale_score: row.scale_score, variant_count: row.variant_count,
      dropship_score: row.dropship_score, momentum_score: row.momentum_score, impressions_upper: row.impressions_upper,
      matched_queries: matched, matched_seed: matched.some((query) => seeds.has(query)), meta_rank: row.meta_rank,
      countries: JSON.parse(row.countries_json),
      dropship_signals: JSON.parse(row.signals_json), first_seen: row.first_seen, last_seen: row.last_seen };
  }) };
}

function listStores(id, options = {}) {
  const rows = db.prepare(`SELECT s.payload_json, p.payload AS stored_payload, s.matched_queries_json, s.countries_json,
    s.scale_score, s.variant_count, s.dropship_score, s.momentum_score, s.impressions_upper
    FROM scan_ads s LEFT JOIN ad_payloads p ON p.ad_archive_id = s.ad_archive_id WHERE s.scan_id=?`).all(id);
  const stores = new Map();
  for (const row of rows) {
    const ad = { ...payloadStore.payloadOf(row), scale_score: row.scale_score, variant_count: row.variant_count,
      dropship_score: row.dropship_score, momentum_score: row.momentum_score, impressions_upper: row.impressions_upper };
    const domain = extractStoreDomain(ad);
    if (!domain) continue;
    const store = stores.get(domain) || { domain, page_names: new Set(), ad_count: 0, active_ads: 0,
      latest_start: null, earliest_start: null, dropship_score: 0, momentum_score: 0, scale_score: 0,
      total_variants: 0, page_like_count: null, impressions_upper: null,
      matched_queries: new Set(), countries: new Set(), sample_ad: ad };
    store.ad_count += 1;
    if (ad.is_active) store.active_ads += 1;
    if (ad.page_name) store.page_names.add(ad.page_name);
    if (!store.latest_start || String(ad.start_date || '') > store.latest_start) store.latest_start = ad.start_date;
    if (ad.start_date && (!store.earliest_start || ad.start_date < store.earliest_start)) store.earliest_start = ad.start_date;
    store.dropship_score = Math.max(store.dropship_score, ad.dropship_score || 0);
    store.momentum_score = Math.max(store.momentum_score, ad.momentum_score || 0);
    store.scale_score = Math.max(store.scale_score, ad.scale_score || 0);
    store.total_variants += Number(ad.variant_count || ad.collation_count || 1);
    if (ad.page_like_count != null) store.page_like_count = Math.max(store.page_like_count || 0, ad.page_like_count);
    if (ad.impressions_upper != null) store.impressions_upper = Math.max(store.impressions_upper || 0, ad.impressions_upper);
    for (const query of JSON.parse(row.matched_queries_json)) store.matched_queries.add(query);
    for (const country of JSON.parse(row.countries_json)) store.countries.add(country);
    stores.set(domain, store);
  }
  const sorters = {
    dropship: (a, b) => b.dropship_score - a.dropship_score || b.ad_count - a.ad_count,
    volume: (a, b) => b.ad_count - a.ad_count || b.momentum_score - a.momentum_score,
    recent: (a, b) => String(b.latest_start || '').localeCompare(String(a.latest_start || '')),
    impressions: (a, b) => (b.impressions_upper || -1) - (a.impressions_upper || -1),
    scale: (a, b) => b.scale_score - a.scale_score || b.total_variants - a.total_variants,
    variants: (a, b) => b.total_variants - a.total_variants || b.ad_count - a.ad_count,
  };
  const values = [...stores.values()].map((store) => ({ ...store, page_names: [...store.page_names],
    matched_queries: [...store.matched_queries], countries: [...store.countries] }));
  values.sort(sorters[options.sort] || sorters.dropship);
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
  return { total: values.length, offset, limit, stores: values.slice(offset, offset + limit) };
}

function latestScans(limit = 10) {
  return db.prepare('SELECT * FROM scan_jobs ORDER BY created_at DESC LIMIT ?').all(Math.min(Number(limit) || 10, 50)).map(parseJob);
}

module.exports = { createScan, getJob, listAds, listStores, latestScans, runScan, createNoveltyStop, pump, recoverInterruptedScans };
