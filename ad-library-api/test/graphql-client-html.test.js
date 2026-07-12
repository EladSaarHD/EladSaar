'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseDetailsHtml, parseInitialSearchHtml, discoverRuntimeMetadata, extractScriptUrls } = require('../src/lib/graphqlClient');

test('parseDetailsHtml extracts deeplink ad archive data', () => {
  const payload = {
    require: [["x", [], [], { __bbox: { result: { data: { ad_library_main: {
      deeplink_ad_archive_result: {
        deeplink_ad_archive: {
          ad_archive_id: '123',
          page_id: '456',
          page_name: 'Example',
          snapshot: { body: { text: 'Creative body' } },
        },
      },
    } } } } }]],
  };
  const html = `<script type="application/json">${JSON.stringify(payload)}</script>`;
  const data = parseDetailsHtml(html);
  assert.strictEqual(data.ad_library_main.ad_details.ad.ad_archive_id, '123');
  assert.strictEqual(data.ad_library_main.ad_details.ad.page_name, 'Example');
});

test('discoverRuntimeMetadata extracts current operation IDs and frontend version', () => {
  const js = 'x AdLibrarySearchPaginationQuery y 24922295957467452 z AdLibraryV3AdDetailsQuery q 25068828942793558';
  const html = `<html><script src="https://static.xx.fbcdn.net/rsrc.php/v4/test.js"></script><script type="application/json">{"v":"d427bf"}</script></html>`;
  const result = discoverRuntimeMetadata(html, [js]);
  assert.strictEqual(result.docIds.search, '24922295957467452');
  assert.strictEqual(result.docIds.details, '25068828942793558');
  assert.strictEqual(result.frontendVersion, 'd427bf');
});

test('extractScriptUrls returns unique Meta JavaScript assets only', () => {
  const html = '<script src="https://static.xx.fbcdn.net/a.js"></script><script src="https://static.xx.fbcdn.net/a.js"></script><script src="https://evil.example/x.js"></script>';
  assert.deepStrictEqual(extractScriptUrls(html), ['https://static.xx.fbcdn.net/a.js']);
});

test('parseInitialSearchHtml preserves the server session for pagination', () => {
  const payload = {
    config: { query: 'shoes', sessionId: 'SESSION-1', collationToken: null },
    data: { ad_library_main: { search_results_connection: { count: 1, edges: [], page_info: { end_cursor: 'CURSOR', has_next_page: true } } } },
  };
  const html = `<script type="application/json">${JSON.stringify(payload)}</script>`;
  const data = parseInitialSearchHtml(html);
  assert.strictEqual(data.__continuation.sessionID, 'SESSION-1');
});
