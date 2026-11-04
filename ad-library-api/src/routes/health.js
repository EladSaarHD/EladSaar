'use strict';

const express = require('express');
const pkg = require('../../package.json');
const session = require('../lib/session');
const { getPacing } = require('../lib/graphqlClient');
const rateEvents = require('../lib/rateEvents');
const alerts = require('../lib/alerts');
const db = require('../db');
const { cache } = require('../store');
const asyncHandler = require('../lib/asyncHandler');
const { checkCanary, lastCanary } = require('../lib/canary');

const router = express.Router();

// How old is what the tracker shows? Lets the UI say "data as of ..." instead of implying it is live.
function freshness() {
  const scan = db.prepare("SELECT id, updated_at FROM scan_jobs WHERE status = 'complete' ORDER BY updated_at DESC LIMIT 1").get();
  const newest = db.prepare('SELECT MAX(first_seen) AS t FROM ad_registry').get().t;
  return { last_scan_completed_at: scan?.updated_at || null, last_scan_id: scan?.id || null, last_new_ad_at: newest || null };
}

// Liveness + light introspection. Never makes a live call to Facebook.
router.get('/', (req, res) => {
  const sess = session.peek();
  res.json({
    ok: true,
    version: pkg.version,
    session: sess
      ? { bootstrapped: true, age_seconds: Math.round((Date.now() - sess.fetchedAt) / 1000) }
      : { bootstrapped: false },
    cache: { rows: cache.count() },
    data: freshness(),
    alerts_unacked: alerts.unackedCount(),
    pacing: { ...getPacing(), rate_limit_events_24h: rateEvents.countSince(24 * 3600000), last_rate_limits: rateEvents.recent(3) },
    // Last live check (first page + continuation). `null` until the first one has run.
    canary: lastCanary(),
    degraded: lastCanary() ? lastCanary().ok === false : false,
  });
});

// Live end-to-end check: fetches a first page AND follows a continuation cursor. Makes two
// upstream requests, so results are reused for 60s.
router.get('/deep', asyncHandler(async (req, res) => {
  const result = await checkCanary();
  res.status(result.ok ? 200 : 503).json(result);
}));

module.exports = router;
