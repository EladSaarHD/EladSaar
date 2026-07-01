'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

// Ensure data directories exist before opening the DB file.
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.receiptsDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS receipts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    vendor            TEXT,
    receipt_date      TEXT,
    total_amount      REAL,
    currency          TEXT,
    tax_amount        REAL,
    tax_rate          REAL,
    category          TEXT,
    payment_method    TEXT,
    notes             TEXT,
    source            TEXT NOT NULL DEFAULT 'upload',
    original_filename TEXT,
    stored_path       TEXT,
    mime_type         TEXT,
    file_hash         TEXT UNIQUE,
    status            TEXT NOT NULL DEFAULT 'pending',
    extractor         TEXT,
    raw_extraction    TEXT,
    email_message_id  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(receipt_date);
  CREATE INDEX IF NOT EXISTS idx_receipts_category ON receipts(category);
  CREATE INDEX IF NOT EXISTS idx_receipts_vendor ON receipts(vendor);

  CREATE TABLE IF NOT EXISTS rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_field TEXT NOT NULL DEFAULT 'vendor',
    pattern     TEXT NOT NULL,
    category    TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

module.exports = db;
