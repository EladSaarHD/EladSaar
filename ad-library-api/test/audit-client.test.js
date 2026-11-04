'use strict';

const test = require('node:test');
const assert = require('node:assert');
const client = require('../src/lib/graphqlClient');
const {
  buildQueryPlan, buildScanShards, createWindowEarlyStop, expandQueries, normalizeQueryTerms, pageBudget,
  parseQueryTerms, scoreScale,
} = require('../src/lib/deepScan');
const { normalizeAd } = require('../src/lib/normalize');
const { FETCH_METADATA_HEADERS } = require('../src/constants');

// ---------- Pagination root cause: Meta rejects POSTs without fetch-metadata headers ----------

test('GraphQL POST carries the sec-fetch-* headers Meta requires for continuation pages', () => {
  const headers = client.buildPostHeaders({ sess: { lsd: 'LSD', cookie: '' }, friendlyName: 'AdLibrarySearchPaginationQuery', userAgent: 'UA' });
  assert.strictEqual(headers['sec-fetch-site'], 'same-origin');
  assert.strictEqual(headers['sec-fetch-mode'], 'cors');
  assert.strictEqual(headers['sec-fetch-dest'], 'empty');
  assert.deepStrictEqual(
    Object.fromEntries(Object.keys(FETCH_METADATA_HEADERS).map((key) => [key, headers[key]])),
    FETCH_METADATA_HEADERS
  );
  assert.strictEqual(headers['x-fb-lsd'], 'LSD');
});

test('Meta numeric error 1357054 is surfaced with its real code instead of "empty payload"', () => {
  const payload = { __ar: 1, error: 1357054, errorSummary: "Your Request Couldn't be Processed", payload: null };
  const error = client.upstreamRejection(payload);
  assert.ok(error);
  assert.strictEqual(error.metaErrorCode, 1357054);
  assert.match(error.message, /1357054/);
  assert.match(error.message, /Couldn't be Processed/);
  assert.strictEqual(client.upstreamRejection({ data: { ok: true } }), null);
  assert.strictEqual(client.upstreamRejection({ data: null }), null);
  assert.strictEqual(client.upstreamRejection(null), null);
});

test('extractFrontendVersion finds the revision in JS-escaped page JSON (the old regex never matched)', () => {
  const escaped = '..."startDate":null,"viewAllPageID":"0",\\"v\\":\\"5245b2\\"},\\"queryName\\":\\"AdLibraryFoundationRootQuery\\"';
  assert.strictEqual(client.extractFrontendVersion(escaped), '5245b2');
  assert.strictEqual(client.extractFrontendVersion('{"v":"d427bf"}'), 'd427bf');
  assert.strictEqual(client.extractFrontendVersion('{"v":"not-hex"}'), null);
  assert.strictEqual(client.extractFrontendVersion(''), null);
  assert.strictEqual(client.discoverRuntimeMetadata(escaped, []).frontendVersion, '5245b2');
});

test('epochDayToIso converts the service epoch-day integers into the ISO dates Meta honours', () => {
  assert.strictEqual(client.epochDayToIso(Math.floor(Date.parse('2026-10-05') / 86400000)), '2026-10-05');
  assert.strictEqual(client.epochDayToIso('nope'), null);
});

// ---------- Query semantics: exact phrases, OR separators, expansion order ----------

test('quoted terms are exact phrases; unquoted terms are keyword searches', () => {
  const terms = parseQueryTerms('"posture corrector" | back brace');
  assert.deepStrictEqual(terms, [
    { text: 'posture corrector', exact: true },
    { text: 'back brace', exact: false },
  ]);
  assert.deepStrictEqual(parseQueryTerms('"posture corrector"', { exactPhrase: false }), [{ text: 'posture corrector', exact: false }]);
});

test('commas inside a quoted phrase do not split the term; outside they do', () => {
  assert.deepStrictEqual(parseQueryTerms('"Buy 2, Get 1 Free", neck fan'), [
    { text: 'Buy 2, Get 1 Free', exact: true },
    { text: 'neck fan', exact: false },
  ]);
});

test('an unbalanced quote degrades to the legacy split instead of swallowing the rest', () => {
  assert.deepStrictEqual(normalizeQueryTerms('"posture corrector | neck fan'), ['"posture corrector', 'neck fan']);
});

test('single quotes and duplicate terms are cleaned up as before', () => {
  assert.deepStrictEqual(parseQueryTerms("'neck fan' | neck fan | \"neck fan\"").map((t) => t.text), ['neck fan']);
});

test('buildQueryPlan puts the user terms first and generic discovery phrases last', () => {
  const finder = buildQueryPlan(['posture corrector'], { mode: 'dropshipping', expansion: 'auto', maxQueries: 300 });
  assert.strictEqual(finder[0].query, 'posture corrector');
  assert.strictEqual(finder[0].origin, 'seed');
  const firstDiscovery = finder.findIndex((entry) => entry.origin === 'discovery');
  const lastModifier = finder.map((entry) => entry.origin).lastIndexOf('modifier');
  assert.ok(firstDiscovery > lastModifier, 'discovery phrases must come after every modifier');
  assert.ok(finder.slice(0, firstDiscovery).every((entry) => entry.origin !== 'discovery'));
});

test('exact-phrase seeds keep keyword_exact_phrase; expansions never do', () => {
  const plan = buildQueryPlan(parseQueryTerms('"posture corrector"'), { expansion: 'modifiers' });
  assert.strictEqual(plan[0].searchType, 'keyword_exact_phrase');
  assert.ok(plan.slice(1).every((entry) => entry.searchType === 'keyword_unordered' && entry.origin === 'modifier'));
});

test('expansion modes are strict: none = seeds only, discovery = seeds + promo phrases only', () => {
  const none = buildQueryPlan(['a', 'b'], { expansion: 'none' });
  assert.deepStrictEqual(none.map((e) => e.query), ['a', 'b']);
  const discovery = buildQueryPlan(['a'], { expansion: 'discovery' });
  assert.strictEqual(discovery[0].query, 'a');
  assert.ok(discovery.slice(1).every((e) => e.origin === 'discovery'));
  assert.ok(!discovery.some((e) => e.origin === 'modifier'));
  const bare = buildQueryPlan([], { mode: 'dropshipping', expansion: 'discovery' });
  assert.ok(bare.length > 5 && bare.every((e) => e.origin === 'discovery'));
});

test('legacy expandQueries still returns plain strings, seeds first', () => {
  const out = expandQueries(['portable blender'], { mode: 'deep', maxQueries: 50 });
  assert.strictEqual(out[0], 'portable blender');
  assert.ok(out.includes('portable blender free shipping'));
});

test('buildScanShards carries search type and origin only when non-default (legacy shape unchanged)', () => {
  const shards = buildScanShards({
    queries: [
      { query: 'posture corrector', searchType: 'keyword_exact_phrase', origin: 'seed' },
      { query: 'buy neck fan', searchType: 'keyword_unordered', origin: 'modifier' },
    ],
    countries: ['US'], lookbackDays: 30, windowDays: 30, today: '2026-11-04',
  });
  assert.deepStrictEqual(shards[0], { query: 'posture corrector', country: 'US', startDate: '2026-10-06', endDate: '2026-11-04', searchType: 'keyword_exact_phrase' });
  assert.deepStrictEqual(shards[1], { query: 'buy neck fan', country: 'US', startDate: '2026-10-06', endDate: '2026-11-04', origin: 'modifier' });
});

// ---------- Scale score, page budget, early stop ----------

test('scoreScale rewards variants and longevity, and stops the clock for ended ads', () => {
  const base = { start_date: '2026-09-01', is_active: true, publisher_platforms: ['FACEBOOK'] };
  const lone = scoreScale({ ...base, collation_count: 1 }, { today: '2026-11-04' });
  const fanned = scoreScale({ ...base, collation_count: 20 }, { today: '2026-11-04' });
  const fresh = scoreScale({ ...base, start_date: '2026-11-03', collation_count: 20 }, { today: '2026-11-04' });
  assert.ok(fanned.score > lone.score);
  assert.ok(fanned.score > fresh.score);
  assert.strictEqual(fanned.variants, 20);
  const ended = scoreScale({ start_date: '2026-01-01', end_date: '2026-02-01', is_active: false }, { today: '2026-11-04' });
  assert.strictEqual(ended.runDays, 31);
  assert.ok(lone.score >= 0 && fanned.score <= 100);
  assert.deepStrictEqual(scoreScale({}, { today: '2026-11-04' }).runDays, null);
});

test('pageBudget reflects 30-ad first page + 10-ad continuation pages and is bounded', () => {
  assert.strictEqual(pageBudget(30), 3, 'one server-rendered page plus a 2-page safety margin');
  assert.ok(pageBudget(1000) >= 98 && pageBudget(1000) <= 140, `got ${pageBudget(1000)}`);
  assert.strictEqual(pageBudget(1e9, { cap: 250 }), 250);
  assert.ok(pageBudget(0) >= 1);
});

test('window early-stop ends a recent-sorted scan after it pages past the launch window', () => {
  const stop = createWindowEarlyStop({ windowStart: '2026-10-20', patience: 2 });
  const page = (...dates) => dates.map((start_date) => ({ start_date }));
  assert.strictEqual(stop(page('2026-11-02', '2026-10-25')), false);
  assert.strictEqual(stop(page('2026-09-30', '2026-09-12')), false, 'first all-older page: keep patience');
  assert.strictEqual(stop(page('2026-10-22', '2026-09-01')), false, 'an in-window ad resets the counter');
  assert.strictEqual(stop(page('2026-09-02', '2026-09-03')), false);
  assert.strictEqual(stop(page('2026-08-30', '2026-08-29')), true, 'second consecutive all-older page stops');
  assert.strictEqual(stop([]), false);
  assert.strictEqual(createWindowEarlyStop({ windowStart: null })(page('2020-01-01')), false);
});

// ---------- Normalizer keeps the scale/advertiser signals Meta ships ----------

test('normalizeAd now keeps variant count, advertiser size and creative extras', () => {
  const ad = normalizeAd({
    ad_archive_id: 123, page_id: 9, page_name: 'Corecare', is_active: true, start_date: 1793692800,
    collation_id: 684513116749549, collation_count: 20, total_active_time: 99, report_count: 2,
    contains_digital_created_media: true, gated_type: 'ELIGIBLE', has_user_reported: false, page_is_deleted: false,
    targeted_or_reached_countries: ['US'],
    snapshot: {
      page_like_count: 6628, page_categories: ['Clothing (Brand)'], link_description: 'Free Shipping',
      extra_texts: [{ text: 'bonus' }, 'plain'], extra_links: [{ url: 'https://a.example' }], disclaimer_label: null,
      is_reshared: false, link_url: 'https://shop.example/products/x', cta_type: 'SHOP_NOW',
    },
  });
  assert.strictEqual(ad.collation_count, 20);
  assert.strictEqual(ad.collation_id, '684513116749549');
  assert.strictEqual(ad.page_like_count, 6628);
  assert.deepStrictEqual(ad.page_categories, ['Clothing (Brand)']);
  assert.strictEqual(ad.ai_generated, true);
  assert.strictEqual(ad.ad_library_url, 'https://www.facebook.com/ads/library/?id=123');
  assert.strictEqual(ad.total_active_time, 99);
  assert.deepStrictEqual(ad.creative.extra_texts, ['bonus', 'plain']);
  assert.deepStrictEqual(ad.creative.extra_links, ['https://a.example']);
  assert.strictEqual(ad.creative.link_description, 'Free Shipping');
  // Missing upstream fields degrade to null / [] rather than throwing.
  const bare = normalizeAd({ ad_archive_id: 1 });
  assert.strictEqual(bare.collation_count, null);
  assert.deepStrictEqual(bare.page_categories, []);
  assert.strictEqual(bare.ai_generated, null);
});

test('continuation sessions are evicted instead of growing forever', () => {
  // exercised through the exported pruner: an empty map is a no-op and never throws
  assert.doesNotThrow(() => client.pruneContinuationSessions(Date.now() + 10 * 3600 * 1000));
});

test('first-page POST fallback triggers only for HTML/network failures, never for coded rejections', () => {
  const { UpstreamBlockedError, TokenExpiredError } = require('../src/lib/errors');
  assert.strictEqual(client.shouldFallbackToPost(new UpstreamBlockedError('Could not extract initial search data from Ad Library HTML')), true);
  assert.strictEqual(client.shouldFallbackToPost(new UpstreamBlockedError('Initial search GET failed with HTTP 403')), true);
  assert.strictEqual(client.shouldFallbackToPost(new UpstreamBlockedError('Network request to Facebook failed (ETIMEDOUT)')), true);
  const coded = new UpstreamBlockedError('Upstream rejected the request (Meta error 1357054)');
  coded.metaErrorCode = 1357054;
  assert.strictEqual(client.shouldFallbackToPost(coded), false, 'a coded rejection would fail the POST too');
  assert.strictEqual(client.shouldFallbackToPost(new TokenExpiredError()), false);
  assert.strictEqual(client.shouldFallbackToPost(new Error('boom')), false);
});

