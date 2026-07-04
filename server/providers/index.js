'use strict';

// Provider selection — mirrors the pluggable-adapter shape the codebase already
// uses. A provider exposes a uniform interface so routes never know which
// upstream API is behind them:
//
//   search(query)                       -> [{ symbol, name, exchange, mic_code, type, currency, country }]
//   quote(symbol)                       -> { symbol, name, price, change, changePercent, open, high, low,
//                                            previousClose, volume, week52High, week52Low, currency, exchange }
//   candles(symbol, interval, outputsize) -> [{ time, open, high, low, close, volume }]  (oldest → newest)
//   profile(symbol)                     -> { name, exchange, sector, industry, employees, website, description, ... } | null
//   statistics(symbol)                  -> { marketCap, peRatio, eps, beta, dividendYield, ... } | null
//
// Add a new provider by dropping a module here that implements the same shape.

const config = require('../config');
const twelvedata = require('./twelvedata');

const providers = { twelvedata };

function getProvider() {
  const name = config.provider.name;
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown data provider "${name}". Available: ${Object.keys(providers).join(', ')}`
    );
  }
  return provider;
}

module.exports = { getProvider };
