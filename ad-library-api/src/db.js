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
`);

module.exports = db;
