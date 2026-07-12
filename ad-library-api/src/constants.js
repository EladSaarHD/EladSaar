'use strict';

// Everything volatile about Facebook's internals lives here. When the
// scraper breaks, this file and lib/normalize.js are where to look first.

const GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';
const LIBRARY_URL = 'https://www.facebook.com/ads/library/';

const FRIENDLY_NAMES = {
  search: 'AdLibrarySearchPaginationQuery',
  details: 'AdLibraryV3AdDetailsQuery',
};

// Last-known-good doc_ids. Used only when runtime discovery from the
// ads/library HTML fails — Facebook rotates these regularly.
const FALLBACK_DOC_IDS = {
  search: '24922295957467452',
  details: '25068828942793558',
};

// Constant sent by the web client on every GraphQL call.
const ASBD_ID = '359341';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Upstream GraphQL error codes with a known meaning.
const UPSTREAM_ERROR_CODES = {
  STALE_SESSION: 1357004, // "Please try closing and re-opening your browser window"
};

// Accepted values for API query params → GraphQL variable values.
const ENUMS = {
  activeStatus: { all: 'all', active: 'active', inactive: 'inactive' },
  adType: {
    all: 'ALL',
    political_and_issue_ads: 'POLITICAL_AND_ISSUE_ADS',
    housing_ads: 'HOUSING_ADS',
    employment_ads: 'EMPLOYMENT_ADS',
    credit_ads: 'CREDIT_ADS',
    financial_products_and_services_ads: 'FINANCIAL_PRODUCTS_AND_SERVICES_ADS',
  },
  mediaType: { all: 'all', image: 'image', meme: 'meme', video: 'video', none: 'none' },
  searchType: {
    keyword_unordered: 'keyword_unordered',
    keyword_exact_phrase: 'keyword_exact_phrase',
    page: 'page',
  },
  publisherPlatform: {
    facebook: 'FACEBOOK',
    instagram: 'INSTAGRAM',
    audience_network: 'AUDIENCE_NETWORK',
    messenger: 'MESSENGER',
    threads: 'THREADS',
  },
};

const DEFAULTS = {
  first: 30,
  maxFirst: 50,
  activeStatus: 'all',
  adType: 'ALL',
  mediaType: 'all',
  searchType: 'keyword_unordered',
};

module.exports = {
  GRAPHQL_URL,
  LIBRARY_URL,
  FRIENDLY_NAMES,
  FALLBACK_DOC_IDS,
  ASBD_ID,
  DEFAULT_USER_AGENT,
  UPSTREAM_ERROR_CODES,
  ENUMS,
  DEFAULTS,
};
