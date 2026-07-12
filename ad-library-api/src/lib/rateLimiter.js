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
    const wait = Math.max(0, this.lastStart + this.minDelayMs - now);

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

module.exports = { RateLimiter };
