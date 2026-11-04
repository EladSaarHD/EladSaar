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

  schedule(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    if (this.active >= this.concurrency || this.queue.length === 0) return;

    const now = Date.now();
    const wait = Math.max(0, this.lastStart + this.minDelayMs - now, this.cooldownUntil - now);

    setTimeout(() => {
      // Re-check: another timer may have consumed the slot while we waited.
      if (this.active >= this.concurrency || this.queue.length === 0) return;
      const job = this.queue.shift();
      this.active += 1;
      this.lastStart = Date.now();

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
  constructor({ startMs = 2000, floorMs = startMs, ceilingMs = 12000, speedUpAfter = 25, speedUpFactor = 0.85,
    slowFactor = 2, cooldownMs = 30000, maxCooldownMs = 300000, penaltyWindowMs = 300000, concurrency = 1 } = {}) {
    super({ minDelayMs: startMs, concurrency });
    this.startMs = startMs;
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
  }

  reward() {
    this.successes += 1;
    this.streak += 1;
    if (this.minDelayMs > this.floorMs && this.streak >= this.speedUpAfter) {
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

  stats() {
    return { delay_ms: this.minDelayMs, start_ms: this.startMs, floor_ms: this.floorMs, ceiling_ms: this.ceilingMs,
      streak: this.streak, successes: this.successes, penalties: this.penalties, last_penalty: this.lastPenalty,
      cooling_down_ms: Math.max(0, this.cooldownUntil - Date.now()) };
  }
}

module.exports = { RateLimiter, AdaptiveRateLimiter };
