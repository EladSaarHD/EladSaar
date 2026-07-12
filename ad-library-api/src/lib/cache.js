'use strict';

const crypto = require('crypto');

// Stable cache key: JSON with sorted keys so param order never matters.
function cacheKey(kind, params) {
  const normalized = stableStringify(params || {});
  return crypto.createHash('sha1').update(`${kind}:${normalized}`).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

// A cache bound to a better-sqlite3 database instance. Kept as a factory so
// tests can pass a throwaway in-memory/temp database.
function createCache(db) {
  const stmts = {
    get: db.prepare('SELECT payload_json, expires_at FROM response_cache WHERE key = ?'),
    upsert: db.prepare(`
      INSERT INTO response_cache (key, kind, params_json, payload_json, created_at, expires_at)
      VALUES (@key, @kind, @params_json, @payload_json, @created_at, @expires_at)
      ON CONFLICT(key) DO UPDATE SET
        payload_json = excluded.payload_json,
        created_at   = excluded.created_at,
        expires_at   = excluded.expires_at
    `),
    sweep: db.prepare('DELETE FROM response_cache WHERE expires_at <= ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM response_cache'),
  };

  return {
    cacheKey,

    // Returns the parsed payload if present and unexpired, else null.
    get(key, now = Date.now()) {
      const row = stmts.get.get(key);
      if (!row) return null;
      if (row.expires_at <= now) return null;
      try {
        return JSON.parse(row.payload_json);
      } catch {
        return null;
      }
    },

    set(key, kind, params, payload, ttlSeconds, now = Date.now()) {
      stmts.upsert.run({
        key,
        kind,
        params_json: JSON.stringify(params || {}),
        payload_json: JSON.stringify(payload),
        created_at: now,
        expires_at: now + ttlSeconds * 1000,
      });
    },

    sweepExpired(now = Date.now()) {
      return stmts.sweep.run(now).changes;
    },

    count() {
      return stmts.count.get().n;
    },
  };
}

module.exports = { createCache, cacheKey };
