'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  extractLsd,
  discoverDocIds,
  findDocId,
  cookieFromSetCookie,
  mergeCookieStrings,
  extractChallengePath,
} = require('../src/lib/session');
const { FALLBACK_DOC_IDS } = require('../src/constants');

test('extractLsd finds the LSD token', () => {
  const html = 'noise ["LSD",[],{"token":"AbC123_xyz"},42] more';
  assert.strictEqual(extractLsd(html), 'AbC123_xyz');
});

test('extractLsd falls back to DTSGInitData and input field', () => {
  assert.strictEqual(extractLsd('["DTSGInitData",[],{"token":"tok2"}]'), 'tok2');
  assert.strictEqual(extractLsd('<input name="lsd" value="tok3" />'), 'tok3');
  assert.strictEqual(extractLsd('nothing here'), null);
});

test('findDocId pulls a doc id next to the friendly name', () => {
  const html = '__d("AdLibrarySearchPaginationQuery_x", [], {"id":"25464068859919530"})';
  assert.strictEqual(findDocId(html, 'AdLibrarySearchPaginationQuery'), '25464068859919530');
});

test('findDocId handles the {"name":...,"queryID":...} shape', () => {
  const html = '{"queryID":"9407590475934210","name":"AdLibraryAdDetailsV2Query"}';
  assert.strictEqual(findDocId(html, 'AdLibraryAdDetailsV2Query'), '9407590475934210');
});

test('discoverDocIds falls back to constants when patterns are absent', () => {
  const ids = discoverDocIds('<html>nothing useful</html>');
  assert.strictEqual(ids.search, FALLBACK_DOC_IDS.search);
  assert.strictEqual(ids.details, FALLBACK_DOC_IDS.details);
});

test('cookieFromSetCookie keeps only wanted cookies', () => {
  const headers = [
    'datr=abc123; Path=/; Domain=.facebook.com; HttpOnly',
    'sb=xyz; Path=/; Secure',
    'rd_challenge=challenge-cookie; Path=/; Secure',
    'presence=irrelevant; Path=/',
  ];
  const cookie = cookieFromSetCookie(headers);
  assert.match(cookie, /datr=abc123/);
  assert.match(cookie, /sb=xyz/);
  assert.match(cookie, /rd_challenge=challenge-cookie/);
  assert.doesNotMatch(cookie, /presence/);
});

test('extractChallengePath accepts only the bounded same-origin path shape', () => {
  const html = `<script>fetch('/security/hsts-pixel.gif?challenge=3', { method: 'POST' })</script>`;
  assert.strictEqual(extractChallengePath(html), '/security/hsts-pixel.gif?challenge=3');
  assert.strictEqual(extractChallengePath(`<script>fetch('https://evil.example/?challenge=3')</script>`), null);
  assert.strictEqual(extractChallengePath('<html>normal page</html>'), null);
});

test('mergeCookieStrings merges and replaces cookie values by name', () => {
  assert.strictEqual(
    mergeCookieStrings('rd_challenge=one; datr=abc', 'rd_challenge=two; sb=xyz'),
    'rd_challenge=two; datr=abc; sb=xyz'
  );
});

// If a real page was captured via the smoke script, assert we can parse it.
test('captured library-page.html parses (when present)', (t) => {
  const fixture = path.join(__dirname, 'fixtures', 'library-page.html');
  if (!fs.existsSync(fixture)) {
    t.skip('no captured fixture — run `npm run smoke` to capture one');
    return;
  }
  const html = fs.readFileSync(fixture, 'utf8');
  assert.ok(extractLsd(html), 'expected an lsd token in the captured page');
  const ids = discoverDocIds(html);
  assert.match(ids.search, /^\d{15,}$/);
});
