'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { createCache, cacheKey } = require('../src/lib/cache');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE response_cache (
      key TEXT PRIMARY KEY, kind TEXT, params_json TEXT, payload_json TEXT,
      created_at INTEGER, expires_at INTEGER
    );
  `);
  return db;
}

test('cacheKey is stable regardless of param order', () => {
  const a = cacheKey('search', { q: 'nike', country: 'US', first: 10 });
  const b = cacheKey('search', { first: 10, country: 'US', q: 'nike' });
  assert.strictEqual(a, b);
});

test('cacheKey differs by kind and by value', () => {
  const base = { q: 'nike' };
  assert.notStrictEqual(cacheKey('search', base), cacheKey('pages', base));
  assert.notStrictEqual(cacheKey('search', { q: 'nike' }), cacheKey('search', { q: 'adidas' }));
});

test('set then get returns the payload within TTL', () => {
  const cache = createCache(freshDb());
  const params = { q: 'nike' };
  const key = cache.cacheKey('search', params);
  cache.set(key, 'search', params, { ads: [1, 2, 3] }, 60, 1000);
  assert.deepStrictEqual(cache.get(key, 1000), { ads: [1, 2, 3] });
});

test('expired entries are a miss', () => {
  const cache = createCache(freshDb());
  const key = cache.cacheKey('search', { q: 'x' });
  cache.set(key, 'search', { q: 'x' }, { ok: true }, 1, 1000); // expires at 2000
  assert.strictEqual(cache.get(key, 2001), null);
});

test('unknown key is a miss', () => {
  const cache = createCache(freshDb());
  assert.strictEqual(cache.get('nope'), null);
});

test('sweepExpired removes only stale rows', () => {
  const cache = createCache(freshDb());
  cache.set(cache.cacheKey('a', {}), 'a', {}, {}, 1, 1000); // expires 2000
  cache.set(cache.cacheKey('b', {}), 'b', {}, {}, 100, 1000); // expires 101000
  const removed = cache.sweepExpired(50000);
  assert.strictEqual(removed, 1);
  assert.strictEqual(cache.count(), 1);
});
