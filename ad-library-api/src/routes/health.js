'use strict';

const express = require('express');
const pkg = require('../../package.json');
const session = require('../lib/session');
const { getPacing } = require('../lib/graphqlClient');
const { cache } = require('../store');
const asyncHandler = require('../lib/asyncHandler');
const { checkCanary, lastCanary } = require('../lib/canary');

const router = express.Router();

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
    pacing: getPacing(),
    // Last live check (first page + continuation). `null` until the first one has run.
    canary: lastCanary(),
    degraded: lastCanary() ? !lastCanary().ok : false,
  });
});

// Live end-to-end check: fetches a first page AND follows a continuation cursor. Makes two
// upstream requests, so results are reused for 60s.
router.get('/deep', asyncHandler(async (req, res) => {
  const result = await checkCanary();
  res.status(result.ok ? 200 : 503).json(result);
}));

module.exports = router;
