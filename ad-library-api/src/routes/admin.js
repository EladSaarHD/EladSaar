'use strict';

// Localhost-only maintenance endpoints. Everything that talks to Meta goes through this service (one limiter,
// one budget), including capturing real responses for the contract tests.
const fs = require('fs');
const path = require('path');
const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const client = require('../lib/graphqlClient');
const { buildSearchVariables } = require('../lib/variables');
const { normalizeSearchResponse } = require('../lib/normalize');

const router = express.Router();
const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures');
const redact = (text) => text.replace(/"(lsd|fb_dtsg|dtsg|token|jazoest)"\s*:\s*"[^"]*"/gi, '"$1":"REDACTED"');

// POST /api/admin/capture-fixtures — 2 requests (a first page and its continuation), saved sanitised under
// test/fixtures/live-YYYYMMDD/. The contract test then parses them with the real parsers, so a Meta format change
// fails a test instead of silently breaking scans (as happened on 2026-07-15).
router.post('/capture-fixtures', asyncHandler(async (req, res) => {
  const pacing = client.getPacing();
  if (pacing.cooling_down_ms > 0 || pacing.hold_ms > 0) {
    return res.status(429).json({ error: { code: 'rate_limited', message: 'Meta rate-limit hold is active; not adding requests. Try again later.' } });
  }
  const captured = [];
  client.setCaptureSink((entry) => captured.push(entry));
  try {
    const query = 'ice roller';
    const first = normalizeSearchResponse(await client.searchFirstPageViaPost(buildSearchVariables({ q: query, country: 'US', active_status: 'active', sort: 'impressions' })));
    if (!first.page_info.end_cursor) return res.status(502).json({ error: { code: 'no_cursor', message: 'First page offered no continuation cursor' } });
    const second = normalizeSearchResponse(await client.request({ kind: 'search', variables: buildSearchVariables({ q: query, country: 'US', active_status: 'active', sort: 'impressions', cursor: first.page_info.end_cursor }) }));
    const texts = captured.filter((entry) => entry.kind === 'search').map((entry) => entry.text);
    if (texts.length < 2) return res.status(502).json({ error: { code: 'capture_failed', message: `Expected 2 captured responses, got ${texts.length}` } });
    const dir = path.join(FIXTURES, `live-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'first-page-post.json'), redact(texts[0]));
    fs.writeFileSync(path.join(dir, 'continuation.json'), redact(texts[1]));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ captured_at: new Date().toISOString(), query, country: 'US', first_ads: first.ads.length, continuation_ads: second.ads.length, count: first.count }, null, 2));
    return res.json({ ok: true, dir: path.relative(path.join(__dirname, '..', '..'), dir), first_ads: first.ads.length, continuation_ads: second.ads.length });
  } finally {
    client.setCaptureSink(null);
  }
}));

module.exports = router;
