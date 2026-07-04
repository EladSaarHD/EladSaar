'use strict';

const fs = require('fs');
const path = require('path');

// Load .env (if present) without requiring dotenv to exist at first run.
try {
  require('dotenv').config();
} catch {
  /* dotenv not installed yet — env still works, just no .env file parsing */
}

const ROOT = path.resolve(__dirname, '..');

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

const dataDir = path.resolve(
  ROOT,
  fileConfig.dataDir || env.DATA_DIR || './data'
);

const providerCfg = fileConfig.provider || {};

const config = {
  root: ROOT,
  port: Number(fileConfig.port || env.PORT || 4000),
  dataDir,
  dbPath: path.join(dataDir, 'tradeview.db'),

  provider: {
    // Which market-data adapter to use. Currently: 'twelvedata'.
    name: providerCfg.name || env.PROVIDER || 'twelvedata',
    // Free API key — get one at https://twelvedata.com/pricing (Basic/free tier).
    apiKey: providerCfg.apiKey || env.TWELVEDATA_API_KEY || '',
    // Free tier is 8 requests/min. The throttle keeps us just under it.
    requestsPerMinute: Number(
      providerCfg.requestsPerMinute || env.PROVIDER_RPM || 8
    ),
  },
};

module.exports = config;
