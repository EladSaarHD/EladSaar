'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

test('database initialization migrates existing scan jobs with a discarded ad counter', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adsignal-window-'));
  const dbPath = path.join(dataDir, 'ad-library.db');
  const legacy = new Database(dbPath);
  legacy.exec(`CREATE TABLE scan_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    config_json TEXT NOT NULL,
    total_shards INTEGER NOT NULL,
    completed_shards INTEGER NOT NULL DEFAULT 0,
    unique_ads INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  legacy.close();

  const result = spawnSync(process.execPath, ['-e', `
    const db = require('./src/db');
    const columns = db.pragma('table_info(scan_jobs)').map((column) => column.name);
    if (!columns.includes('discarded_ads')) process.exit(2);
    const info = db.pragma('table_info(scan_jobs)').find((column) => column.name === 'discarded_ads');
    if (String(info.dflt_value) !== '0') process.exit(3);
  `], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  });

  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
