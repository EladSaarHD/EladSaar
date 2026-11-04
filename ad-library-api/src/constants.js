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
  // "Your Request Couldn't be Processed" (HTTP 200, `payload: null`). Meta returns this
  // for GraphQL POSTs that do not look like a same-origin browser fetch — most notably
  // when the `sec-fetch-*` request headers are missing. This was the root cause of every
  // continuation cursor failing silently from mid-July onward.
  REQUEST_REJECTED: 1357054,
};

// Fetch-metadata headers a browser attaches to same-origin XHR/fetch calls. Meta rejects
// the pagination POST (error 1357054) without them. Verified live: these three are
// necessary and sufficient; cookies, referer shape and `sec-ch-ua` are irrelevant.
const FETCH_METADATA_HEADERS = {
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
};

// Continuation (GraphQL) pages are fixed at 10 ads per request regardless of `first`;
// only the server-rendered first page is larger (~30). Used for page-budget planning.
const CONTINUATION_PAGE_SIZE = 10;

// Meta's own names for the two sort orders the public UI exposes. "recent" is Meta's
// default `relevancy_monthly_grouped`: ads grouped by launch month (newest month first),
// relevance within the month. The initial-page URL param and the continuation POST
// variable MUST agree or the continuation returns a different ordering.
const SORT_MODES = {
  impressions: { url: 'total_impressions', graphql: 'SORT_BY_TOTAL_IMPRESSIONS' },
  recent: { url: 'relevancy_monthly_grouped', graphql: 'SORT_BY_RELEVANCY_MONTHLY_GROUPED' },
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
  FETCH_METADATA_HEADERS,
  CONTINUATION_PAGE_SIZE,
  SORT_MODES,
  ENUMS,
  DEFAULTS,
};
