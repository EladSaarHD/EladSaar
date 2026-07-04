'use strict';

const express = require('express');
const { getCached } = require('../cache');
const { getProvider } = require('../providers');

const router = express.Router();
const provider = getProvider();

// GET /api/company/:symbol — profile + key statistics merged. Cached 6h since
// fundamentals change slowly. Missing (premium-only) pieces come back as null.
router.get('/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  try {
    const { data } = await getCached('company', symbol, 6 * 3600 * 1000, async () => {
      const [profile, statistics] = await Promise.all([
        provider.profile(symbol),
        provider.statistics(symbol),
      ]);
      return { profile, statistics };
    });
    res.json({ symbol, ...data });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
