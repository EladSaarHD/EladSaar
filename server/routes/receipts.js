'use strict';

const express = require('express');
const fs = require('fs');
const db = require('../db');

const router = express.Router();

// Build a WHERE clause + params from query filters shared by list/export.
function buildFilter(query) {
  const where = [];
  const params = {};
  if (query.q) {
    where.push('(vendor LIKE @q OR notes LIKE @q OR original_filename LIKE @q)');
    params.q = `%${query.q}%`;
  }
  if (query.category) {
    where.push('category = @category');
    params.category = query.category;
  }
  if (query.status) {
    where.push('status = @status');
    params.status = query.status;
  }
  if (query.source) {
    where.push('source = @source');
    params.source = query.source;
  }
  if (query.from) {
    where.push('receipt_date >= @from');
    params.from = query.from;
  }
  if (query.to) {
    where.push('receipt_date <= @to');
    params.to = query.to;
  }
  if (query.minAmount) {
    where.push('total_amount >= @minAmount');
    params.minAmount = Number(query.minAmount);
  }
  if (query.maxAmount) {
    where.push('total_amount <= @maxAmount');
    params.maxAmount = Number(query.maxAmount);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { clause, params };
}

// GET /api/receipts — list with filters, newest first.
router.get('/', (req, res) => {
  const { clause, params } = buildFilter(req.query);
  const rows = db
    .prepare(
      `SELECT * FROM receipts ${clause}
       ORDER BY COALESCE(receipt_date, created_at) DESC, id DESC`
    )
    .all(params);
  res.json(rows);
});

// GET /api/receipts/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// GET /api/receipts/:id/file — stream the original receipt file (inline).
router.get('/:id/file', (req, res) => {
  const row = db
    .prepare('SELECT stored_path, mime_type, original_filename FROM receipts WHERE id = ?')
    .get(req.params.id);
  if (!row || !row.stored_path || !fs.existsSync(row.stored_path)) {
    return res.status(404).json({ error: 'file not found' });
  }
  if (row.mime_type) res.type(row.mime_type);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${row.original_filename || 'receipt'}"`
  );
  fs.createReadStream(row.stored_path).pipe(res);
});

const EDITABLE = [
  'vendor',
  'receipt_date',
  'total_amount',
  'currency',
  'tax_amount',
  'tax_rate',
  'category',
  'payment_method',
  'notes',
  'status',
];

// PATCH /api/receipts/:id — update editable fields.
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM receipts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const sets = [];
  const params = { id: req.params.id };
  for (const field of EDITABLE) {
    if (field in req.body) {
      sets.push(`${field} = @${field}`);
      params[field] = req.body[field];
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'no editable fields' });
  sets.push("updated_at = datetime('now')");

  db.prepare(`UPDATE receipts SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json(db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id));
});

// DELETE /api/receipts/:id — remove row (and its file if unreferenced).
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT stored_path FROM receipts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM receipts WHERE id = ?').run(req.params.id);

  // Delete the file only if no other receipt references it.
  if (row.stored_path) {
    const stillUsed = db
      .prepare('SELECT 1 FROM receipts WHERE stored_path = ? LIMIT 1')
      .get(row.stored_path);
    if (!stillUsed && fs.existsSync(row.stored_path)) {
      fs.rm(row.stored_path, { force: true }, () => {});
    }
  }
  res.json({ ok: true });
});

module.exports = { router, buildFilter };
