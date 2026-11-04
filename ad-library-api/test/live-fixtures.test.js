'use strict';

// Contract tests over REAL Meta responses captured by POST /api/admin/capture-fixtures (test/fixtures/live-*).
// If Meta changes its response format these fail here, instead of scans silently collecting nothing (2026-07-15).
// With no captured fixtures yet the tests are skipped, not passed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseResponse } = require('../src/lib/graphqlClient');
const { normalizeSearchResponse } = require('../src/lib/normalize');

const root = path.join(__dirname, 'fixtures');
const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((name) => /^live-\d{8}$/.test(name)) : [];

if (!dirs.length) {
  test('live Meta fixtures (none captured yet — run POST /api/admin/capture-fixtures)', { skip: 'no live fixtures captured' }, () => {});
}

for (const dir of dirs) {
  for (const file of ['first-page-post.json', 'continuation.json']) {
    test(`${dir}/${file} parses with the real parser and normalizes to ads`, () => {
      const json = parseResponse(fs.readFileSync(path.join(root, dir, file), 'utf8'));
      assert.ok(json && json.data, 'a data payload');
      const page = normalizeSearchResponse(json.data);
      assert.ok(page.ads.length > 0, 'at least one ad');
      for (const ad of page.ads) {
        assert.ok(ad.ad_archive_id, 'ad id');
        assert.ok(ad.page_name || ad.page_id, 'advertiser');
        assert.ok(ad.start_date, 'start date');
      }
      assert.ok(page.page_info && 'has_next_page' in page.page_info, 'page_info');
      assert.ok(!/"(lsd|fb_dtsg)"\s*:\s*"(?!REDACTED)/.test(fs.readFileSync(path.join(root, dir, file), 'utf8')), 'no session tokens were committed');
    });
  }
}
