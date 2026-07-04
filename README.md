# TradeView — a local, self-hosted TradingView clone

TradeView is a private, local stock-charting app inspired by
[TradingView](https://www.tradingview.com/). Search any of thousands of real
stocks, view interactive candlestick charts across multiple timeframes with
volume and indicators, keep a watchlist, and read company fundamentals — all
running on your own machine against a free market-data API.

![layout: watchlist · chart · info panel](https://img.shields.io/badge/layout-watchlist%20%C2%B7%20chart%20%C2%B7%20info-informational)

## Features

- **Symbol search** across the data provider's full universe (US + global
  equities, ETFs, …) with autocomplete.
- **Interactive charts** (TradingView's own open-source
  [Lightweight Charts](https://github.com/tradingview/lightweight-charts)):
  candlestick / line / area, volume histogram, and timeframes from **1D → Max**.
- **Indicators** computed client-side: **SMA 20**, **EMA 50**, and an **RSI 14**
  sub-pane.
- **Watchlist** with live quotes and % change, persisted in SQLite.
- **Company info panel**: price, day range, 52-week range, market cap, P/E, EPS,
  beta, dividend yield, and a company description (when the plan exposes them).
- **Server-side caching + rate-limit throttle** so the free API tier is never
  exceeded and the UI stays fast.

## Requirements

- **Node.js 18+** (uses the built-in `fetch`).
- A **free Twelve Data API key** — sign up at
  [twelvedata.com](https://twelvedata.com/pricing) (the free "Basic" plan gives
  800 requests/day, 8/min). Without a key the UI loads but returns no live data.

## Setup

```bash
npm install
cp .env.example .env        # then paste your TWELVEDATA_API_KEY into .env
npm run build               # build the web UI
npm start                   # → http://localhost:4000
```

For development with hot-reload (API + Vite dev server):

```bash
npm run dev                 # API on :4000, UI on :5173
```

## Configuration

Edit `.env` (gitignored). Key settings:

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port (default 4000) |
| `DATA_DIR` | Where the SQLite cache/watchlist DB lives (default `./data`) |
| `PROVIDER` | Market-data provider (currently `twelvedata`) |
| `TWELVEDATA_API_KEY` | Your free API key |
| `PROVIDER_RPM` | Max upstream requests/min (default 8, matches the free tier) |

You can instead copy `config.example.json` → `config.local.json` for a JSON
config that overrides `.env`.

## How it works

```
Browser (React + Lightweight Charts)
   │  /api/...
Express API  ──►  provider adapter (Twelve Data)  ──►  upstream API
   │                    ▲
   └── SQLite cache (quotes, candles, symbols) + token-bucket throttle
```

Every route goes through a **read-through SQLite cache** with a per-kind TTL
(quotes ~15s, intraday candles ~60s, daily candles ~1h, fundamentals ~6h). A
**token-bucket throttle** guarantees the app never issues more than
`PROVIDER_RPM` upstream calls per minute, and a failed refetch falls back to the
last good cached value.

### Swapping data providers

The upstream API lives behind a small adapter interface in
`server/providers/`. To add Finnhub, Polygon, or a no-key Yahoo fallback, drop a
module that implements `search / quote / candles / profile / statistics` and
register it in `server/providers/index.js` — no route changes needed.

## Security notes

- The server binds to **127.0.0.1 only** — it is not exposed to your network.
- Your API key lives in `.env` / `config.local.json`, which are gitignored.
- The `/data` folder (SQLite cache + watchlist) is gitignored.

## Project layout

```
server/   Express API, SQLite cache/throttle, pluggable data-provider adapters
web/      Vite + React UI (Lightweight Charts, watchlist, info panel)
data/     runtime SQLite db (gitignored)
```

## API quick reference

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | status + whether a key is configured |
| `GET` | `/api/symbols/search?q=` | symbol autocomplete |
| `GET` | `/api/quote/:symbol` | latest price snapshot |
| `GET` | `/api/candles/:symbol?interval=&outputsize=` | OHLC candles |
| `GET` | `/api/company/:symbol` | profile + key statistics |
| `GET`/`POST`/`DELETE` | `/api/watchlist` | manage the watchlist |

## Tests

```bash
npm test        # provider normalization + cache TTL/throttle (node --test)
```

## Notes / limits

- **"All stocks"** = every symbol the provider exposes via search, not a
  hard-coded list — but bounded by that provider's universe, not literally every
  venue on earth.
- Free-tier limits are handled by caching + throttling; a large watchlist just
  serves slightly staler quotes.
- Real-time streaming (WebSocket) is not wired up yet; quotes refresh via short
  polling. It can be added later behind the same provider adapter.
