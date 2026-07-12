'use strict';

const express = require('express');
const config = require('../../config');
const asyncHandler = require('../lib/asyncHandler');
const { buildPageVariables } = require('../lib/variables');
const { runListQuery, isFresh } = require('../lib/listQuery');

const router = express.Router();

// GET /api/pages/:pageId/ads — every ad for a specific page.
router.get(
  '/:pageId/ads',
  asyncHandler(async (req, res) => {
    const { pageId } = req.params;
    const q = req.query;

    const cacheParams = {
      page_id: pageId,
      country: (q.country || config.defaultCountry).toUpperCase(),
      active_status: q.active_status || null,
      ad_type: q.ad_type || null,
      media_type: q.media_type || null,
      platform: q.platform || null,
      start_date: q.start_date || null,
      end_date: q.end_date || null,
      cursor: q.cursor || null,
      first: q.first || null,
    };

    const variables = buildPageVariables(pageId, q);
    const payload = await runListQuery({
      cacheKind: 'page',
      cacheParams,
      variables,
      fresh: isFresh(q.fresh),
    });

    res.json(payload);
  })
);

module.exports = router;
