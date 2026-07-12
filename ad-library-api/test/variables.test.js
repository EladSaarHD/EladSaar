'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  buildSearchVariables,
  buildPageVariables,
  buildDetailsVariables,
  mapEnum,
  clampFirst,
  toEpochDay,
} = require('../src/lib/variables');
const { InvalidParamsError } = require('../src/lib/errors');

test('mapEnum accepts friendly keys and raw values, rejects garbage', () => {
  assert.strictEqual(mapEnum('activeStatus', 'active'), 'ACTIVE');
  assert.strictEqual(mapEnum('activeStatus', 'ALL'), 'ALL');
  assert.strictEqual(mapEnum('mediaType', undefined, 'ALL'), 'ALL');
  assert.throws(() => mapEnum('activeStatus', 'bogus'), InvalidParamsError);
});

test('clampFirst enforces bounds', () => {
  assert.strictEqual(clampFirst(undefined), 30);
  assert.strictEqual(clampFirst('10'), 10);
  assert.strictEqual(clampFirst(999), 50); // capped at maxFirst
  assert.throws(() => clampFirst('0'), InvalidParamsError);
  assert.throws(() => clampFirst('abc'), InvalidParamsError);
});

test('toEpochDay parses ISO dates and rejects bad input', () => {
  assert.strictEqual(toEpochDay('1970-01-02', 'start_date'), 1);
  assert.throws(() => toEpochDay('not-a-date', 'start_date'), InvalidParamsError);
});

test('buildSearchVariables builds keyword search', () => {
  const v = buildSearchVariables({ q: 'nike', country: 'us', first: '5' });
  assert.strictEqual(v.queryString, 'nike');
  assert.strictEqual(v.searchType, 'KEYWORD_UNORDERED');
  assert.strictEqual(v.first, 5);
  assert.deepStrictEqual(v.countries, ['US']);
  assert.ok(v.sessionID && v.collationToken);
});

test('buildSearchVariables switches to PAGE when page_id present', () => {
  const v = buildSearchVariables({ page_id: '123' });
  assert.strictEqual(v.searchType, 'PAGE');
  assert.deepStrictEqual(v.pageIDs, ['123']);
  assert.strictEqual(v.viewAllPageID, '123');
});

test('buildSearchVariables requires q or page_id', () => {
  assert.throws(() => buildSearchVariables({}), InvalidParamsError);
});

test('buildSearchVariables maps date range', () => {
  const v = buildSearchVariables({ q: 'x', start_date: '1970-01-02', end_date: '1970-01-03' });
  assert.deepStrictEqual(v.startDate, { min: 1, max: 2 });
});

test('buildSearchVariables maps platforms', () => {
  const v = buildSearchVariables({ q: 'x', platform: 'facebook,instagram' });
  assert.deepStrictEqual(v.publisherPlatforms, ['FACEBOOK', 'INSTAGRAM']);
});

test('buildPageVariables sets page search', () => {
  const v = buildPageVariables('987', { country: 'GB' });
  assert.strictEqual(v.searchType, 'PAGE');
  assert.strictEqual(v.viewAllPageID, '987');
  assert.strictEqual(v.queryString, '');
  assert.deepStrictEqual(v.countries, ['GB']);
});

test('buildDetailsVariables requires an ad id', () => {
  assert.throws(() => buildDetailsVariables({}), InvalidParamsError);
  const v = buildDetailsVariables({ adArchiveId: '555', pageId: '1', country: 'us' });
  assert.strictEqual(v.adArchiveID, '555');
  assert.strictEqual(v.country, 'US');
});
