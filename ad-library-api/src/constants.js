'use strict';

// Everything volatile about Facebook's internals lives here. When the
// scraper breaks, this file and lib/normalize.js are where to look first.

const GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';
const LIBRARY_URL = 'https://www.facebook.com/ads/library/';

const FRIENDLY_NAMES = {
  search: 'AdLibrarySearchPaginationQuery',
  details: 'AdLibraryAdDetailsV2Query',
};

// Last-known-good doc_ids. Used only when runtime discovery from the
// ads/library HTML fails — Facebook rotates these regularly.
const FALLBACK_DOC_IDS = {
  search: '25464068859919530',
  details: '9407590475934210',
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
  activeStatus: { all: 'ALL', active: 'ACTIVE', inactive: 'INACTIVE' },
  adType: {
    all: 'ALL',
    political_and_issue_ads: 'POLITICAL_AND_ISSUE_ADS',
    housing_ads: 'HOUSING_ADS',
    employment_ads: 'EMPLOYMENT_ADS',
    credit_ads: 'CREDIT_ADS',
    financial_products_and_services_ads: 'FINANCIAL_PRODUCTS_AND_SERVICES_ADS',
  },
  mediaType: { all: 'ALL', image: 'IMAGE', meme: 'MEME', video: 'VIDEO', none: 'NONE' },
  searchType: {
    keyword_unordered: 'KEYWORD_UNORDERED',
    keyword_exact_phrase: 'KEYWORD_EXACT_PHRASE',
    page: 'PAGE',
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
  activeStatus: 'ALL',
  adType: 'ALL',
  mediaType: 'ALL',
  searchType: 'KEYWORD_UNORDERED',
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
