'use strict';

// Every time Meta rate-limits us, remember how hard we had been pushing just before: that is the only
// way to learn the real threshold instead of guessing it.
const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS rate_limit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    reason TEXT,
    requests_10m INTEGER,
    requests_60m INTEGER,
    delay_ms INTEGER,
    cooldown_ms INTEGER
  );
`);

const insertStmt = db.prepare(`INSERT INTO rate_limit_events (at, reason, requests_10m, requests_60m, delay_ms, cooldown_ms)
  VALUES (@at, @reason, @requests_10m, @requests_60m, @delay_ms, @cooldown_ms)`);

function record(event) {
  try { insertStmt.run({ reason: null, requests_10m: null, requests_60m: null, delay_ms: null, cooldown_ms: null, ...event }); } catch { /* never let logging break a scan */ }
}

function recent(limit = 20) {
  return db.prepare('SELECT * FROM rate_limit_events ORDER BY at DESC LIMIT ?').all(limit);
}

function countSince(ms, now = Date.now()) {
  return db.prepare('SELECT COUNT(*) AS n FROM rate_limit_events WHERE at >= ?').get(now - ms).n;
}

module.exports = { record, recent, countSince };
