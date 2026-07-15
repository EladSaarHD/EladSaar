'use strict';

const crypto = require('crypto');
const db = require('../db');
const { buildSearchVariables } = require('./variables');
const { runListQuery } = require('./listQuery');
const {
  buildScanShards, collectShardPages, expandQueries, extractStoreDomain, filterAdsToShardWindow,
  normalizeScanWindow, scoreDropshippingAd, scoreMomentum,
} = require('./deepScan');

const createJobStmt = db.prepare(`INSERT INTO scan_jobs
  (id,status,config_json,total_shards,completed_shards,unique_ads,discarded_ads,created_at,updated_at)
  VALUES (@id,'queued',@config_json,@total_shards,0,0,0,@now,@now)`);
const getJobStmt = db.prepare('SELECT * FROM scan_jobs WHERE id = ?');
const updateProgressStmt = db.prepare(`UPDATE scan_jobs SET status=@status, completed_shards=@completed,
  unique_ads=(SELECT COUNT(*) FROM scan_ads WHERE scan_id=@id), discarded_ads=@discarded,
  error=@error, updated_at=@now WHERE id=@id`);
const getActiveJobStmt = db.prepare("SELECT * FROM scan_jobs WHERE status IN ('queued','running') ORDER BY created_at ASC LIMIT 1");
const getAdStmt = db.prepare('SELECT * FROM scan_ads WHERE scan_id=? AND ad_archive_id=?');
const upsertAdStmt = db.prepare(`INSERT INTO scan_ads
  (scan_id,ad_archive_id,page_id,page_name,start_date,is_active,impressions_upper,momentum_score,dropship_score,
   signals_json,matched_queries_json,countries_json,payload_json,first_seen,last_seen)
  VALUES (@scan_id,@ad_archive_id,@page_id,@page_name,@start_date,@is_active,@impressions_upper,@momentum_score,@dropship_score,
   @signals_json,@matched_queries_json,@countries_json,@payload_json,@first_seen,@last_seen)
  ON CONFLICT(scan_id,ad_archive_id) DO UPDATE SET
   page_id=excluded.page_id,page_name=excluded.page_name,start_date=excluded.start_date,is_active=excluded.is_active,
   impressions_upper=excluded.impressions_upper,momentum_score=MAX(scan_ads.momentum_score,excluded.momentum_score),
   dropship_score=MAX(scan_ads.dropship_score,excluded.dropship_score),signals_json=excluded.signals_json,
   matched_queries_json=excluded.matched_queries_json,countries_json=excluded.countries_json,
   payload_json=excluded.payload_json,last_seen=excluded.last_seen`);

// Scan workers live in this Node process. A queued/running row found at boot
// was interrupted and must not block future scans indefinitely.
db.prepare(`UPDATE scan_jobs SET status='failed',
  error=COALESCE(error || ' ', '') || 'Interrupted by service restart; collected results remain available.',
  updated_at=? WHERE status IN ('queued','running')`).run(Date.now());

function parseJob(row) {
  if (!row) return null;
  return { id: row.id, status: row.status, config: JSON.parse(row.config_json), total_shards: row.total_shards,
    completed_shards: row.completed_shards, unique_ads: row.unique_ads, discarded_ads: row.discarded_ads || 0,
    error: row.error,
    progress: row.total_shards ? Math.round(row.completed_shards / row.total_shards * 100) : 0,
    created_at: row.created_at, updated_at: row.updated_at };
}

function getJob(id) { return parseJob(getJobStmt.get(id)); }

function mergeUnique(existing, value) {
  const values = existing ? JSON.parse(existing) : [];
  if (!values.includes(value)) values.push(value);
  return values;
}

function saveAd(scanId, ad, query, country) {
  if (!ad.ad_archive_id) return;
  const existing = getAdStmt.get(scanId, ad.ad_archive_id);
  const dropship = scoreDropshippingAd(ad);
  const momentum = scoreMomentum(ad);
  const now = Date.now();
  const payload = { ...ad, dropship_score: dropship.score, dropship_signals: dropship.signals,
    momentum_score: momentum.score, impressions_upper: momentum.impressionsUpper };
  upsertAdStmt.run({
    scan_id: scanId, ad_archive_id: ad.ad_archive_id, page_id: ad.page_id, page_name: ad.page_name,
    start_date: ad.start_date, is_active: ad.is_active == null ? null : Number(ad.is_active),
    impressions_upper: momentum.impressionsUpper, momentum_score: momentum.score, dropship_score: dropship.score,
    signals_json: JSON.stringify(dropship.signals),
    matched_queries_json: JSON.stringify(mergeUnique(existing?.matched_queries_json, query)),
    countries_json: JSON.stringify(mergeUnique(existing?.countries_json, country)),
    payload_json: JSON.stringify(payload), first_seen: existing?.first_seen || now, last_seen: now,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runScan(id, shards, config) {
  updateProgressStmt.run({ id, status: 'running', completed: 0, discarded: 0, error: null, now: Date.now() });
  let completed = 0;
  let discarded = 0;
  let skipped = 0;
  let continuationFailures = 0;
  let lastError = null;
  const countUnique = () => db.prepare('SELECT COUNT(*) AS n FROM scan_ads WHERE scan_id=?').get(id).n;
  try {
    for (const shard of shards) {
      const initialParams = { q: shard.query, country: shard.country, start_date: shard.startDate, end_date: shard.endDate,
        active_status: config.activeStatus || 'all', media_type: config.mediaType || 'all',
        platform: config.platform || null, first: 50, sort: config.sort || 'impressions' };
      const fetchPage = async (params) => {
        let error = null;
        // Continuation calls already use the GraphQL retry policy. Do not wrap
        // them in another 20s/45s loop. Initial HTML searches get one short
        // retry because they bypass that GraphQL retry loop.
        const attempts = params.cursor ? 1 : 2;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            const variables = buildSearchVariables(params);
            return await runListQuery({ cacheKind: 'deep-scan', cacheParams: params, variables, fresh: false });
          } catch (caught) {
            error = caught;
            if (attempt < attempts - 1) await sleep(config.initialRetryPauseMs ?? 5000);
          }
        }
        throw error || new Error('Shard page failed');
      };
      try {
        const result = await collectShardPages({
          initialParams,
          targetAds: config.targetAds,
          maxPages: config.maxPagesPerShard || 3,
          fetchPage,
          saveAds: (ads) => {
            const filtered = filterAdsToShardWindow(ads, shard);
            discarded += filtered.discarded;
            filtered.ads.forEach((ad) => saveAd(id, ad, shard.query, shard.country));
          },
          getUniqueCount: countUnique,
          pause: () => sleep(config.pagePauseMs ?? 1000),
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
      if (continuationFailures) warnings.push(`${continuationFailures} continuation cursor(s) exhausted; first-page results were preserved`);
      if (discarded) warnings.push(`Discarded ${discarded} out-of-window ad(s) with missing, invalid, or non-matching start_date`);
      updateProgressStmt.run({ id, status: unique >= config.targetAds ? 'complete' : 'running', completed, discarded, error: warnings.join('. ') || null, now: Date.now() });
      if (unique >= config.targetAds) break;
      await sleep(config.requestPauseMs ?? 1000);
    }
    const unique = countUnique();
    const notes = [];
    if (skipped) notes.push(`${skipped} shard(s) skipped after bounded retries; collected results remain usable`);
    if (continuationFailures) notes.push(`${continuationFailures} continuation cursor(s) were unavailable; initial-page results were preserved without prolonged retries`);
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
  const active = parseJob(getActiveJobStmt.get());
  if (active) {
    const error = new Error(`Scan ${active.id} is already ${active.status}`);
    error.code = 'scan_active';
    error.status = 409;
    error.activeScan = active;
    throw error;
  }
  const queries = [...new Set((input.queries || []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 30);
  const mode = input.mode === 'dropshipping' ? 'dropshipping' : 'deep';
  const expandedQueries = expandQueries(queries, { mode, maxQueries: 300 });
  const countries = [...new Set((input.countries || ['US']).map((x) => String(x).toUpperCase()))].slice(0, 20);
  if (!expandedQueries.length) throw new Error('At least one query is required');
  const targetAds = Math.max(30, Math.min(Number(input.targetAds) || 1000, 10000));
  const maxShards = Math.min(500, Math.max(1, Math.ceil(targetAds / 12)));
  const lookbackDays = normalizeScanWindow(input.lookbackDays);
  const config = { mode, queries, expandedQueries, countries, targetAds, lookbackDays,
    windowDays: lookbackDays, activeStatus: input.activeStatus || 'active',
    mediaType: input.mediaType || 'all', platform: input.platform || null };
  const shards = buildScanShards({ queries: expandedQueries, countries, lookbackDays,
    windowDays: lookbackDays, maxShards });
  const id = crypto.randomUUID(); const now = Date.now();
  createJobStmt.run({ id, config_json: JSON.stringify(config), total_shards: shards.length, now });
  setImmediate(() => runScan(id, shards, config));
  return getJob(id);
}

function listAds(id, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
  const offset = Math.max(0, Number(options.offset) || 0);
  const sortColumns = { momentum: 'momentum_score DESC, start_date DESC', impressions: 'impressions_upper DESC NULLS LAST, start_date DESC',
    recent: 'start_date DESC', dropship: 'dropship_score DESC, momentum_score DESC' };
  const order = sortColumns[options.sort] || sortColumns.momentum;
  const minDropship = Math.max(0, Number(options.dropshipMin) || 0);
  const onlyImpressions = options.onlyImpressions ? 1 : 0;
  const where = 'scan_id = ? AND dropship_score >= ? AND (? = 0 OR impressions_upper IS NOT NULL)';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM scan_ads WHERE ${where}`).get(id, minDropship, onlyImpressions).n;
  const rows = db.prepare(`SELECT * FROM scan_ads WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(id, minDropship, onlyImpressions, limit, offset);
  return { total, limit, offset, ads: rows.map((row) => ({ ...JSON.parse(row.payload_json),
    matched_queries: JSON.parse(row.matched_queries_json), countries: JSON.parse(row.countries_json),
    dropship_signals: JSON.parse(row.signals_json), first_seen: row.first_seen, last_seen: row.last_seen })) };
}

function listStores(id, options = {}) {
  const rows = db.prepare('SELECT payload_json, matched_queries_json, countries_json FROM scan_ads WHERE scan_id=?').all(id);
  const stores = new Map();
  for (const row of rows) {
    const ad = JSON.parse(row.payload_json);
    const domain = extractStoreDomain(ad);
    if (!domain) continue;
    const store = stores.get(domain) || { domain, page_names: new Set(), ad_count: 0, active_ads: 0,
      latest_start: null, dropship_score: 0, momentum_score: 0, impressions_upper: null,
      matched_queries: new Set(), countries: new Set(), sample_ad: ad };
    store.ad_count += 1;
    if (ad.is_active) store.active_ads += 1;
    if (ad.page_name) store.page_names.add(ad.page_name);
    if (!store.latest_start || String(ad.start_date || '') > store.latest_start) store.latest_start = ad.start_date;
    store.dropship_score = Math.max(store.dropship_score, ad.dropship_score || 0);
    store.momentum_score = Math.max(store.momentum_score, ad.momentum_score || 0);
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

module.exports = { createScan, getJob, listAds, listStores, latestScans, runScan };
