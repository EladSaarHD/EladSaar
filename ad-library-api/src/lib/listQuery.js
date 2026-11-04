'use strict';

const config = require('../../config');
const client = require('./graphqlClient');
const { normalizeSearchResponse } = require('./normalize');
const { cache } = require('../store');

// Shared pipeline for the two list endpoints (search + page ads): cache
// lookup → GraphQL request → normalize → cache store. Both hit the same
// AdLibrarySearchPaginationQuery upstream, so the GraphQL kind is 'search'.
async function runListQuery({ cacheKind, cacheParams, variables, fresh }) {
  const key = cache.cacheKey(cacheKind, cacheParams);

  if (!fresh) {
    const hit = cache.get(key);
    if (hit) return { ...hit, cached: true };
  }

  // Background scans wait out a Meta cool-down; interactive callers (UI search, Hunter's quick `search`) fail fast.
  const data = await client.request({ kind: 'search', variables, patient: cacheKind === 'deep-scan' });
  const norm = normalizeSearchResponse(data);

  const payload = {
    query: cacheParams,
    ads: norm.ads,
    page_info: norm.page_info,
    count: norm.count,
    cached: false,
  };

  cache.set(key, cacheKind, cacheParams, payload, config.cacheTtlSeconds);
  return payload;
}

function isFresh(value) {
  return value === '1' || value === 'true';
}

module.exports = { runListQuery, isFresh };
