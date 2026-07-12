# Ad Library API

A personal, self-hosted REST API that scrapes Meta's public [Ad Library](https://www.facebook.com/ads/library/)
and returns clean, stable JSON. A do-it-yourself alternative to services like metapi.io.

It talks to the same internal GraphQL endpoint the Ad Library website uses, so it
covers **all** ad types in all countries with **no Facebook login** — not just the
political/EU ads exposed by Meta's official Ad Library API.

> **Disclaimer.** This tool scrapes a public website's internal API. It is not
> affiliated with or endorsed by Meta. Facebook rotates these internals
> regularly, so expect to run `npm run smoke` and update a constant or two from
> time to time (see [Maintenance](#maintenance)). Intended for personal and
> research use — respect Meta's Terms of Service, robots directives, and the law
> in your jurisdiction. Keep request volume low.

## Requirements

- Node.js ≥ 18 (uses built-in `fetch`; developed on Node 22)
- No browser, no Facebook account

## Setup

```bash
cd ad-library-api
npm install
cp .env.example .env      # optional — sensible defaults work out of the box
npm start
```

The server binds to `127.0.0.1:4100` by default (localhost only — it is a
private, single-user tool). Open <http://127.0.0.1:4100/> for a quick index.

For live development: `npm run dev` (restarts on file changes).

## Endpoints

All endpoints live under `/api`. Responses are JSON. When an `API_KEY` is set,
send it as `X-API-Key: <key>` (or `?api_key=<key>`); `/api/health` is always open.

### `GET /api/search`

Search ads by keyword or page, with filters and cursor pagination.

| Param | Description | Default |
|-------|-------------|---------|
| `q` | Keyword query (required unless `page_id` is given) | — |
| `page_id` | Restrict to a page (switches to page search) | — |
| `country` | ISO 3166-1 alpha-2 country code | `DEFAULT_COUNTRY` (US) |
| `active_status` | `all` \| `active` \| `inactive` | `all` |
| `ad_type` | `all` \| `political_and_issue_ads` \| `housing_ads` \| `employment_ads` \| `credit_ads` \| `financial_products_and_services_ads` | `all` |
| `media_type` | `all` \| `image` \| `meme` \| `video` \| `none` | `all` |
| `search_type` | `keyword_unordered` \| `keyword_exact_phrase` | `keyword_unordered` |
| `platform` | Comma list: `facebook,instagram,messenger,audience_network,threads` | — |
| `start_date`, `end_date` | Filter by ad start date (`YYYY-MM-DD`) | — |
| `cursor` | `end_cursor` from a previous response (next page) | — |
| `first` | Page size (max 50) | 30 |
| `fresh` | `1` to bypass the cache for this request | — |

```bash
# Page 1
curl "http://127.0.0.1:4100/api/search?q=nike&country=US&active_status=all&first=10"

# Page 2 — pass the end_cursor from page 1
curl "http://127.0.0.1:4100/api/search?q=nike&country=US&cursor=<end_cursor>"
```

### `GET /api/pages/:pageId/ads`

Every ad for a specific page. Same filters as `/api/search` (minus `q`/`search_type`).

```bash
curl "http://127.0.0.1:4100/api/pages/20531316728/ads?country=US"
```

### `GET /api/ads/:id`

Full detail for a single ad by `ad_archive_id`. `page_id` is optional but
improves the lookup.

```bash
curl "http://127.0.0.1:4100/api/ads/1234567890123456?page_id=20531316728&country=US"
```

### `GET /api/health`

Liveness plus session/cache introspection. Never makes a live call to Facebook.

```bash
curl "http://127.0.0.1:4100/api/health"
```

## Response shape

List endpoints return:

```jsonc
{
  "query":  { /* the params that were used (also the cache key) */ },
  "ads":    [ /* normalized ad objects, see below */ ],
  "page_info": { "has_next_page": true, "end_cursor": "AQH…" },
  "count":  4213,        // total matches upstream reports (may be approximate)
  "cached": false        // true when served from the local cache
}
```

Each normalized ad:

```jsonc
{
  "ad_archive_id": "1234567890123456",
  "ad_id": null,
  "page_id": "20531316728",
  "page_name": "Nike",
  "page_profile_url": "https://www.facebook.com/nike",
  "page_profile_picture_url": "https://…",
  "is_active": true,
  "start_date": "2024-01-01",         // YYYY-MM-DD (UTC), or null
  "end_date": null,
  "publisher_platforms": ["FACEBOOK", "INSTAGRAM"],
  "display_format": "IMAGE",
  "creative": {
    "title": "Nike Air Max",
    "body": "Shop the new collection…",
    "caption": "nike.com",
    "byline": null,
    "cta_text": "Shop now",
    "cta_type": "SHOP_NOW",
    "link_url": "https://www.nike.com/…",
    "images": [{ "original_url": "…", "resized_url": "…", "watermarked_url": "…" }],
    "videos": [{ "video_url": "…", "preview_image_url": "…", "watermarked_url": "…" }],
    "cards":  [{ "title": "…", "body": "…", "cta_text": "…", "link_url": "…", "image_url": "…", "video_url": "…" }]
  },
  "categories": [],
  "contains_sensitive_content": false,
  "transparency": null                // populated only for political / EU ads:
  // { "currency": "USD", "spend": { "lower": 5000, "upper": 5999 },
  //   "impressions": { "text": "10K - 15K", "lower": 10000, "upper": 15000 },
  //   "eu_total_reach": 125000, "reach_estimate": null,
  //   "payer": "…", "beneficiary": "…" }
}
```

Every field is null-safe: when Facebook omits something, you get `null` or `[]`,
never an error.

## Errors

Errors use a consistent envelope and HTTP status:

```json
{ "error": { "code": "invalid_params", "message": "…" } }
```

| Code | Status | Meaning |
|------|--------|---------|
| `invalid_params` | 400 | Bad/missing query parameters |
| `unauthorized` | 401 | Missing/wrong API key |
| `not_found` | 404 | Unknown endpoint, or ad id not found |
| `upstream_blocked` | 502 | Facebook blocked, rate-limited, or returned no data |
| `token_expired` | 503 | Session went stale and couldn't be refreshed |

## Configuration

All via `.env` (see `.env.example`) or a gitignored `config.local.json`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4100` | Listen port |
| `BIND_HOST` | `127.0.0.1` | Bind address (keep on localhost) |
| `API_KEY` | _(empty)_ | If set, require it on every non-health request |
| `CACHE_TTL_SECONDS` | `3600` | How long identical queries are cached |
| `MIN_REQUEST_DELAY_MS` | `2000` | Minimum spacing between upstream calls |
| `MAX_RETRIES` | `3` | Retries on rate-limit/transient errors |
| `BACKOFF_BASE_MS` | `5000` | Exponential backoff base |
| `SESSION_TTL_SECONDS` | `1800` | Re-bootstrap the scraping session after this |
| `DEFAULT_COUNTRY` | `US` | Country used when `?country=` is omitted |
| `HTTPS_PROXY` | _(empty)_ | Route upstream calls through a proxy (needs `undici`) |
| `USER_AGENT` | _(built-in)_ | Override the browser UA sent to Facebook |
| `DATA_DIR` | `./data` | Where the SQLite cache lives |

## Rate-limit etiquette

The scraper serializes upstream calls (one at a time), spaces them by
`MIN_REQUEST_DELAY_MS`, backs off with jitter on `429`, and caches aggressively.
Getting your IP throttled/blocked is the main failure mode, so: keep the delay
high, rely on the cache, and don't run tight loops. Set `HTTPS_PROXY` if you need
to distribute requests.

## Testing

```bash
npm test              # offline unit tests (normalizer, cache, variables, session parsing)
npm run smoke         # one live search against Facebook — prints results + timing
npm run smoke -- --capture "nike" US   # also refresh test/fixtures/ from a live response
```

`npm test` runs fully offline against captured fixtures, so it's safe in CI. The
included fixtures are representative samples of the real payload structure; run
`npm run smoke -- --capture` on a network that can reach `facebook.com` to replace
them with a live capture.

## Runtime compatibility

Meta changes the Ad Library frontend frequently. The client handles the current
bounded client challenge, extracts initial search and deeplink detail data from
server-rendered payloads, and discovers current operation IDs from Meta's loaded
JavaScript assets. Continuation cursors are opaque and never expose upstream
cookies. A process-only health check is not enough: production monitoring should
also run a low-frequency live canary search.

## Maintenance

When search suddenly returns nothing or `upstream_blocked`, in order:

1. **Run `npm run smoke`** — the fastest way to see what broke.
2. **`doc_id` rotated** (most common). The scraper discovers the current one from
   the live page HTML at runtime; the last-known-good fallbacks live in
   `src/constants.js`. Update them if discovery stops finding a value.
3. **Session/token stale** — handled automatically (the client detects HTTP 403
   and Facebook error `1357004`, re-bootstraps, and retries), but a persistent
   `token_expired` means the bootstrap HTML shape changed; check the regexes in
   `src/lib/session.js`.
4. **Field names changed** — all payload knowledge is isolated in
   `src/lib/normalize.js`. The unit tests there will fail loudly against updated
   fixtures, telling you exactly what moved.

## Project layout

```
ad-library-api/
  config.js                # env + config.local.json merge
  src/
    index.js               # Express app, binds 127.0.0.1
    constants.js           # friendly names, fallback doc_ids, enums  ← drift lives here
    db.js                  # SQLite open + cache schema
    store.js               # shared cache instance
    lib/
      session.js           # token/doc_id bootstrap + refresh
      graphqlClient.js     # POST, retries, backoff, re-bootstrap
      rateLimiter.js       # serial + min-delay queue
      variables.js         # API params → GraphQL variables
      normalize.js         # raw payload → stable schema  ← drift lives here
      cache.js             # SQLite TTL cache
      listQuery.js         # shared search/page pipeline
      http.js              # fetch wrapper + optional proxy
      errors.js            # error taxonomy
    middleware/            # apiKey, errorHandler
    routes/                # search, pages, ads, health
  scripts/smoke.js         # live end-to-end check / fixture capture
  test/                    # node --test suites + fixtures
```
