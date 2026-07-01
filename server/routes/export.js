'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../db');
const { buildFilter } = require('./receipts');

const router = express.Router();

// GET /api/export/zip — stream a ZIP of the original files for filtered receipts,
// organized as <year>/<month>/<vendor-date-id><ext> for handing to an accountant.
router.get('/zip', (req, res) => {
  const { clause, params } = buildFilter(req.query);
  const rows = db
    .prepare(`SELECT * FROM receipts ${clause}`)
    .all(params)
    .filter((r) => r.stored_path && fs.existsSync(r.stored_path));

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="receipts.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => res.status(500).end(String(err)));
  archive.pipe(res);

  const manifest = [];
  for (const r of rows) {
    const date = (r.receipt_date || r.created_at || '').slice(0, 10);
    const [year = 'unsorted', month = ''] = date ? date.split('-') : [];
    const ext = path.extname(r.stored_path) || '';
    const safeVendor = (r.vendor || 'receipt').replace(/[^\w.-]+/g, '_').slice(0, 40);
    const name = `${safeVendor}-${date || 'nodate'}-${r.id}${ext}`;
    const folder = month ? `${year}/${month}` : year;
    archive.file(r.stored_path, { name: `${folder}/${name}` });
    manifest.push({
      id: r.id,
      file: `${folder}/${name}`,
      vendor: r.vendor,
      date: r.receipt_date,
      total: r.total_amount,
      currency: r.currency,
      tax: r.tax_amount,
      category: r.category,
    });
  }

  // Include a CSV manifest so the ZIP is self-describing.
  const header = 'id,file,vendor,date,total,currency,tax,category\n';
  const csv =
    header +
    manifest
      .map((m) =>
        [m.id, m.file, m.vendor, m.date, m.total, m.currency, m.tax, m.category]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
  archive.append(csv, { name: 'manifest.csv' });

  archive.finalize();
});

module.exports = router;
