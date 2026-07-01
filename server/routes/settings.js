'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { categoryFor } = require('../rules');

const router = express.Router();

// ---- runtime status (read-only view of effective config, no secrets) ----
router.get('/status', (req, res) => {
  res.json({
    extractor: config.extractor.mode,
    codexCommand: config.extractor.command,
    watchDir: config.watchDir || null,
    imapEnabled: config.imap.enabled,
    imapHost: config.imap.enabled ? config.imap.host : null,
    defaultCurrency: config.defaultCurrency,
  });
});

// ---- key/value settings ----
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

router.put('/:key', (req, res) => {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ key: req.params.key, value: String(req.body.value ?? '') });
  res.json({ ok: true });
});

// ---- auto-categorization rules ----
router.get('/rules', (req, res) => {
  res.json(db.prepare('SELECT * FROM rules ORDER BY id').all());
});

router.post('/rules', (req, res) => {
  const { match_field = 'vendor', pattern, category, enabled = 1 } = req.body;
  if (!pattern || !category) {
    return res.status(400).json({ error: 'pattern and category are required' });
  }
  const info = db
    .prepare(
      `INSERT INTO rules (match_field, pattern, category, enabled)
       VALUES (?, ?, ?, ?)`
    )
    .run(match_field, pattern, category, enabled ? 1 : 0);
  res.json(db.prepare('SELECT * FROM rules WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/rules/:id', (req, res) => {
  db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/settings/rules/apply — re-apply rules to existing uncategorized receipts.
router.post('/rules/apply', (req, res) => {
  const rows = db
    .prepare("SELECT id, vendor, original_filename FROM receipts WHERE category IS NULL OR category = ''")
    .all();
  const update = db.prepare("UPDATE receipts SET category = ?, updated_at = datetime('now') WHERE id = ?");
  let updated = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const cat = categoryFor(r);
      if (cat) {
        update.run(cat, r.id);
        updated += 1;
      }
    }
  });
  tx();
  res.json({ updated });
});

module.exports = router;
