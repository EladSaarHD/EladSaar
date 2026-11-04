'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Stub the Meta-facing client BEFORE the canary loads it.
let responder = null;
const clientPath = require.resolve('../src/lib/graphqlClient');
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: { request: async ({ variables }) => responder(variables) },
};

const { runCanary, checkCanary, lastCanary } = require('../src/lib/canary');

function searchData({ ads, next }) {
  return {
    ad_library_main: {
      search_results_connection: {
        count: 1234,
        edges: [{ node: { collated_results: Array.from({ length: ads }, (_, i) => ({ ad_archive_id: String(i + 1), snapshot: {} })) } }],
        page_info: { has_next_page: next, end_cursor: next ? 'CURSOR' : null },
      },
    },
  };
}

test('canary passes only when BOTH the first page and a continuation page return ads', async () => {
  const seen = [];
  responder = (variables) => {
    seen.push(variables.cursor || null);
    return variables.cursor ? searchData({ ads: 10, next: true }) : searchData({ ads: 30, next: true });
  };
  const result = await runCanary();
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(seen, [null, seen[1]]);
  assert.ok(seen[1], 'second request must carry the cursor from page one');
  assert.strictEqual(result.steps.first_page.ads, 30);
  assert.strictEqual(result.steps.continuation.ads, 10);
  assert.strictEqual(lastCanary().ok, true);
});

test('canary FAILS when continuation is rejected, even though page one works (the July regression)', async () => {
  responder = (variables) => {
    if (variables.cursor) {
      const error = new Error('Upstream rejected the request (Meta error 1357054: Your Request Couldn\'t be Processed)');
      error.metaErrorCode = 1357054;
      throw error;
    }
    return searchData({ ads: 30, next: true });
  };
  const result = await runCanary();
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.meta_error_code, 1357054);
  assert.match(result.error, /1357054/);
  assert.strictEqual(result.steps.first_page.ads, 30);
  assert.strictEqual(lastCanary().ok, false);
});

test('canary fails when page one has no continuation cursor or no ads', async () => {
  responder = () => searchData({ ads: 30, next: false });
  assert.match((await runCanary()).error, /no continuation cursor/);
  responder = () => searchData({ ads: 0, next: false });
  assert.match((await runCanary()).error, /no ads/);
});

test('checkCanary reuses a fresh result instead of hitting Meta again', async () => {
  let hits = 0;
  responder = () => { hits += 1; return searchData({ ads: 30, next: true }); };
  await runCanary();
  const before = hits;
  const cached = await checkCanary({ maxAgeMs: 60000 });
  assert.strictEqual(cached.cached, true);
  assert.strictEqual(hits, before);
  const fresh = await checkCanary({ maxAgeMs: 0 });
  assert.ok(!fresh.cached);
  assert.ok(hits > before);
});

test('the canary is paused (not "failed") while Meta is rate-limiting, and makes no request', async () => {
  const rateEvents = require('../src/lib/rateEvents');
  const client = require('../src/lib/graphqlClient');
  const { runCanary } = require('../src/lib/canary');
  const realRequest = client.request;
  let calls = 0;
  client.request = async () => { calls += 1; throw new Error('must not be called'); };
  try {
    rateEvents.record({ at: Date.now() - 60000, reason: 'test rate limit', cooldown_ms: 300000 });
    const result = await runCanary();
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.ok, null, 'neither healthy nor broken');
    assert.match(result.error, /rate-limited this connection recently/);
    assert.strictEqual(calls, 0);
  } finally {
    client.request = realRequest;
    require('../src/db').prepare("DELETE FROM rate_limit_events WHERE reason = 'test rate limit'").run();
  }
});
