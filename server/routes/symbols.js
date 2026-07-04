'use strict';

const express = require('express');
const db = require('../db');
const { getCached } = require('../cache');
const { getProvider } = require('../providers');

const router = express.Router();
const provider = getProvider();

const rememberSymbol = db.prepare(
  `INSERT INTO symbols (symbol, name, exchange, mic_code, type, currency, country)
   VALUES (@symbol, @name, @exchange, @mic_code, @type, @currency, @country)
   ON CONFLICT(symbol) DO UPDATE SET
     name = excluded.name, exchange = excluded.exchange, mic_code = excluded.mic_code,
     type = excluded.type, currency = excluded.currency, country = excluded.country`
);
const rememberMany = db.transaction((rows) => {
  for (const r of rows) rememberSymbol.run(r);
});

// GET /api/symbols/search?q=aapl — autocomplete. Cached 24h per query.
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const { data } = await getCached('search', q.toLowerCase(), 24 * 3600 * 1000, () =>
      provider.search(q)
    );
    // Prefer US common stock / ETF up top; keep it useful for a stock app.
    const ranked = [...data].sort(
      (a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol)
    );
    rememberMany(ranked.filter((r) => r.symbol));
    res.json(ranked);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

function rank(r) {
  let score = 0;
  if (r.country !== 'United States') score += 2;
  if (r.type && !/common stock|etf/i.test(r.type)) score += 1;
  return score;
}

module.exports = router;
