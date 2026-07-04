import React from 'react';

// Timeframe presets → the (interval, outputsize) we ask the API for.
// Kept here so the Chart and App share one source of truth.
export const TIMEFRAMES = [
  { label: '1D', interval: '5min', outputsize: 78 },
  { label: '5D', interval: '30min', outputsize: 65 },
  { label: '1M', interval: '1day', outputsize: 22 },
  { label: '3M', interval: '1day', outputsize: 66 },
  { label: '6M', interval: '1day', outputsize: 132 },
  { label: '1Y', interval: '1day', outputsize: 252 },
  { label: '5Y', interval: '1week', outputsize: 260 },
  { label: 'Max', interval: '1month', outputsize: 360 },
];

export const CHART_TYPES = ['candles', 'line', 'area'];

export const INDICATORS = [
  { key: 'sma', label: 'SMA 20' },
  { key: 'ema', label: 'EMA 50' },
  { key: 'rsi', label: 'RSI 14' },
];

export default function Toolbar({
  timeframe,
  onTimeframe,
  chartType,
  onChartType,
  indicators,
  onToggleIndicator,
}) {
  return (
    <div className="toolbar">
      <div className="tf-group">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.label}
            className={`chip ${timeframe === tf.label ? 'active' : ''}`}
            onClick={() => onTimeframe(tf.label)}
          >
            {tf.label}
          </button>
        ))}
      </div>

      <div className="spacer" />

      <div className="type-group">
        {CHART_TYPES.map((t) => (
          <button
            key={t}
            className={`chip ${chartType === t ? 'active' : ''}`}
            onClick={() => onChartType(t)}
            title={t}
          >
            {t === 'candles' ? '📊' : t === 'line' ? '📈' : '🌄'}
          </button>
        ))}
      </div>

      <div className="ind-group">
        {INDICATORS.map((ind) => (
          <button
            key={ind.key}
            className={`chip ${indicators[ind.key] ? 'active' : ''}`}
            onClick={() => onToggleIndicator(ind.key)}
          >
            {ind.label}
          </button>
        ))}
      </div>
    </div>
  );
}
