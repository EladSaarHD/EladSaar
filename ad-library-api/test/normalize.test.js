'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const {
  normalizeSearchResponse,
  normalizeDetails,
  unixToDate,
  parseMagnitude,
} = require('../src/lib/normalize');

const searchRaw = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'search-response.json'), 'utf8')
);
const detailsRaw = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'details-response.json'), 'utf8')
);

test('unixToDate converts and guards', () => {
  assert.strictEqual(unixToDate(1704067200), '2024-01-01');
  assert.strictEqual(unixToDate(null), null);
  assert.strictEqual(unixToDate(0), null);
  assert.strictEqual(unixToDate('abc'), null);
});

test('parseMagnitude handles K/M/B and plain numbers', () => {
  assert.strictEqual(parseMagnitude('10K'), 10000);
  assert.strictEqual(parseMagnitude('1.2M'), 1200000);
  assert.strictEqual(parseMagnitude('500'), 500);
  assert.strictEqual(parseMagnitude(''), null);
});

test('search response normalizes every ad', () => {
  const out = normalizeSearchResponse(searchRaw);
  assert.strictEqual(out.count, 4213);
  assert.strictEqual(out.ads.length, 5);
  assert.strictEqual(out.page_info.has_next_page, true);
  assert.strictEqual(out.page_info.end_cursor, 'AQHRncExampleCursorTokenZZ==');
});

test('commercial image ad maps creative + null transparency', () => {
  const ad = normalizeSearchResponse(searchRaw).ads[0];
  assert.strictEqual(ad.ad_archive_id, '1234567890123401');
  assert.strictEqual(ad.page_name, 'Nike');
  assert.strictEqual(ad.is_active, true);
  assert.strictEqual(ad.start_date, '2024-01-01');
  assert.strictEqual(ad.display_format, 'IMAGE');
  assert.strictEqual(ad.creative.title, 'Nike Air Max');
  assert.match(ad.creative.body, /Air Max collection/);
  assert.strictEqual(ad.creative.images.length, 1);
  assert.strictEqual(ad.creative.images[0].original_url, 'https://scontent.xx.fbcdn.net/airmax_orig.jpg');
  assert.strictEqual(ad.transparency, null);
});

test('video ad maps videos and null end_date', () => {
  const ad = normalizeSearchResponse(searchRaw).ads[1];
  assert.strictEqual(ad.display_format, 'VIDEO');
  assert.strictEqual(ad.end_date, null);
  assert.strictEqual(ad.creative.videos.length, 1);
  assert.strictEqual(ad.creative.videos[0].video_url, 'https://video.xx.fbcdn.net/film_hd.mp4');
  assert.strictEqual(ad.ad_id, '998877');
});

test('political ad populates transparency', () => {
  const ad = normalizeSearchResponse(searchRaw).ads[2];
  assert.ok(ad.transparency, 'expected transparency object');
  assert.strictEqual(ad.transparency.currency, 'USD');
  assert.deepStrictEqual(ad.transparency.spend, { lower: 5000, upper: 5999 });
  assert.strictEqual(ad.transparency.impressions.text, '10K - 15K');
  assert.strictEqual(ad.transparency.impressions.lower, 10000);
  assert.strictEqual(ad.transparency.impressions.upper, 15000);
  assert.strictEqual(ad.transparency.eu_total_reach, 125000);
  assert.strictEqual(ad.transparency.payer, 'Committee for Progress');
});

test('carousel ad maps cards', () => {
  const ad = normalizeSearchResponse(searchRaw).ads[3];
  assert.strictEqual(ad.creative.cards.length, 2);
  assert.strictEqual(ad.creative.cards[0].title, 'Sneakers');
  assert.strictEqual(ad.creative.cards[1].video_url, 'https://video.xx.fbcdn.net/card2.mp4');
});

test('sparse ad (no snapshot) does not throw and yields nulls', () => {
  const ad = normalizeSearchResponse(searchRaw).ads[4];
  assert.strictEqual(ad.ad_archive_id, '1234567890123405');
  assert.strictEqual(ad.creative.title, null);
  assert.deepStrictEqual(ad.creative.images, []);
  assert.strictEqual(ad.transparency, null);
  assert.strictEqual(ad.start_date, null);
});

test('empty / malformed input degrades gracefully', () => {
  assert.deepStrictEqual(normalizeSearchResponse(null).ads, []);
  assert.deepStrictEqual(normalizeSearchResponse({}).ads, []);
  assert.strictEqual(normalizeSearchResponse({}).count, null);
});

test('details response normalizes with transparency from aaa_info', () => {
  const ad = normalizeDetails(detailsRaw);
  assert.ok(ad);
  assert.strictEqual(ad.ad_archive_id, '1234567890123403');
  assert.strictEqual(ad.transparency.eu_total_reach, 125000);
  assert.strictEqual(ad.transparency.payer, 'Committee for Progress');
  assert.strictEqual(normalizeDetails({}), null);
});
