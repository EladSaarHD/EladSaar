'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  buildScanShards, collectShardPages, expandQueries, extractStoreDomain, filterAdsToShardWindow,
  isWithinShardWindow, normalizeQueryTerms, normalizeScanWindow, scoreDropshippingAd, scoreMomentum,
} = require('../src/lib/deepScan');

test('buildScanShards expands seeds across countries and bounded date windows', () => {
  const shards = buildScanShards({
    queries: ['portable blender', 'neck fan'], countries: ['US', 'GB'],
    lookbackDays: 60, windowDays: 30, maxShards: 100, today: '2026-07-12',
  });
  assert.strictEqual(shards.length, 8);
  assert.deepStrictEqual(shards[0], {
    query: 'portable blender', country: 'US', startDate: '2026-06-13', endDate: '2026-07-12',
  });
});

test('buildScanShards caps excessive scans', () => {
  const shards = buildScanShards({ queries: Array.from({ length: 50 }, (_, i) => `q${i}`), countries: ['US'], lookbackDays: 365, windowDays: 7, maxShards: 25, today: '2026-07-12' });
  assert.strictEqual(shards.length, 25);
});

test('normalizeQueryTerms treats pipes as OR separators and removes wrapper quotes system-wide', () => {
  const terms = normalizeQueryTerms([
    '"% off" | "Worldwide Shipping"',
    'Relief, Sale Ends\nWorldwide Shipping',
  ]);
  assert.deepStrictEqual(terms, ['% off', 'Worldwide Shipping', 'Relief', 'Sale Ends']);
  const expanded = expandQueries(terms, { maxQueries: 100 });
  assert.deepStrictEqual(expanded.slice(0, 4), ['% off', 'Worldwide Shipping', 'Relief', 'Sale Ends']);
  assert.ok(expanded.includes('% off'));
  assert.ok(expanded.includes('Worldwide Shipping'));
  assert.ok(expanded.every((query) => !query.includes('|') && !query.includes('"')));
});

test('expandQueries creates diverse buyer-intent variants and dropshipping discovery phrases', () => {
  const regular = expandQueries(['portable blender'], { mode: 'deep', maxQueries: 50 });
  assert.ok(regular.includes('portable blender'));
  assert.ok(regular.includes('portable blender free shipping'));
  assert.ok(regular.length >= 10);
  const finder = expandQueries([], { mode: 'dropshipping', maxQueries: 50 });
  assert.ok(finder.includes('free worldwide shipping'));
  assert.ok(finder.includes('buy 1 get 1 free'));
});

test('extractStoreDomain returns a clean merchant domain and ignores Meta redirects', () => {
  assert.strictEqual(extractStoreDomain({ creative: { link_url: 'https://www.cool-store.com/products/item?utm_source=fb' } }), 'cool-store.com');
  assert.strictEqual(extractStoreDomain({ creative: { link_url: 'https://facebook.com/example' } }), null);
});

test('scoreDropshippingAd explains direct-response and storefront signals', () => {
  const result = scoreDropshippingAd({
    is_active: true,
    creative: {
      body: '50% off today only. Free worldwide shipping. Order now!',
      cta_text: 'Shop Now',
      link_url: 'https://example-shop.com/products/portable-blender',
    },
  });
  assert.ok(result.score >= 7);
  assert.ok(result.signals.includes('product-page URL'));
  assert.ok(result.signals.includes('direct-response offer'));
});

test('scoreMomentum prefers recent active ads and uses actual impressions when present', () => {
  const recent = scoreMomentum({ is_active: true, start_date: '2026-07-10', publisher_platforms: ['FACEBOOK', 'INSTAGRAM'], transparency: { impressions: { upper: 100000 } } }, { today: '2026-07-12' });
  const old = scoreMomentum({ is_active: false, start_date: '2025-01-01', publisher_platforms: ['FACEBOOK'] }, { today: '2026-07-12' });
  assert.ok(recent.score > old.score);
  assert.strictEqual(recent.impressionsUpper, 100000);
  assert.strictEqual(old.impressionsUpper, null);
});

test('collectShardPages follows Meta cursors until the unique-ad target is reached', async () => {
  const cursors = [];
  const unique = new Set();
  const payloads = [
    { ads: [{ ad_archive_id: '1' }, { ad_archive_id: '2' }], page_info: { has_next_page: true, end_cursor: 'cursor-2' } },
    { ads: [{ ad_archive_id: '2' }, { ad_archive_id: '3' }, { ad_archive_id: '4' }], page_info: { has_next_page: true, end_cursor: 'cursor-3' } },
  ];
  const result = await collectShardPages({
    initialParams: { q: 'shoes', country: 'US' }, targetAds: 4, maxPages: 5,
    fetchPage: async (params) => { cursors.push(params.cursor || null); return payloads[cursors.length - 1]; },
    saveAds: (ads) => ads.forEach((ad) => unique.add(ad.ad_archive_id)),
    getUniqueCount: () => unique.size,
    pause: async () => {},
  });
  assert.deepStrictEqual(cursors, [null, 'cursor-2']);
  assert.deepStrictEqual(result, { pages: 2, uniqueAds: 4, targetReached: true, exhausted: false, pageError: null });
});

test('collectShardPages preserves initial results when a continuation cursor fails', async () => {
  const unique = new Set();
  let calls = 0;
  const cursorError = new Error('Upstream returned an empty payload');
  const result = await collectShardPages({
    initialParams: { q: 'shoes', country: 'US' }, targetAds: 50, maxPages: 3,
    fetchPage: async (params) => {
      calls += 1;
      if (params.cursor) throw cursorError;
      return { ads: [{ ad_archive_id: '1' }, { ad_archive_id: '2' }], page_info: { has_next_page: true, end_cursor: 'bad-cursor' } };
    },
    saveAds: (ads) => ads.forEach((ad) => unique.add(ad.ad_archive_id)),
    getUniqueCount: () => unique.size,
    pause: async () => {},
  });
  assert.strictEqual(calls, 2);
  assert.strictEqual(result.pages, 1);
  assert.strictEqual(result.uniqueAds, 2);
  assert.strictEqual(result.exhausted, true);
  assert.strictEqual(result.pageError, cursorError);
});

test('strict shard windows reject missing, invalid, older and newer ad start dates', () => {
  const shard = { startDate: '2026-07-01', endDate: '2026-07-15' };
  const ads = [
    { ad_archive_id: 'start', start_date: '2026-07-01' },
    { ad_archive_id: 'middle', start_date: '2026-07-10' },
    { ad_archive_id: 'end', start_date: '2026-07-15' },
    { ad_archive_id: 'old', start_date: '2025-09-12' },
    { ad_archive_id: 'future', start_date: '2026-07-16' },
    { ad_archive_id: 'missing' },
    { ad_archive_id: 'malformed', start_date: '2026-7-1' },
    { ad_archive_id: 'impossible', start_date: '2026-02-30' },
  ];

  assert.strictEqual(isWithinShardWindow(ads[0], shard), true);
  assert.strictEqual(isWithinShardWindow(ads[2], shard), true);
  const filtered = filterAdsToShardWindow(ads, shard);
  assert.deepStrictEqual(filtered.ads.map((ad) => ad.ad_archive_id), ['start', 'middle', 'end']);
  assert.strictEqual(filtered.discarded, 5);
});

test('normalizeScanWindow accepts only the requested launch windows', () => {
  assert.deepStrictEqual([3, 7, 14, 21, 30, 60, 90].map(normalizeScanWindow), [3, 7, 14, 21, 30, 60, 90]);
  assert.throws(() => normalizeScanWindow(180), /Launch window/);
});
