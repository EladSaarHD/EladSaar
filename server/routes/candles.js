'use strict';

const express = require('express');
const { getCached } = require('../cache');
const { getProvider } = require('../providers');

const router = express.Router();
const provider = getProvider();

// Which intervals count as intraday (short TTL) vs. daily+ (longer TTL).
const INTRADAY = new Set(['1min', '5min', '15min', '30min', '45min', '1h', '2h', '4h']);

// GET /api/candles/:symbol?interval=1day&outputsize=500
router.get('/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  const interval = String(req.query.interval || '1day');
  const outputsize = Math.min(Number(req.query.outputsize) || 500, 5000);

  const ttl = INTRADAY.has(interval) ? 60 * 1000 : 60 * 60 * 1000;
  const key = `${symbol}:${interval}:${outputsize}`;

  try {
    const { data, cached, stale } = await getCached(
      `candles:${interval}`,
      key,
      ttl,
      () => provider.candles(symbol, interval, outputsize)
    );
    res.json({ symbol, interval, candles: data, _cached: cached, _stale: !!stale });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
