'use strict';

const crypto = require('crypto');
const config = require('../../config');
const { InvalidParamsError } = require('./errors');
const { ENUMS, DEFAULTS } = require('../constants');

// Map a user-supplied param onto an allowed enum value, case-insensitively.
// Accepts either the API-friendly key ("active") or the raw FB value ("ACTIVE").
function mapEnum(name, value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const table = ENUMS[name];
  const key = String(value).toLowerCase();
  if (table[key]) return table[key];
  const raw = String(value).toUpperCase();
  if (Object.values(table).includes(raw)) return raw;
  throw new InvalidParamsError(
    `Invalid ${name} "${value}". Allowed: ${Object.keys(table).join(', ')}`
  );
}

function clampFirst(value) {
  if (value === undefined || value === '') return DEFAULTS.first;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidParamsError(`"first" must be a positive integer (max ${DEFAULTS.maxFirst})`);
  }
  return Math.min(n, DEFAULTS.maxFirst);
}

// Facebook wants epoch-day integers for the start-date range. Accept ISO dates.
function toEpochDay(value, label) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new InvalidParamsError(`Invalid ${label} "${value}" (use YYYY-MM-DD)`);
  return Math.floor(ms / 86400000);
}

function dateRange(params) {
  const min = toEpochDay(params.start_date, 'start_date');
  const max = toEpochDay(params.end_date, 'end_date');
  if (min === null && max === null) return null;
  return { min, max };
}

function platforms(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => mapEnum('publisherPlatform', s.trim()))
    .filter(Boolean);
}

function country(params) {
  return (params.country || config.defaultCountry || 'US').toUpperCase();
}

// Fields common to search and page-ads queries.
function baseVariables(params) {
  return {
    activeStatus: mapEnum('activeStatus', params.active_status, DEFAULTS.activeStatus),
    adType: mapEnum('adType', params.ad_type, DEFAULTS.adType),
    mediaType: mapEnum('mediaType', params.media_type, DEFAULTS.mediaType),
    countries: [country(params)],
    country: country(params),
    publisherPlatforms: platforms(params.platform),
    startDate: dateRange(params),
    first: clampFirst(params.first),
    cursor: params.cursor || null,
    sessionID: crypto.randomUUID(),
    collationToken: crypto.randomUUID(),
    // Empty defaults FB expects to be present.
    bylines: [],
    contentLanguages: [],
    excludedIDs: [],
    location: null,
    potentialReachInput: [],
    regions: [],
    sortData: null,
    source: null,
    v: '',
  };
}

function buildSearchVariables(params) {
  const q = (params.q || '').trim();
  if (!q && !params.page_id) {
    throw new InvalidParamsError('Provide "q" (keyword) or "page_id" to search');
  }
  const searchType = params.page_id
    ? 'PAGE'
    : mapEnum('searchType', params.search_type, DEFAULTS.searchType);

  return {
    ...baseVariables(params),
    queryString: q,
    searchType,
    pageIDs: params.page_id ? [String(params.page_id)] : [],
    viewAllPageID: params.page_id ? String(params.page_id) : '0',
  };
}

function buildPageVariables(pageId, params) {
  if (!pageId) throw new InvalidParamsError('pageId is required');
  return {
    ...baseVariables(params),
    queryString: '',
    searchType: 'PAGE',
    pageIDs: [String(pageId)],
    viewAllPageID: String(pageId),
  };
}

function buildDetailsVariables({ adArchiveId, pageId, country: c }) {
  if (!adArchiveId) throw new InvalidParamsError('ad id is required');
  return {
    adArchiveID: String(adArchiveId),
    pageID: pageId ? String(pageId) : null,
    country: (c || config.defaultCountry || 'US').toUpperCase(),
    sessionID: crypto.randomUUID(),
    source: null,
    isAdNonPolitical: true,
    isAdNotAAAEligible: false,
  };
}

module.exports = {
  buildSearchVariables,
  buildPageVariables,
  buildDetailsVariables,
  // exported for unit tests:
  mapEnum,
  clampFirst,
  dateRange,
  toEpochDay,
};
