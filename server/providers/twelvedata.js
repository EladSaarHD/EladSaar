'use strict';

// Twelve Data adapter — https://twelvedata.com/docs
//
// Free ("Basic") plan gives: symbol_search, quote, time_series (OHLC), and —
// depending on the account — profile/statistics. We normalize every response to
// the neutral shape documented in ./index.js and tolerate premium-only
// endpoints by returning null rather than throwing.

const config = require('../config');

const BASE = 'https://api.twelvedata.com';

function apiKey() {
  const key = config.provider.apiKey;
  if (!key) {
    throw new Error(
      'No API key configured. Set TWELVEDATA_API_KEY in .env (free key at https://twelvedata.com).'
    );
  }
  return key;
}

async function call(pathname, params) {
  const url = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  url.searchParams.set('apikey', apiKey());

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const body = await res.json();

  // Twelve Data signals errors in-body with { status: 'error', code, message }.
  if (body && body.status === 'error') {
    const msg = body.message || 'Twelve Data error';
    const err = new Error(msg);
    err.code = body.code;
    throw err;
  }
  return body;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---- search ----------------------------------------------------------------

async function search(query) {
  const body = await call('/symbol_search', { symbol: query, outputsize: 30 });
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.instrument_name,
    exchange: r.exchange,
    mic_code: r.mic_code,
    type: r.instrument_type,
    currency: r.currency,
    country: r.country,
  }));
}

// ---- quote -----------------------------------------------------------------

async function quote(symbol) {
  const q = await call('/quote', { symbol });
  const fw = q.fifty_two_week || {};
  return {
    symbol: q.symbol || symbol,
    name: q.name || null,
    exchange: q.exchange || null,
    currency: q.currency || null,
    price: num(q.close),
    open: num(q.open),
    high: num(q.high),
    low: num(q.low),
    previousClose: num(q.previous_close),
    change: num(q.change),
    changePercent: num(q.percent_change),
    volume: num(q.volume),
    week52High: num(fw.high),
    week52Low: num(fw.low),
    datetime: q.datetime || null,
    isMarketOpen: q.is_market_open ?? null,
  };
}

// ---- candles ---------------------------------------------------------------

async function candles(symbol, interval, outputsize) {
  const body = await call('/time_series', {
    symbol,
    interval,
    outputsize: outputsize || 500,
    order: 'ASC', // oldest → newest, which is what Lightweight Charts wants
  });
  const values = Array.isArray(body.values) ? body.values : [];
  return values
    .map((v) => ({
      // Lightweight Charts accepts a UNIX timestamp (seconds) for `time`.
      time: Math.floor(new Date(v.datetime.replace(' ', 'T')).getTime() / 1000),
      open: num(v.open),
      high: num(v.high),
      low: num(v.low),
      close: num(v.close),
      volume: num(v.volume) || 0,
    }))
    .filter((c) => Number.isFinite(c.time) && c.close !== null);
}

// ---- profile ---------------------------------------------------------------

async function profile(symbol) {
  try {
    const p = await call('/profile', { symbol });
    return {
      name: p.name || null,
      exchange: p.exchange || null,
      sector: p.sector || null,
      industry: p.industry || null,
      employees: num(p.employees),
      website: p.website || null,
      description: p.description || null,
      ceo: p.CEO || null,
      country: p.country || null,
    };
  } catch (err) {
    // 400/403 → endpoint not on this plan; treat as "no profile available".
    return null;
  }
}

// ---- statistics ------------------------------------------------------------

async function statistics(symbol) {
  try {
    const s = await call('/statistics', { symbol });
    const stats = s.statistics || {};
    const val = stats.valuations_metrics || {};
    const fin = stats.financials || {};
    const div = stats.dividends_and_splits || {};
    const price = stats.stock_price_summary || {};
    return {
      marketCap: num(val.market_capitalization),
      peRatio: num(val.trailing_pe),
      forwardPe: num(val.forward_pe),
      eps: num((fin.income_statement || {}).diluted_eps_ttm),
      beta: num(price.beta),
      dividendYield: num(div.forward_annual_dividend_yield),
      week52High: num(price.fifty_two_week_high),
      week52Low: num(price.fifty_two_week_low),
    };
  } catch (err) {
    return null;
  }
}

module.exports = { search, quote, candles, profile, statistics };
