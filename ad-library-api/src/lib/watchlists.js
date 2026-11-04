'use strict';

// Scheduled, polite, incremental scans of terms the owner cares about ("watchlists"). One scan per tick, only
// when the service is idle, Meta is not limiting us, and the hourly request budget has room.
const crypto = require('crypto');
const db = require('../db');
const config = require('../../config');
const alerts = require('./alerts');

db.exec(`
  CREATE TABLE IF NOT EXISTS watchlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    queries_json TEXT NOT NULL,
    countries_json TEXT NOT NULL,
    lookback_days INTEGER NOT NULL,
    target_ads INTEGER NOT NULL,
    every_minutes INTEGER NOT NULL,
    incremental INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at INTEGER NOT NULL,
    last_run_at INTEGER,
    last_scan_id TEXT,
    last_status TEXT,
    last_note TEXT,
    created_at INTEGER NOT NULL
  );
`);

const WINDOWS = [3, 7, 14, 21, 30, 60, 90];
const MAX_WATCHES = 12;

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'invalid_watchlist';
  return error;
}

function normalize(input, existing = null) {
  const pick = (key, fallback) => (input[key] !== undefined ? input[key] : fallback);
  const rawQueries = pick('queries', existing?.queries);
  const queries = (Array.isArray(rawQueries) ? rawQueries : String(rawQueries || '').split(/[\n|]+/)).map((q) => String(q).trim()).filter(Boolean);
  if (!queries.length) throw invalid('At least one search term is required');
  if (queries.length > 5) throw invalid('A watchlist can hold at most 5 terms');
  const name = String(pick('name', existing?.name) || queries[0]).trim().slice(0, 60);
  const countries = (pick('countries', existing?.countries) || ['US']).map((c) => String(c).toUpperCase());
  if (!countries.length || countries.length > 3 || countries.some((c) => !/^[A-Z]{2}$/.test(c))) throw invalid('Use 1-3 two-letter country codes');
  const lookbackDays = Number(pick('lookbackDays', existing?.lookbackDays ?? 14));
  if (!WINDOWS.includes(lookbackDays)) throw invalid(`Launch window must be one of ${WINDOWS.join(', ')} days`);
  const targetAds = Number(pick('targetAds', existing?.targetAds ?? 600));
  if (!Number.isFinite(targetAds) || targetAds < 30 || targetAds > 1000) throw invalid('Scheduled scans collect 30-1000 ads (bigger ones are run by hand)');
  const everyMinutes = Number(pick('everyMinutes', existing?.everyMinutes ?? 60));
  if (!Number.isFinite(everyMinutes) || everyMinutes < 30 || everyMinutes > 10080) throw invalid('Run every 30 minutes to 7 days');
  return { name, queries, countries, lookbackDays, targetAds, everyMinutes, incremental: pick('incremental', existing?.incremental ?? true) !== false };
}

function present(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, queries: JSON.parse(row.queries_json), countries: JSON.parse(row.countries_json),
    lookbackDays: row.lookback_days, targetAds: row.target_ads, everyMinutes: row.every_minutes, incremental: Boolean(row.incremental),
    enabled: Boolean(row.enabled), next_run_at: row.next_run_at, last_run_at: row.last_run_at, last_scan_id: row.last_scan_id,
    last_status: row.last_status, last_note: row.last_note, created_at: row.created_at };
}

const list = () => db.prepare('SELECT * FROM watchlists ORDER BY created_at ASC').all().map(present);
const get = (id) => present(db.prepare('SELECT * FROM watchlists WHERE id = ?').get(id));

function create(input, now = Date.now()) {
  if (db.prepare('SELECT COUNT(*) AS n FROM watchlists').get().n >= MAX_WATCHES) throw invalid(`At most ${MAX_WATCHES} watchlists`);
  const w = normalize(input || {});
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO watchlists (id,name,queries_json,countries_json,lookback_days,target_ads,every_minutes,incremental,enabled,next_run_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,1,?,?)`).run(id, w.name, JSON.stringify(w.queries), JSON.stringify(w.countries), w.lookbackDays, w.targetAds, w.everyMinutes, w.incremental ? 1 : 0, now + 60000, now);
  return get(id);
}

function update(id, patch, now = Date.now()) {
  const current = get(id);
  if (!current) return null;
  const w = normalize(patch || {}, current);
  const enabled = patch.enabled === undefined ? current.enabled : Boolean(patch.enabled);
  db.prepare(`UPDATE watchlists SET name=?, queries_json=?, countries_json=?, lookback_days=?, target_ads=?, every_minutes=?, incremental=?, enabled=? WHERE id=?`)
    .run(w.name, JSON.stringify(w.queries), JSON.stringify(w.countries), w.lookbackDays, w.targetAds, w.everyMinutes, w.incremental ? 1 : 0, enabled ? 1 : 0, id);
  return get(id);
}

const remove = (id) => db.prepare('DELETE FROM watchlists WHERE id = ?').run(id).changes > 0;

function runNow(id, now = Date.now()) {
  if (!get(id)) return null;
  db.prepare('UPDATE watchlists SET next_run_at = ?, enabled = 1 WHERE id = ?').run(now, id);
  return get(id);
}

// One scheduling decision. `deps` exists so the decision logic can be tested without Meta or the real clock.
function tick(deps = {}) {
  const now = deps.now ?? Date.now();
  const service = deps.service || require('./deepScanService');
  const pacing = deps.pacing || require('./graphqlClient').getPacing();

  // 1. record how the last scheduled scans ended
  const open = db.prepare("SELECT * FROM watchlists WHERE last_scan_id IS NOT NULL AND (last_status IS NULL OR last_status IN ('queued','running'))").all();
  for (const row of open) {
    const job = service.getJob(row.last_scan_id);
    if (!job || !['complete', 'failed'].includes(job.status)) continue;
    const note = String(job.error || '').slice(0, 300);
    let next = row.next_run_at;
    if (job.status === 'failed') {
      if (/rate limit/i.test(note)) next = Math.max(next, now + 2 * 3600000);
      else alerts.raise('scheduled_scan_failed', { title: `Scheduled scan "${row.name}" failed`, detail: note, dedupeMs: 6 * 3600000, now });
    }
    db.prepare('UPDATE watchlists SET last_status = ?, last_note = ?, next_run_at = ? WHERE id = ?').run(job.status, note, next, row.id);
  }

  // 2. gates: never add load when the service is busy, Meta is pushing back, or the hourly budget is mostly spent
  const busy = db.prepare("SELECT COUNT(*) AS n FROM scan_jobs WHERE status IN ('queued','running')").get().n;
  if (busy) return { skipped: 'busy' };
  if (pacing.cooling_down_ms > 0 || pacing.hold_ms > 0) return { skipped: 'rate-limit' };
  if (pacing.max_per_hour > 0 && pacing.requests_60m >= 0.7 * pacing.max_per_hour) return { skipped: 'budget' };

  // 3. start the most overdue watchlist (one per tick)
  const due = db.prepare('SELECT * FROM watchlists WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT 1').get(now);
  if (!due) return { skipped: 'nothing due' };
  const next = now + due.every_minutes * 60000;
  try {
    const job = service.createScan({ queries: JSON.parse(due.queries_json), countries: JSON.parse(due.countries_json), lookbackDays: due.lookback_days,
      targetAds: due.target_ads, sort: 'recent', incremental: Boolean(due.incremental), activeStatus: 'active' });
    db.prepare("UPDATE watchlists SET last_run_at = ?, last_scan_id = ?, last_status = 'queued', last_note = NULL, next_run_at = ? WHERE id = ?").run(now, job.id, next, due.id);
    return { started: due.id, scan: job.id };
  } catch (error) {
    db.prepare("UPDATE watchlists SET last_status = 'failed', last_note = ?, next_run_at = ? WHERE id = ?").run(String(error.message).slice(0, 300), next, due.id);
    alerts.raise('scheduled_scan_failed', { title: `Scheduled scan "${due.name}" could not start`, detail: error.message, dedupeMs: 6 * 3600000, now });
    return { error: error.message };
  }
}

function startScheduler({ intervalMs = 60000 } = {}) {
  if (!config.watchScheduler) return null;
  const timer = setInterval(() => { try { tick(); } catch (error) { console.error('[watchlists]', error.message); } }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { list, get, create, update, remove, runNow, tick, startScheduler, normalize };
