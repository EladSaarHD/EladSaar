'use strict';

const express = require('express');
const registry = require('../lib/registry');

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
    q: q.q, minScale: q.min_scale, limit: q.limit, offset: q.offset,
  }));
});

// GET /api/registry/advertisers — pages ranked by ad count / variants / scale / newest.
router.get('/advertisers', (req, res) => {
  const q = req.query;
  res.json(registry.listAdvertisers({ sort: q.sort, sinceDays: q.since_days, active: q.active, minScale: q.min_scale, limit: q.limit, offset: q.offset }));
});

// GET /api/registry/domains — destination stores ranked the same way.
router.get('/domains', (req, res) => {
  const q = req.query;
  res.json(registry.listDomains({ sort: q.sort, sinceDays: q.since_days, active: q.active, minScale: q.min_scale, limit: q.limit, offset: q.offset }));
});

module.exports = router;
