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
  maxRetries: num(fileConfig.maxRetries, env.MAX_RETRIES, 3),
  backoffBaseMs: num(fileConfig.backoffBaseMs, env.BACKOFF_BASE_MS, 5000),
  sessionTtlSeconds: num(fileConfig.sessionTtlSeconds, env.SESSION_TTL_SECONDS, 1800),

  defaultCountry: (fileConfig.defaultCountry || env.DEFAULT_COUNTRY || 'US').toUpperCase(),
  proxyUrl: (fileConfig.proxyUrl || env.HTTPS_PROXY || env.https_proxy || '').trim(),
  userAgent: (fileConfig.userAgent || env.USER_AGENT || '').trim(),
};

module.exports = config;
