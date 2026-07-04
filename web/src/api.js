// Tiny fetch wrapper for the local API.
async function j(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  health: () => j('/api/health'),
  searchSymbols: (q) => j(`/api/symbols/search?q=${encodeURIComponent(q)}`),
  getQuote: (symbol) => j(`/api/quote/${encodeURIComponent(symbol)}`),
  getCandles: (symbol, interval, outputsize) =>
    j(
      `/api/candles/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(
        interval
      )}&outputsize=${outputsize}`
    ),
  getCompany: (symbol) => j(`/api/company/${encodeURIComponent(symbol)}`),
  getWatchlist: () => j('/api/watchlist'),
  addToWatchlist: (symbol, name) =>
    j('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, name }),
    }),
  removeFromWatchlist: (symbol) =>
    j(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' }),
};
