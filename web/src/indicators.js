// Client-side technical indicators computed from candle data. Each returns an
// array of { time, value } points aligned to the input candles, ready to feed a
// Lightweight Charts line series. Leading points with no value are omitted.

// Simple Moving Average.
export function sma(candles, period = 20) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

// Exponential Moving Average.
export function ema(candles, period = 20) {
  if (candles.length < period) return [];
  const out = [];
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` closes.
  let prev = 0;
  for (let i = 0; i < period; i++) prev += candles[i].close;
  prev /= period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

// Relative Strength Index (Wilder's smoothing).
export function rsi(candles, period = 14) {
  if (candles.length <= period) return [];
  const out = [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  const push = (i) => {
    const rs = loss === 0 ? 100 : gain / loss;
    const value = loss === 0 ? 100 : 100 - 100 / (1 + rs);
    out.push({ time: candles[i].time, value });
  };
  push(period);
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const up = diff > 0 ? diff : 0;
    const down = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + up) / period;
    loss = (loss * (period - 1) + down) / period;
    push(i);
  }
  return out;
}
