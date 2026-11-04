'use strict';

const express = require('express');
const registry = require('../lib/registry');
const { createScan } = require('../lib/deepScanService');

const router = express.Router();

// Cross-scan intelligence over every ad the service has ever collected.

// GET /api/registry/stats — totals, plus how much is new in the last 24h / 7d.
router.get('/stats', (req, res) => res.json(registry.stats()));

// GET /api/registry/ads — distinct ads across all scans.
//   sort: new | scale | longest | variants | recent
//   since_days=7 (first seen within N days), active=1|0, domain=, page_id=, q= (advertiser name),
//   min_scale=, limit<=500, offset
router.get('/ads', (req, res) => {
  const q = req.query;
  res.json(registry.listAds({
    sort: q.sort, sinceDays: q.since_days, active: q.active, domain: q.domain, pageId: q.page_id,
    q: q.q, minScale: q.min_scale, seedsOnly: q.seeds_only, storesOnly: q.stores_only, launchedDays: q.launched_days,
    limit: q.limit, offset: q.offset,
  }));
});

// GET /api/registry/advertisers — pages ranked by ad count / variants / scale / newest.
router.get('/advertisers', (req, res) => {
  const q = req.query;
  res.json(registry.listAdvertisers({ sort: q.sort, sinceDays: q.since_days, active: q.active, minScale: q.min_scale, seedsOnly: q.seeds_only, storesOnly: q.stores_only, launchedDays: q.launched_days, limit: q.limit, offset: q.offset }));
});

// GET /api/registry/domains — destination stores ranked the same way.
router.get('/domains', (req, res) => {
  const q = req.query;
  res.json(registry.listDomains({ sort: q.sort, sinceDays: q.since_days, active: q.active, minScale: q.min_scale, seedsOnly: q.seeds_only, storesOnly: q.stores_only, launchedDays: q.launched_days, limit: q.limit, offset: q.offset }));
});

// GET /api/registry/digest?hours=24&limit=15[&format=text] — what launched and was first seen in the
// window (user-term matches, storefront destinations only): top ads by scale, new stores, new advertisers.
router.get('/digest', (req, res) => {
  const result = registry.digest({ hours: req.query.hours, limit: req.query.limit, launchedDays: req.query.launched_days });
  if (req.query.format === 'text') return res.type('text/plain').send(registry.digestText(result));
  return res.json(result);
});

// POST /api/registry/advertisers/:pageId/sweep — collect EVERY active ad from one advertiser (no launch
// window), e.g. to follow a scaler found in the tracker. Starts a normal scan job (one at a time).
router.post('/advertisers/:pageId/sweep', express.json(), (req, res) => {
  try {
    const job = createScan({
      pageIds: [req.params.pageId], targetAds: req.body?.targetAds || 500, countries: req.body?.countries || ['US'],
      activeStatus: req.body?.activeStatus || 'active', mediaType: req.body?.mediaType || 'all', lookbackDays: 90,
    });
    res.status(202).json(job);
  } catch (error) {
    res.status(error.status || 400).json({ error: { code: error.code || 'invalid_scan', message: error.message }, active_scan: error.activeScan || undefined });
  }
});

module.exports = router;
