'use strict';

const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { createScan, getJob, listAds, listStores, latestScans } = require('../lib/deepScanService');
const { toCsv, AD_COLUMNS, STORE_COLUMNS } = require('../lib/csv');

const router = express.Router();

router.get('/', (req, res) => res.json({ scans: latestScans(req.query.limit) }));

router.post('/', express.json(), asyncHandler(async (req, res) => {
  try {
    const job = createScan(req.body || {});
    res.status(202).json(job);
  } catch (error) {
    const status = error.status || 400;
    res.status(status).json({
      error: { code: error.code || 'invalid_scan', message: error.message },
      active_scan: error.activeScan || undefined,
    });
  }
}));

router.get('/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: { code: 'not_found', message: 'Scan not found' } });
  res.json(job);
});

router.get('/:id/stores', (req, res) => {
  if (!getJob(req.params.id)) return res.status(404).json({ error: 'Scan not found' });
  return res.json(listStores(req.params.id, req.query));
});

router.get('/:id/ads', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: { code: 'not_found', message: 'Scan not found' } });
  res.json(listAds(req.params.id, {
    sort: req.query.sort,
    limit: req.query.limit,
    offset: req.query.offset,
    dropshipMin: req.query.dropship_min,
    scaleMin: req.query.scale_min,
    onlyImpressions: req.query.only_impressions === '1',
  }));
});

// Spreadsheet export of a whole scan: GET /api/scans/:id/export?view=ads|stores&sort=...
router.get('/:id/export', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: { code: 'not_found', message: 'Scan not found' } });
  const view = req.query.view === 'stores' ? 'stores' : 'ads';
  const all = { sort: req.query.sort, limit: 100000, maxLimit: 100000 };
  const csv = view === 'stores' ? toCsv(STORE_COLUMNS, listStores(job.id, all).stores) : toCsv(AD_COLUMNS, listAds(job.id, all).ads);
  const slug = String(job.config?.queryExpression || 'scan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'scan';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="adsignal-${slug}-${new Date(job.created_at).toISOString().slice(0, 10)}-${view}.csv"`);
  return res.send(csv);
});

module.exports = router;
