import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import { sma, ema, rsi } from '../indicators';

const UP = '#26a69a';
const DOWN = '#ef5350';

const baseOptions = {
  layout: {
    background: { type: ColorType.Solid, color: 'transparent' },
    textColor: '#b2b5be',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  grid: {
    vertLines: { color: 'rgba(120,123,134,0.12)' },
    horzLines: { color: 'rgba(120,123,134,0.12)' },
  },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: 'rgba(120,123,134,0.25)' },
  timeScale: { borderColor: 'rgba(120,123,134,0.25)', timeVisible: true },
};

// Rebuild the whole chart whenever inputs change. Recreating is cheap here and
// avoids stale-series bugs from swapping series types / toggling indicators.
export default function Chart({ candles, chartType, indicators, loading, error }) {
  const mainRef = useRef(null);
  const rsiRef = useRef(null);

  useEffect(() => {
    if (!mainRef.current || !candles || candles.length === 0) return;

    const chart = createChart(mainRef.current, {
      ...baseOptions,
      width: mainRef.current.clientWidth,
      height: mainRef.current.clientHeight,
    });

    // ---- price series (candles / line / area) ----
    let priceSeries;
    if (chartType === 'line') {
      priceSeries = chart.addLineSeries({ color: '#2962ff', lineWidth: 2 });
      priceSeries.setData(candles.map((c) => ({ time: c.time, value: c.close })));
    } else if (chartType === 'area') {
      priceSeries = chart.addAreaSeries({
        lineColor: '#2962ff',
        topColor: 'rgba(41,98,255,0.35)',
        bottomColor: 'rgba(41,98,255,0.02)',
        lineWidth: 2,
      });
      priceSeries.setData(candles.map((c) => ({ time: c.time, value: c.close })));
    } else {
      priceSeries = chart.addCandlestickSeries({
        upColor: UP,
        downColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
      });
      priceSeries.setData(candles);
    }

    // ---- volume (bottom overlay on its own scale) ----
    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(
      candles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)',
      }))
    );

    // ---- moving-average overlays ----
    if (indicators.sma) {
      const s = chart.addLineSeries({ color: '#f5a623', lineWidth: 1 });
      s.setData(sma(candles, 20));
    }
    if (indicators.ema) {
      const s = chart.addLineSeries({ color: '#e040fb', lineWidth: 1 });
      s.setData(ema(candles, 50));
    }

    chart.timeScale().fitContent();

    // ---- optional RSI sub-chart, time-synced with the main chart ----
    let rsiChart;
    if (indicators.rsi && rsiRef.current) {
      rsiChart = createChart(rsiRef.current, {
        ...baseOptions,
        width: rsiRef.current.clientWidth,
        height: rsiRef.current.clientHeight,
      });
      const rsiSeries = rsiChart.addLineSeries({ color: '#7e57c2', lineWidth: 1 });
      rsiSeries.setData(rsi(candles, 14));
      rsiSeries.createPriceLine({ price: 70, color: '#ef5350', lineStyle: 2, lineWidth: 1 });
      rsiSeries.createPriceLine({ price: 30, color: '#26a69a', lineStyle: 2, lineWidth: 1 });
      rsiChart.timeScale().fitContent();

      // Keep the two time scales aligned when the user pans/zooms.
      const mainTS = chart.timeScale();
      const rsiTS = rsiChart.timeScale();
      let syncing = false;
      mainTS.subscribeVisibleLogicalRangeChange((r) => {
        if (syncing || !r) return;
        syncing = true;
        rsiTS.setVisibleLogicalRange(r);
        syncing = false;
      });
      rsiTS.subscribeVisibleLogicalRangeChange((r) => {
        if (syncing || !r) return;
        syncing = true;
        mainTS.setVisibleLogicalRange(r);
        syncing = false;
      });
    }

    // ---- responsive resize ----
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: mainRef.current.clientWidth });
      if (rsiChart && rsiRef.current) {
        rsiChart.applyOptions({ width: rsiRef.current.clientWidth });
      }
    });
    ro.observe(mainRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      if (rsiChart) rsiChart.remove();
    };
  }, [candles, chartType, indicators.sma, indicators.ema, indicators.rsi]);

  return (
    <div className="chart-wrap">
      {loading && <div className="chart-overlay">Loading…</div>}
      {error && <div className="chart-overlay error">{error}</div>}
      {!loading && !error && (!candles || candles.length === 0) && (
        <div className="chart-overlay muted">No data for this symbol / range.</div>
      )}
      <div className="chart-main" ref={mainRef} />
      {indicators.rsi && <div className="chart-rsi" ref={rsiRef} />}
    </div>
  );
}
