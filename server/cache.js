'use strict';

// SQLite read-through cache + a request throttle for the upstream data API.
//
// Two concerns live here so every route gets them for free:
//   1. getCached(kind, key, ttlMs, fetchFn) — serve a fresh cached row if we
//      have one, otherwise call fetchFn (through the throttle), store, return.
//   2. throttle — a token-bucket queue that guarantees we never issue more than
//      `requestsPerMinute` upstream calls, so the free tier is never exceeded.

const db = require('./db');
const config = require('./config');

const selectStmt = db.prepare(
  'SELECT json, fetched_at FROM api_cache WHERE kind = ? AND key = ?'
);
const upsertStmt = db.prepare(
  `INSERT INTO api_cache (kind, key, json, fetched_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(kind, key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`
);

// ---- Throttle (token bucket, refilled continuously) ------------------------

const capacity = Math.max(1, config.provider.requestsPerMinute);
const refillPerMs = capacity / 60000; // tokens regained per millisecond
let tokens = capacity;
let lastRefill = Date.now();
const queue = [];

function refill() {
  const now = Date.now();
  tokens = Math.min(capacity, tokens + (now - lastRefill) * refillPerMs);
  lastRefill = now;
}

function pump() {
  refill();
  while (queue.length && tokens >= 1) {
    tokens -= 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject);
  }
  if (queue.length) {
    // Wake up when the next token is expected to be available.
    const waitMs = Math.ceil((1 - tokens) / refillPerMs);
    setTimeout(pump, Math.max(50, waitMs));
  }
}

// Run an async upstream call, but only once a rate-limit token is free.
function throttle(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

// ---- Read-through cache ----------------------------------------------------

async function getCached(kind, key, ttlMs, fetchFn) {
  const row = selectStmt.get(kind, key);
  if (row && Date.now() - row.fetched_at < ttlMs) {
    return { data: JSON.parse(row.json), cached: true };
  }
  try {
    const data = await throttle(fetchFn);
    upsertStmt.run(kind, key, JSON.stringify(data), Date.now());
    return { data, cached: false };
  } catch (err) {
    // On upstream failure, fall back to a stale cache entry if we have one —
    // better to show slightly old data than to blank the UI.
    if (row) return { data: JSON.parse(row.json), cached: true, stale: true };
    throw err;
  }
}

module.exports = { getCached, throttle };
