'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// The adapter reads the key at call time from config, which reads env at load.
process.env.TWELVEDATA_API_KEY = 'test-key';
const td = require('./twelvedata');

// Swap global.fetch for a stub that returns a canned JSON body per test.
function mockFetch(body, ok = true) {
  global.fetch = async () => ({ ok, status: ok ? 200 : 500, json: async () => body });
}

test('search normalizes symbol_search rows', async () => {
  mockFetch({
    data: [
      {
        symbol: 'AAPL',
        instrument_name: 'Apple Inc',
        exchange: 'NASDAQ',
        mic_code: 'XNGS',
        instrument_type: 'Common Stock',
        currency: 'USD',
        country: 'United States',
      },
    ],
  });
  const rows = await td.search('apple');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    symbol: 'AAPL',
    name: 'Apple Inc',
    exchange: 'NASDAQ',
    mic_code: 'XNGS',
    type: 'Common Stock',
    currency: 'USD',
    country: 'United States',
  });
});

test('quote maps fields and 52-week range to numbers', async () => {
  mockFetch({
    symbol: 'AAPL',
    name: 'Apple Inc',
    exchange: 'NASDAQ',
    currency: 'USD',
    open: '190.1',
    high: '192.0',
    low: '189.5',
    close: '191.4',
    previous_close: '190.0',
    change: '1.4',
    percent_change: '0.73',
    volume: '50000000',
    fifty_two_week: { high: '199.6', low: '164.1' },
  });
  const q = await td.quote('AAPL');
  assert.equal(q.price, 191.4);
  assert.equal(q.changePercent, 0.73);
  assert.equal(q.week52High, 199.6);
  assert.equal(q.week52Low, 164.1);
});

test('candles come back oldest→newest with unix-second times', async () => {
  mockFetch({
    values: [
      { datetime: '2024-01-02', open: '1', high: '2', low: '0.5', close: '1.5', volume: '100' },
      { datetime: '2024-01-03', open: '1.5', high: '2.5', low: '1', close: '2', volume: '200' },
    ],
  });
  const candles = await td.candles('AAPL', '1day', 2);
  assert.equal(candles.length, 2);
  assert.equal(typeof candles[0].time, 'number');
  assert.equal(candles[0].close, 1.5);
  assert.equal(candles[1].volume, 200);
});

test('in-body error surfaces as a thrown Error', async () => {
  mockFetch({ status: 'error', code: 404, message: 'symbol not found' });
  await assert.rejects(() => td.quote('NOPE'), /symbol not found/);
});

test('profile returns null when the endpoint is not on the plan', async () => {
  mockFetch({ status: 'error', code: 403, message: 'premium' });
  const p = await td.profile('AAPL');
  assert.equal(p, null);
});
