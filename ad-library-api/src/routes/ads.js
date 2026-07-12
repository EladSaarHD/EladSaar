'use strict';

const express = require('express');
const config = require('../../config');
const asyncHandler = require('../lib/asyncHandler');
const client = require('../lib/graphqlClient');
const { buildDetailsVariables } = require('../lib/variables');
const { normalizeDetails } = require('../lib/normalize');
const { NotFoundError } = require('../lib/errors');
const { cache } = require('../store');

const router = express.Router();

// GET /api/ads/:id — full detail for a single ad by ad_archive_id.
// page_id is optional but improves the upstream lookup.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const country = (req.query.country || config.defaultCountry).toUpperCase();
    const pageId = req.query.page_id || null;
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';

    const cacheParams = { id, country, page_id: pageId };
    const key = cache.cacheKey('ad', cacheParams);

    if (!fresh) {
      const hit = cache.get(key);
      if (hit) return res.json({ ...hit, cached: true });
    }

    const variables = buildDetailsVariables({ adArchiveId: id, pageId, country });
    const data = await client.request({ kind: 'details', variables });
    const ad = normalizeDetails(data);

    if (!ad) throw new NotFoundError(`No ad found for id ${id}`);

    const payload = { query: cacheParams, ad, cached: false };
    cache.set(key, 'ad', cacheParams, payload, config.cacheTtlSeconds);
    res.json(payload);
  })
);

module.exports = router;
