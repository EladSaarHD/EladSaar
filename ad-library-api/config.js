'use strict';

const fs = require('fs');
const path = require('path');

// Load .env (if present) without requiring dotenv to exist at first run.
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch {
  /* dotenv not installed yet — env still works, just no .env file parsing */
}

const ROOT = __dirname;

// Optional JSON override file (gitignored). Takes precedence over env values.
let fileConfig = {};
const localConfigPath = path.join(ROOT, 'config.local.json');
if (fs.existsSync(localConfigPath)) {
  try {
    fileConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
  } catch (err) {
    console.warn(`[config] Failed to parse config.local.json: ${err.message}`);
  }
}

const env = process.env;

function num(fileValue, envValue, fallback) {
  const v = fileValue ?? envValue;
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = path.resolve(ROOT, fileConfig.dataDir || env.DATA_DIR || './data');

const config = {
  root: ROOT,
  port: num(fileConfig.port, env.PORT, 4100),
  bindHost: fileConfig.bindHost || env.BIND_HOST || '127.0.0.1',
  apiKey: (fileConfig.apiKey || env.API_KEY || '').trim(),

  dataDir,
  dbPath: path.join(dataDir, 'ad-library.db'),

  cacheTtlSeconds: num(fileConfig.cacheTtlSeconds, env.CACHE_TTL_SECONDS, 3600),
  minRequestDelayMs: num(fileConfig.minRequestDelayMs, env.MIN_REQUEST_DELAY_MS, 2000),
  // Adaptive pacing: starts at minRequestDelayMs, may creep down to fastestRequestDelayMs while requests stay
  // clean, snaps back (and cools down) on any rate-limit signal. fastest == min means no speed-up.
  fastestRequestDelayMs: num(fileConfig.fastestRequestDelayMs, env.FASTEST_REQUEST_DELAY_MS, num(fileConfig.minRequestDelayMs, env.MIN_REQUEST_DELAY_MS, 2000)),
  // Hard ceiling per upstream request (headers + body). A healthy request takes ~1.3 s (p95 2.3 s).
  requestTimeoutMs: num(fileConfig.requestTimeoutMs, env.REQUEST_TIMEOUT_MS, 30000),
  // How many cool-downs (5, then 15 min) a single request will wait out after Meta says "Rate limit exceeded".
  rateLimitRetries: num(fileConfig.rateLimitRetries, env.RATE_LIMIT_RETRIES, 2),
  // Soft rolling budget of upstream requests per hour (0 = unlimited). A 16-minute sustained burst of ~490 requests
  // (0.65/s) was rate-limited by Meta on 2026-11-04; 900/h keeps heavy scans from stacking into that pattern.
  maxRequestsPerHour: num(fileConfig.maxRequestsPerHour, env.MAX_REQUESTS_PER_HOUR, 900),
  maxRetries: num(fileConfig.maxRetries, env.MAX_RETRIES, 3),
  backoffBaseMs: num(fileConfig.backoffBaseMs, env.BACKOFF_BASE_MS, 5000),
  sessionTtlSeconds: num(fileConfig.sessionTtlSeconds, env.SESSION_TTL_SECONDS, 1800),
  // Live canary (first page + continuation) cadence; 0 disables the scheduled run.
  canaryIntervalHours: num(fileConfig.canaryIntervalHours, env.CANARY_INTERVAL_HOURS, 6),

  defaultCountry: (fileConfig.defaultCountry || env.DEFAULT_COUNTRY || 'US').toUpperCase(),
  proxyUrl: (fileConfig.proxyUrl || env.HTTPS_PROXY || env.https_proxy || '').trim(),
  userAgent: (fileConfig.userAgent || env.USER_AGENT || '').trim(),
};

module.exports = config;
