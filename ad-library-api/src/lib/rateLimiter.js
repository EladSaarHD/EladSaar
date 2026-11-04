'use strict';

// Serializes upstream calls (concurrency 1 by default) and guarantees at
// least `minDelayMs` between the *start* of one call and the next. This keeps
// us polite to Facebook and is the main defense against IP rate limiting.
class RateLimiter {
  constructor({ minDelayMs = 2000, concurrency = 1 } = {}) {
    this.minDelayMs = minDelayMs;
    this.concurrency = Math.max(1, concurrency);
    this.active = 0;
    this.queue = [];
    this.lastStart = 0;
    this.cooldownUntil = 0; // set by AdaptiveRateLimiter after a pressure signal
  }

  _onStart() {}

  _budgetWait() { return 0; }

  schedule(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    if (this.active >= this.concurrency || this.queue.length === 0) return;

    const now = Date.now();
    const wait = Math.max(0, this.lastStart + this.minDelayMs - now, this.cooldownUntil - now, this._budgetWait(now));

    setTimeout(() => {
      // Re-check: another timer may have consumed the slot while we waited.
      if (this.active >= this.concurrency || this.queue.length === 0) return;
      const job = this.queue.shift();
      this.active += 1;
      this.lastStart = Date.now();
      this._onStart(this.lastStart);

      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          this._drain();
        });

      // If concurrency > 1, keep filling remaining slots.
      this._drain();
    }, wait);
  }
}

// Self-tuning pacing. Starts at `startMs` (the proven-safe spacing), creeps toward `floorMs` only while
// requests keep succeeding, and on ANY pressure signal (429, 5xx, empty payload, blocked first page)
// snaps back to at least `startMs`, doubles the spacing, and pauses for a cool-down that grows if
// signals keep coming. It can only be faster than the safe baseline while Meta is visibly not pushing
// back, and it never goes below the configured floor.
class AdaptiveRateLimiter extends RateLimiter {
  _onStart(at) {
    if (this.onRequestStart) this.onRequestStart(at);
    this.starts.push(at);
    if (this.starts.length > 4000 || (this.starts[0] && at - this.starts[0] > 2 * 3600000)) {
      this.starts = this.starts.filter((t) => at - t < 2 * 3600000);
    }
  }

  constructor({ startMs = 2000, floorMs = startMs, ceilingMs = 12000, speedUpAfter = 25, speedUpFactor = 0.85,
    slowFactor = 2, cooldownMs = 30000, maxCooldownMs = 300000, penaltyWindowMs = 300000, maxPerHour = 0, onRequestStart = null, concurrency = 1 } = {}) {
    super({ minDelayMs: startMs, concurrency });
    this.startMs = startMs;
    this.maxPerHour = maxPerHour; // soft rolling budget; 0 = unlimited
    this.onRequestStart = onRequestStart;
    this.floorMs = Math.min(floorMs, startMs);
    this.ceilingMs = Math.max(ceilingMs, startMs);
    this.speedUpAfter = speedUpAfter;
    this.speedUpFactor = speedUpFactor;
    this.slowFactor = slowFactor;
    this.cooldownMs = cooldownMs;
    this.maxCooldownMs = maxCooldownMs;
    this.penaltyWindowMs = penaltyWindowMs;
    this.streak = 0;
    this.penalties = 0;
    this.recentPenalties = [];
    this.lastPenalty = null;
    this.successes = 0;
    this.holdUntil = 0; // no speed-up before this time (set after a rate-limit)
    this.rateLimitHits = [];
    this.starts = []; // request start times (last 2 h) so a rate-limit can be correlated with the load before it
  }

  // Rolling hourly budget: when this hour already holds `maxPerHour` requests, wait until the oldest one
  // ages out. Spreads heavy back-to-back scans instead of letting them pile up into a burst Meta rate-limits.
  _budgetWait(now) {
    if (!(this.maxPerHour > 0)) return 0;
    const recent = this.starts.filter((at) => now - at < 3600000);
    if (recent.length < this.maxPerHour) return 0;
    return Math.max(0, recent[recent.length - this.maxPerHour] + 3600000 - now);
  }

  // Count request starts in the last `ms` milliseconds.
  requestsSince(ms, now = Date.now()) {
    return this.starts.filter((at) => now - at < ms).length;
  }

  reward() {
    this.successes += 1;
    this.streak += 1;
    if (this.minDelayMs > this.floorMs && this.streak >= this.speedUpAfter && Date.now() >= this.holdUntil) {
      this.minDelayMs = Math.max(this.floorMs, Math.round(this.minDelayMs * this.speedUpFactor));
      this.streak = 0;
    }
  }

  penalize(reason = 'pressure', now = Date.now()) {
    this.penalties += 1;
    this.streak = 0;
    this.recentPenalties = this.recentPenalties.filter((at) => now - at < this.penaltyWindowMs);
    this.recentPenalties.push(now);
    this.minDelayMs = Math.min(this.ceilingMs, Math.max(this.startMs, this.minDelayMs * this.slowFactor));
    const cooldown = Math.min(this.maxCooldownMs, this.cooldownMs * 2 ** (this.recentPenalties.length - 1));
    this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldown);
    this.lastPenalty = { reason: String(reason).slice(0, 120), at: now, cooldown_ms: cooldown };
  }

  // Meta said "Rate limit exceeded". Long cool-down (5 -> 15 -> 30 min for repeats within 2 h), pace at least
  // double the baseline, and no speed-up for the next 2 hours. Returns the event for logging.
  rateLimited(reason = 'rate limit', now = Date.now()) {
    this.rateLimitHits = this.rateLimitHits.filter((at) => now - at < 2 * 3600000);
    const cooldown = [300000, 900000, 1800000][Math.min(this.rateLimitHits.length, 2)];
    this.rateLimitHits.push(now);
    this.penalties += 1;
    this.streak = 0;
    this.minDelayMs = Math.min(this.ceilingMs, Math.max(this.startMs * 2, this.minDelayMs * 2));
    this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldown);
    this.holdUntil = now + 2 * 3600000;
    this.lastPenalty = { reason: String(reason).slice(0, 120), at: now, cooldown_ms: cooldown, rate_limit: true };
    return { at: now, reason: String(reason).slice(0, 200), requests_10m: this.requestsSince(600000, now),
      requests_60m: this.requestsSince(3600000, now), delay_ms: this.minDelayMs, cooldown_ms: cooldown };
  }

  // Rebuild state after a restart: the request history (so the hourly budget is honest) and, if Meta rate-limited
  // us recently, the cool-down / pace / no-speed-up hold that were in force.
  restore({ starts = [], lastEvent = null, now = Date.now() } = {}) {
    this.starts = starts.filter((at) => now - at < 2 * 3600000).sort((a, b) => a - b);
    if (lastEvent && now - lastEvent.at < 2 * 3600000) {
      this.rateLimitHits.push(lastEvent.at);
      this.cooldownUntil = Math.max(this.cooldownUntil, lastEvent.at + (lastEvent.cooldown_ms || 0));
      this.holdUntil = Math.max(this.holdUntil, lastEvent.at + 2 * 3600000);
      this.minDelayMs = Math.min(this.ceilingMs, Math.max(this.startMs * 2, this.minDelayMs));
      this.lastPenalty = { reason: String(lastEvent.reason || 'rate limit (restored)').slice(0, 120), at: lastEvent.at, cooldown_ms: lastEvent.cooldown_ms || 0, rate_limit: true };
    }
  }

  stats() {
    return { delay_ms: this.minDelayMs, start_ms: this.startMs, floor_ms: this.floorMs, ceiling_ms: this.ceilingMs,
      streak: this.streak, successes: this.successes, penalties: this.penalties, last_penalty: this.lastPenalty,
      requests_10m: this.requestsSince(600000), requests_60m: this.requestsSince(3600000), max_per_hour: this.maxPerHour,
      hold_ms: Math.max(0, this.holdUntil - Date.now()),
      cooling_down_ms: Math.max(0, this.cooldownUntil - Date.now()) };
  }
}

module.exports = { RateLimiter, AdaptiveRateLimiter };
