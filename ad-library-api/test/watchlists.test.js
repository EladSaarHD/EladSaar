'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const db = require('../src/db');
const watchlists = require('../src/lib/watchlists');
const alerts = require('../src/lib/alerts');

const NOW = 1_800_000_000_000;
const idle = { cooling_down_ms: 0, hold_ms: 0, max_per_hour: 300, requests_60m: 10 };
const noScans = () => db.prepare("DELETE FROM scan_jobs WHERE status IN ('queued','running')").run();

function fakeService(started = []) {
  return { createScan: (input) => { started.push(input); return { id: `scan-${started.length}` }; }, getJob: (id) => fakeService.jobs?.[id] || null };
}

test('watchlist validation: terms, countries, window, size and frequency are bounded', () => {
  assert.throws(() => watchlists.create({ queries: '' }), /At least one search term/);
  assert.throws(() => watchlists.create({ queries: 'a|b|c|d|e|f' }), /at most 5 terms/);
  assert.throws(() => watchlists.create({ queries: 'x', countries: ['USA'] }), /two-letter/);
  assert.throws(() => watchlists.create({ queries: 'x', lookbackDays: 45 }), /Launch window/);
  assert.throws(() => watchlists.create({ queries: 'x', targetAds: 5000 }), /30-1000/);
  assert.throws(() => watchlists.create({ queries: 'x', everyMinutes: 5 }), /30 minutes/);
  const w = watchlists.create({ queries: '"posture corrector" | neck fan', everyMinutes: 60 }, NOW);
  assert.deepStrictEqual(w.queries, ['"posture corrector"', 'neck fan']);
  assert.strictEqual(w.incremental, true);
  assert.strictEqual(w.enabled, true);
  assert.strictEqual(w.next_run_at, NOW + 60000);
  assert.strictEqual(watchlists.update(w.id, { enabled: false }).enabled, false);
  assert.strictEqual(watchlists.update(w.id, { everyMinutes: 120 }).everyMinutes, 120);
  assert.ok(watchlists.remove(w.id));
  assert.strictEqual(watchlists.get(w.id), null);
});

test('tick starts one due incremental scan, only when idle, not rate-limited and within budget', () => {
  noScans();
  db.prepare('DELETE FROM watchlists').run();
  const w = watchlists.create({ name: 'tick test', queries: 'tick term', everyMinutes: 60, targetAds: 500 }, NOW - 120000); // due at NOW-60s
  const started = [];
  const svc = fakeService(started);
  const base = { now: NOW, service: svc };

  assert.deepStrictEqual(watchlists.tick({ ...base, pacing: { ...idle, cooling_down_ms: 60000 } }), { skipped: 'rate-limit' });
  assert.deepStrictEqual(watchlists.tick({ ...base, pacing: { ...idle, hold_ms: 5000 } }), { skipped: 'rate-limit' });
  assert.deepStrictEqual(watchlists.tick({ ...base, pacing: { ...idle, requests_60m: 250 } }), { skipped: 'budget' });
  db.prepare("INSERT INTO scan_jobs (id,status,config_json,total_shards,completed_shards,unique_ads,discarded_ads,created_at,updated_at) VALUES (?,'running','{}',1,0,0,0,?,?)").run(crypto.randomUUID(), NOW, NOW);
  assert.deepStrictEqual(watchlists.tick({ ...base, pacing: idle }), { skipped: 'busy' });
  noScans();
  assert.strictEqual(started.length, 0, 'nothing was started while any gate was closed');

  const result = watchlists.tick({ ...base, pacing: idle });
  assert.strictEqual(result.started, w.id);
  assert.strictEqual(started.length, 1);
  assert.strictEqual(started[0].incremental, true);
  assert.strictEqual(started[0].sort, 'recent');
  assert.strictEqual(started[0].targetAds, 500);
  assert.deepStrictEqual(started[0].queries, ['tick term']);
  const after = watchlists.get(w.id);
  assert.strictEqual(after.last_status, 'queued');
  assert.strictEqual(after.next_run_at, NOW + 60 * 60000, 'next run is an hour away');
  assert.deepStrictEqual(watchlists.tick({ ...base, pacing: idle }), { skipped: 'nothing due' });
  db.prepare('DELETE FROM watchlists').run();
});

test('tick records how a scheduled scan ended: a rate-limit failure pushes the next run out 2 h; other failures raise an alert', () => {
  noScans();
  db.prepare('DELETE FROM watchlists').run();
  const a = watchlists.create({ name: 'limited one', queries: 'rl watch', everyMinutes: 60 }, NOW);
  const b = watchlists.create({ name: 'broken one', queries: 'broken watch', everyMinutes: 60 }, NOW);
  db.prepare("UPDATE watchlists SET last_scan_id='s-a', last_status='running', next_run_at=? WHERE id=?").run(NOW + 3600000, a.id);
  db.prepare("UPDATE watchlists SET last_scan_id='s-b', last_status='running', next_run_at=? WHERE id=?").run(NOW + 3600000, b.id);
  fakeService.jobs = { 's-a': { status: 'failed', error: "Stopped by Meta's rate limit after collecting 0 ad(s)" }, 's-b': { status: 'failed', error: 'something else broke' } };
  watchlists.tick({ now: NOW, service: fakeService([]), pacing: { ...idle, cooling_down_ms: 1 } });
  fakeService.jobs = null;
  assert.strictEqual(watchlists.get(a.id).last_status, 'failed');
  assert.ok(watchlists.get(a.id).next_run_at >= NOW + 2 * 3600000, 'backed off for 2 h after a rate limit');
  assert.ok(alerts.list({ limit: 20 }).some((x) => x.kind === 'scheduled_scan_failed' && /broken one/.test(x.title)), 'a non-rate-limit failure alerts the owner');
  assert.ok(!alerts.list({ limit: 20 }).some((x) => /limited one/.test(x.title)), 'a rate limit already has its own alert; no duplicate');
  db.prepare('DELETE FROM watchlists').run();
});

test('alerts: de-duplicated, listable, acknowledgeable; a rate-limit episode alerts once and announces recovery once', () => {
  db.prepare('DELETE FROM alerts').run();
  assert.ok(alerts.raise('probe_kind', { title: 'one', dedupeMs: 60000, now: NOW }));
  assert.strictEqual(alerts.raise('probe_kind', { title: 'again', dedupeMs: 60000, now: NOW + 1000 }), null, 'same kind within the window is dropped');
  assert.ok(alerts.raise('probe_kind', { title: 'later', dedupeMs: 60000, now: NOW + 120000 }));
  assert.strictEqual(alerts.list({ unackedOnly: true }).length, 2);
  assert.strictEqual(alerts.ack('all'), 2);
  assert.strictEqual(alerts.unackedCount(), 0);

  alerts.noteRateLimit({ cooldown_ms: 300000, requests_10m: 40, requests_60m: 90 });
  alerts.noteRateLimit({ cooldown_ms: 900000, requests_10m: 41, requests_60m: 91 });
  assert.strictEqual(alerts.list({ unackedOnly: true }).filter((x) => x.kind === 'rate_limited').length, 1, 'one alert per episode');
  assert.match(alerts.list({ unackedOnly: true })[0].detail, /40 requests in the last 10 min/);
  alerts.noteSuccess();
  alerts.noteSuccess();
  const kinds = alerts.list({ unackedOnly: true }).map((x) => x.kind).sort();
  assert.deepStrictEqual(kinds, ['rate_limited', 'rate_limited_recovered'], 'recovery announced exactly once');
});
