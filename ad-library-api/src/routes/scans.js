'use strict';

const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { createScan, getJob, listAds, listStores, latestScans } = require('../lib/deepScanService');

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
    onlyImpressions: req.query.only_impressions === '1',
  }));
});

module.exports = router;
