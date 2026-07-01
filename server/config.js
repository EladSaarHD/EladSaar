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

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

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

// Codex args: default template uses {image} and {prompt} placeholders.
const codexArgs =
  (fileConfig.extractor && fileConfig.extractor.args) ||
  parseList(env.CODEX_ARGS) ||
  ['exec', '--image', '{image}', '{prompt}'];

const config = {
  root: ROOT,
  port: Number(fileConfig.port || env.PORT || 4000),
  dataDir,
  receiptsDir: path.join(dataDir, 'receipts'),
  dbPath: path.join(dataDir, 'wellybox.db'),
  defaultCurrency: fileConfig.defaultCurrency || env.DEFAULT_CURRENCY || 'USD',

  extractor: {
    mode:
      (fileConfig.extractor && fileConfig.extractor.mode) ||
      env.EXTRACTOR ||
      'codex',
    command:
      (fileConfig.extractor && fileConfig.extractor.command) ||
      env.CODEX_COMMAND ||
      'codex',
    args: codexArgs.length ? codexArgs : ['exec', '--image', '{image}', '{prompt}'],
  },

  watchDir: (fileConfig.watchDir || env.WATCH_DIR || '').trim(),

  imap: {
    host: (fileConfig.imap && fileConfig.imap.host) || env.IMAP_HOST || '',
    port: Number((fileConfig.imap && fileConfig.imap.port) || env.IMAP_PORT || 993),
    secure: bool(
      (fileConfig.imap && fileConfig.imap.secure) ?? env.IMAP_SECURE,
      true
    ),
    user: (fileConfig.imap && fileConfig.imap.user) || env.IMAP_USER || '',
    password:
      (fileConfig.imap && fileConfig.imap.password) || env.IMAP_PASSWORD || '',
    mailbox:
      (fileConfig.imap && fileConfig.imap.mailbox) || env.IMAP_MAILBOX || 'INBOX',
    filterSubject:
      (fileConfig.imap && fileConfig.imap.filterSubject) ||
      parseList(env.IMAP_FILTER_SUBJECT),
    pollSeconds: Number(
      (fileConfig.imap && fileConfig.imap.pollSeconds) ||
        env.IMAP_POLL_SECONDS ||
        300
    ),
  },
};

config.imap.enabled = Boolean(config.imap.host && config.imap.user);

module.exports = config;
