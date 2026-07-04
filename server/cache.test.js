'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Point the cache at a throwaway data dir + a generous rate limit before load.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-cache-'));
process.env.PROVIDER_RPM = '600'; // 10/sec so throttling doesn't slow the test
const { getCached, throttle } = require('./cache');

test('getCached calls fetchFn once, then serves from cache within TTL', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { n: calls };
  };
  const a = await getCached('t', 'k1', 60_000, fetchFn);
  const b = await getCached('t', 'k1', 60_000, fetchFn);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(calls, 1);
  assert.deepEqual(b.data, { n: 1 });
});

test('getCached refetches once the TTL has expired', async () => {
  let calls = 0;
  const fetchFn = async () => ({ n: ++calls });
  await getCached('t', 'k2', 0, fetchFn); // ttl 0 → always stale
  await getCached('t', 'k2', 0, fetchFn);
  assert.equal(calls, 2);
});

test('getCached falls back to a stale entry when the refetch fails', async () => {
  let calls = 0;
  const good = async () => ({ ok: ++calls });
  await getCached('t', 'k3', 0, good); // seed cache
  const res = await getCached('t', 'k3', 0, async () => {
    throw new Error('upstream down');
  });
  assert.equal(res.stale, true);
  assert.deepEqual(res.data, { ok: 1 });
});

test('throttle runs work and returns its resolved value', async () => {
  const out = await throttle(async () => 42);
  assert.equal(out, 42);
});
