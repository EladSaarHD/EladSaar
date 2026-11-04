'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { AdaptiveRateLimiter } = require('../src/lib/rateLimiter');

function make(overrides = {}) {
  return new AdaptiveRateLimiter({ startMs: 2000, floorMs: 1000, ceilingMs: 8000, speedUpAfter: 5, speedUpFactor: 0.8,
    cooldownMs: 1000, maxCooldownMs: 4000, ...overrides });
}

test('starts at the safe baseline and speeds up only after a clean streak, never below the floor', () => {
  const l = make();
  assert.strictEqual(l.minDelayMs, 2000);
  for (let i = 0; i < 4; i += 1) l.reward();
  assert.strictEqual(l.minDelayMs, 2000, 'not yet: streak is 4 of 5');
  l.reward();
  assert.strictEqual(l.minDelayMs, 1600);
  for (let i = 0; i < 40; i += 1) l.reward();
  assert.strictEqual(l.minDelayMs, 1000, 'clamped at the floor');
});

test('a pressure signal snaps back to at least the baseline, doubles from there, and starts a cool-down', () => {
  const l = make();
  for (let i = 0; i < 40; i += 1) l.reward();
  assert.strictEqual(l.minDelayMs, 1000);
  const now = 1_000_000;
  l.penalize('HTTP 429', now);
  assert.strictEqual(l.minDelayMs, 2000, 'never stays faster than the baseline after a signal');
  assert.strictEqual(l.streak, 0);
  assert.strictEqual(l.cooldownUntil, now + 1000);
  l.penalize('HTTP 429', now + 10);
  assert.strictEqual(l.minDelayMs, 4000, 'repeated signals keep slowing down');
  assert.strictEqual(l.cooldownUntil, now + 10 + 2000, 'cool-down doubles for repeated signals');
  for (let i = 0; i < 10; i += 1) l.penalize('HTTP 429', now + 20 + i);
  assert.strictEqual(l.minDelayMs, 8000, 'capped at the ceiling');
  assert.ok(l.cooldownUntil - (now + 29) <= 4000, 'cool-down capped');
});

test('with floor == start there is no speed-up at all (a safe default)', () => {
  const l = make({ floorMs: 2000 });
  for (let i = 0; i < 100; i += 1) l.reward();
  assert.strictEqual(l.minDelayMs, 2000);
});

test('the cool-down really delays the next request; stats expose the state', async () => {
  const l = new AdaptiveRateLimiter({ startMs: 20, floorMs: 20, cooldownMs: 150, maxCooldownMs: 150 });
  const starts = [];
  await l.schedule(async () => { starts.push(Date.now()); });
  l.penalize('test');
  await l.schedule(async () => { starts.push(Date.now()); });
  assert.ok(starts[1] - starts[0] >= 140, `second request waited out the cool-down (${starts[1] - starts[0]}ms)`);
  const stats = l.stats();
  assert.strictEqual(stats.penalties, 1);
  assert.strictEqual(stats.last_penalty.reason, 'test');
  assert.ok(stats.delay_ms >= 20);
});

test('old penalties age out of the escalation window', () => {
  const l = make({ penaltyWindowMs: 1000 });
  l.penalize('x', 0);
  l.penalize('x', 5000);
  assert.strictEqual(l.cooldownUntil, 5000 + 1000, 'the first signal expired, so the cool-down did not escalate');
});
