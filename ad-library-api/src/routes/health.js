'use strict';

const express = require('express');
const pkg = require('../../package.json');
const session = require('../lib/session');
const { cache } = require('../store');

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
  });
});

module.exports = router;
