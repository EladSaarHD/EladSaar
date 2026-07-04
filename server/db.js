'use strict';

const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

// Ensure the data directory exists before opening the DB file.
fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  -- Known instruments, populated from symbol searches (used for offline-ish
  -- autocomplete and to remember exchange/currency metadata).
  CREATE TABLE IF NOT EXISTS symbols (
    symbol    TEXT PRIMARY KEY,
    name      TEXT,
    exchange  TEXT,
    mic_code  TEXT,
    type      TEXT,
    currency  TEXT,
    country   TEXT
  );

  -- Read-through cache for upstream API responses. One row per (kind,key).
  -- kind ∈ 'quote' | 'candles:<interval>' | 'company' | 'search'
  CREATE TABLE IF NOT EXISTS api_cache (
    kind       TEXT NOT NULL,
    key        TEXT NOT NULL,
    json       TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,   -- epoch ms
    PRIMARY KEY (kind, key)
  );

  -- The user's watchlist. position keeps a stable manual order.
  CREATE TABLE IF NOT EXISTS watchlist (
    symbol    TEXT PRIMARY KEY,
    name      TEXT,
    added_at  TEXT NOT NULL DEFAULT (datetime('now')),
    position  INTEGER NOT NULL DEFAULT 0
  );
`);

module.exports = db;
