'use strict';

const express = require('express');
const db = require('../db');
const { getCached } = require('../cache');
const { getProvider } = require('../providers');

const router = express.Router();
const provider = getProvider();

const listStmt = db.prepare(
  'SELECT symbol, name, position FROM watchlist ORDER BY position ASC, added_at ASC'
);
const insertStmt = db.prepare(
  `INSERT INTO watchlist (symbol, name, position)
   VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM watchlist))
   ON CONFLICT(symbol) DO UPDATE SET name = excluded.name`
);
const deleteStmt = db.prepare('DELETE FROM watchlist WHERE symbol = ?');

// GET /api/watchlist — the saved symbols, each with a fresh-ish quote attached.
router.get('/', async (req, res) => {
  const rows = listStmt.all();
  const items = await Promise.all(
    rows.map(async (row) => {
      try {
        const { data } = await getCached('quote', row.symbol, 15 * 1000, () =>
          provider.quote(row.symbol)
        );
        return { ...row, quote: data };
      } catch {
        return { ...row, quote: null };
      }
    })
  );
  res.json(items);
});

// POST /api/watchlist { symbol, name }
router.post('/', (req, res) => {
  const symbol = String(req.body.symbol || '').toUpperCase().trim();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  insertStmt.run(symbol, req.body.name || null);
  res.status(201).json({ ok: true });
});

// DELETE /api/watchlist/:symbol
router.delete('/:symbol', (req, res) => {
  deleteStmt.run(String(req.params.symbol).toUpperCase());
  res.status(204).end();
});

module.exports = router;
