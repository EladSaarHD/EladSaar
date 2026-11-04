'use strict';

// One compressed payload per distinct ad (the latest version seen), shared by every scan that found it.
// scan_ads keeps only the per-sighting columns; its payload_json column is '' for rows written since the
// storage diet (older rows keep their inline JSON until scripts/migrate-payloads.js converts them).
// A deflated ad payload is ~3 KB instead of ~13 KB, and stored once instead of once per scan.

const zlib = require('zlib');
const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS ad_payloads (
    ad_archive_id TEXT PRIMARY KEY,
    payload BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const upsertStmt = db.prepare(`INSERT INTO ad_payloads (ad_archive_id, payload, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(ad_archive_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`);

function encode(payload) {
  return zlib.deflateSync(Buffer.from(JSON.stringify(payload)), { level: 6 });
}

function decode(blob) {
  return JSON.parse(zlib.inflateSync(blob).toString('utf8'));
}

function save(adArchiveId, payload, now = Date.now()) {
  upsertStmt.run(adArchiveId, encode(payload), now);
}

// Payload for a row that was selected with `LEFT JOIN ad_payloads p ... p.payload AS stored_payload`.
// Inline JSON (rows from before the diet) wins because it is the scan's own snapshot; otherwise the
// shared copy; otherwise an empty object so a damaged row never takes a whole listing down.
function payloadOf(row) {
  if (row.payload_json) return JSON.parse(row.payload_json);
  if (row.stored_payload) return decode(row.stored_payload);
  return {};
}

module.exports = { save, encode, decode, payloadOf };
