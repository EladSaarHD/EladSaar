'use strict';

// Things that need a human's eyes (Meta rate-limited us, the live check broke, a scheduled scan failed) and the
// matching "recovered" notices. Stored in the database, de-duplicated, and picked up by whatever already talks to
// the owner (Hunter's watchdog) via GET /api/alerts?unacked=1; an optional webhook gets them instantly.
const db = require('../db');
const config = require('../../config');

db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warn',
    title TEXT NOT NULL,
    detail TEXT,
    acked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_kind_at ON alerts(kind, at);
`);

function raise(kind, { title, detail = '', severity = 'warn', dedupeMs = 0, now = Date.now() } = {}) {
  if (dedupeMs > 0) {
    const recent = db.prepare('SELECT id FROM alerts WHERE kind = ? AND at > ? LIMIT 1').get(kind, now - dedupeMs);
    if (recent) return null;
  }
  const info = db.prepare('INSERT INTO alerts (at, kind, severity, title, detail) VALUES (?, ?, ?, ?, ?)')
    .run(now, kind, severity, String(title).slice(0, 200), String(detail).slice(0, 800));
  console.warn(`[alert:${kind}] ${title}`);
  sendWebhook({ kind, severity, title, detail });
  return info.lastInsertRowid;
}

function sendWebhook(alert) {
  if (!config.alertWebhookUrl) return;
  const text = `${alert.severity === 'info' ? '✅' : '⚠️'} AdSignal: ${alert.title}${alert.detail ? `\n${alert.detail}` : ''}`;
  fetch(config.alertWebhookUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ...alert }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => { /* an unreachable webhook must never break a scan */ });
}

function list({ unackedOnly = false, limit = 50 } = {}) {
  const where = unackedOnly ? 'WHERE acked_at IS NULL' : '';
  return db.prepare(`SELECT * FROM alerts ${where} ORDER BY at DESC, id DESC LIMIT ?`).all(Math.max(1, Math.min(Number(limit) || 50, 200)));
}

function ack(ids, now = Date.now()) {
  if (ids === 'all') return db.prepare('UPDATE alerts SET acked_at = ? WHERE acked_at IS NULL').run(now).changes;
  const clean = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  if (!clean.length) return 0;
  return db.prepare(`UPDATE alerts SET acked_at = ? WHERE acked_at IS NULL AND id IN (${clean.map(() => '?').join(',')})`).run(now, ...clean).changes;
}

function unackedCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE acked_at IS NULL').get().n;
}

// A rate-limit "episode": one alert when it starts, one when the first request afterwards succeeds.
let episodeOpen = (() => {
  const lastLimit = db.prepare("SELECT at FROM alerts WHERE kind = 'rate_limited' ORDER BY at DESC LIMIT 1").get();
  if (!lastLimit) return false;
  return !db.prepare("SELECT 1 FROM alerts WHERE kind = 'rate_limited_recovered' AND at > ? LIMIT 1").get(lastLimit.at);
})();

function noteRateLimit(event) {
  episodeOpen = true;
  const cool = Math.round((event.cooldown_ms || 0) / 60000);
  return raise('rate_limited', {
    title: 'Meta is rate-limiting AdSignal',
    detail: `Scans pause and searches return "try again later" (cool-down ${cool} min, then a slower pace for 2 h). ${event.requests_10m ?? '?'} requests in the last 10 min, ${event.requests_60m ?? '?'} in the last hour. Nothing is lost; stored data still works.`,
    dedupeMs: 2 * 3600000,
  });
}

function noteSuccess() {
  if (!episodeOpen) return null;
  episodeOpen = false;
  return raise('rate_limited_recovered', { title: 'Meta is answering AdSignal again', detail: 'The first request after the rate limit succeeded. Scans and searches work; the pace stays slow for a while.', severity: 'info' });
}

module.exports = { raise, list, ack, unackedCount, noteRateLimit, noteSuccess };
