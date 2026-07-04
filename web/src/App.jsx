import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import SymbolSearch from './components/SymbolSearch.jsx';
import Toolbar, { TIMEFRAMES } from './components/Toolbar.jsx';
import Chart from './components/Chart.jsx';
import Watchlist from './components/Watchlist.jsx';
import InfoPanel from './components/InfoPanel.jsx';

const tfByLabel = (label) => TIMEFRAMES.find((t) => t.label === label) || TIMEFRAMES[5];

export default function App() {
  const [symbol, setSymbol] = useState('AAPL');
  const [symbolName, setSymbolName] = useState('Apple Inc');
  const [timeframe, setTimeframe] = useState('1Y');
  const [chartType, setChartType] = useState('candles');
  const [indicators, setIndicators] = useState({ sma: false, ema: false, rsi: false });

  const [candles, setCandles] = useState([]);
  const [quote, setQuote] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [watchlist, setWatchlist] = useState([]);
  const [hasKey, setHasKey] = useState(true);

  // Warn if the server has no API key configured.
  useEffect(() => {
    api.health().then((h) => setHasKey(h.hasApiKey)).catch(() => {});
  }, []);

  // Candles: reload when the symbol or timeframe changes.
  useEffect(() => {
    const tf = tfByLabel(timeframe);
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .getCandles(symbol, tf.interval, tf.outputsize)
      .then((res) => {
        if (!cancelled) setCandles(res.candles || []);
      })
      .catch((e) => {
        if (!cancelled) {
          setCandles([]);
          setError(e.message);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  // Quote + company: reload on symbol change, and poll the quote every 15s.
  useEffect(() => {
    let cancelled = false;
    const loadQuote = () =>
      api
        .getQuote(symbol)
        .then((q) => !cancelled && setQuote(q))
        .catch(() => {});
    setQuote(null);
    setCompany(null);
    loadQuote();
    api
      .getCompany(symbol)
      .then((c) => !cancelled && setCompany(c))
      .catch(() => {});
    const t = setInterval(loadQuote, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [symbol]);

  // Watchlist: load on mount and poll every 30s for live quotes.
  const loadWatchlist = useCallback(() => {
    api.getWatchlist().then(setWatchlist).catch(() => {});
  }, []);
  useEffect(() => {
    loadWatchlist();
    const t = setInterval(loadWatchlist, 30000);
    return () => clearInterval(t);
  }, [loadWatchlist]);

  const pickSymbol = (row) => {
    setSymbol(row.symbol.toUpperCase());
    setSymbolName(row.name || '');
  };

  const inWatchlist = watchlist.some((w) => w.symbol === symbol);
  const toggleWatch = async () => {
    if (inWatchlist) await api.removeFromWatchlist(symbol);
    else await api.addToWatchlist(symbol, symbolName || (quote && quote.name));
    loadWatchlist();
  };

  const toggleIndicator = (key) =>
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">📈 TradeView</div>
        <SymbolSearch onPick={pickSymbol} />
        <div className="active-symbol">
          <span className="as-ticker">{symbol}</span>
          <button
            className={`star ${inWatchlist ? 'on' : ''}`}
            onClick={toggleWatch}
            title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            {inWatchlist ? '★' : '☆'}
          </button>
        </div>
      </header>

      {!hasKey && (
        <div className="key-banner">
          No API key configured. Add <code>TWELVEDATA_API_KEY</code> to your{' '}
          <code>.env</code> (free key at twelvedata.com) and restart to load live
          data.
        </div>
      )}

      <div className="layout">
        <Watchlist
          items={watchlist}
          activeSymbol={symbol}
          onSelect={(s) => setSymbol(s)}
          onRemove={async (s) => {
            await api.removeFromWatchlist(s);
            loadWatchlist();
          }}
        />

        <main className="center">
          <Toolbar
            timeframe={timeframe}
            onTimeframe={setTimeframe}
            chartType={chartType}
            onChartType={setChartType}
            indicators={indicators}
            onToggleIndicator={toggleIndicator}
          />
          <Chart
            candles={candles}
            chartType={chartType}
            indicators={indicators}
            loading={loading}
            error={error}
          />
        </main>

        <InfoPanel symbol={symbol} quote={quote} company={company} />
      </div>
    </div>
  );
}
