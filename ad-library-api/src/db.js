'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

// Ensure the data directory exists before opening the database.
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS response_cache (
    key         TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    params_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_response_cache_expires
    ON response_cache (expires_at);

  CREATE TABLE IF NOT EXISTS scan_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    config_json TEXT NOT NULL,
    total_shards INTEGER NOT NULL,
    completed_shards INTEGER NOT NULL DEFAULT 0,
    unique_ads INTEGER NOT NULL DEFAULT 0,
    discarded_ads INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scan_ads (
    scan_id TEXT NOT NULL,
    ad_archive_id TEXT NOT NULL,
    page_id TEXT,
    page_name TEXT,
    start_date TEXT,
    is_active INTEGER,
    impressions_upper INTEGER,
    momentum_score INTEGER NOT NULL DEFAULT 0,
    dropship_score INTEGER NOT NULL DEFAULT 0,
    signals_json TEXT NOT NULL,
    matched_queries_json TEXT NOT NULL,
    countries_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    PRIMARY KEY (scan_id, ad_archive_id),
    FOREIGN KEY (scan_id) REFERENCES scan_jobs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_scan_ads_momentum ON scan_ads(scan_id, momentum_score DESC);
  CREATE INDEX IF NOT EXISTS idx_scan_ads_dropship ON scan_ads(scan_id, dropship_score DESC);
  CREATE INDEX IF NOT EXISTS idx_scan_ads_impressions ON scan_ads(scan_id, impressions_upper DESC);
  CREATE INDEX IF NOT EXISTS idx_scan_ads_recent ON scan_ads(scan_id, start_date DESC);
`);

const scanJobColumns = new Set(db.pragma('table_info(scan_jobs)').map((column) => column.name));
if (!scanJobColumns.has('discarded_ads')) {
  db.exec('ALTER TABLE scan_jobs ADD COLUMN discarded_ads INTEGER NOT NULL DEFAULT 0');
}

module.exports = db;
