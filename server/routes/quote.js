'use strict';

const express = require('express');
const { getCached } = require('../cache');
const { getProvider } = require('../providers');

const router = express.Router();
const provider = getProvider();

// GET /api/quote/:symbol — latest price snapshot. Cached ~15s to stay live-ish
// without burning the rate limit on repeated polls.
router.get('/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  try {
    const { data, cached, stale } = await getCached('quote', symbol, 15 * 1000, () =>
      provider.quote(symbol)
    );
    res.json({ ...data, _cached: cached, _stale: !!stale });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
