'use strict';

const express = require('express');
const config = require('../../config');
const asyncHandler = require('../lib/asyncHandler');
const { buildSearchVariables } = require('../lib/variables');
const { runListQuery, isFresh } = require('../lib/listQuery');

const router = express.Router();

// GET /api/search — keyword or page search with filters + cursor pagination.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = req.query;

    // Only the fields that affect results go into the cache key / echo.
    const cacheParams = {
      q: (q.q || '').trim() || null,
      page_id: q.page_id || null,
      country: (q.country || config.defaultCountry).toUpperCase(),
      active_status: q.active_status || null,
      ad_type: q.ad_type || null,
      media_type: q.media_type || null,
      platform: q.platform || null,
      search_type: q.search_type || null,
      start_date: q.start_date || null,
      end_date: q.end_date || null,
      sort: q.sort || 'impressions',
      cursor: q.cursor || null,
      first: q.first || null,
    };

    const variables = buildSearchVariables(q);
    const payload = await runListQuery({
      cacheKind: 'search',
      cacheParams,
      variables,
      fresh: isFresh(q.fresh),
    });

    res.json(payload);
  })
);

module.exports = router;
