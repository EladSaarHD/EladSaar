'use strict';

// Storage diet: move every ad's payload out of scan_ads (stored once per SCAN, ~8x per ad) into the
// shared, compressed ad_payloads table (once per AD), then compact the database file.
//
//   DATA_DIR=/path/to/copy node scripts/migrate-payloads.js --dry-run   # report only
//   node scripts/migrate-payloads.js                                    # run (stop the service first)
//   node scripts/migrate-payloads.js --skip-vacuum                      # leave compaction for later
//
// Safe order: (1) build ad_payloads from the newest inline copy of each ad, (2) VERIFY coverage and a
// random sample byte-for-byte against the originals, (3) only then blank scan_ads.payload_json, in chunks
// so the WAL never balloons, (4) checkpoint + VACUUM + integrity_check. Every phase is idempotent, so an
// interrupted run can simply be started again. Nothing is deleted before step 2 passes.

const fs = require('fs');
const net = require('net');
const db = require('../src/db');
const config = require('../config');
const payloadStore = require('../src/lib/payloadStore');

const dryRun = process.argv.includes('--dry-run');
const skipVacuum = process.argv.includes('--skip-vacuum');
const allowRunning = process.argv.includes('--allow-running');
const SAMPLE = 400;
const log = (message) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
const fileSize = () => ['', '-wal', '-shm'].reduce((sum, ext) => sum + (fs.existsSync(config.dbPath + ext) ? fs.statSync(config.dbPath + ext).size : 0), 0);

function serviceListening() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: config.port, timeout: 800 });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

(async () => {
  if (!dryRun && !allowRunning && await serviceListening()) {
    console.error(`A service is listening on :${config.port}. Stop it first (or pass --allow-running if this is a copy on another port).`);
    process.exit(2);
  }
  const before = fileSize();
  const inlineRows = db.prepare("SELECT COUNT(*) AS n FROM scan_ads WHERE payload_json <> ''").get().n;
  const distinct = db.prepare("SELECT COUNT(DISTINCT ad_archive_id) AS n FROM scan_ads WHERE payload_json <> ''").get().n;
  const inlineBytes = db.prepare("SELECT COALESCE(SUM(LENGTH(payload_json)), 0) AS n FROM scan_ads").get().n;
  log(`database ${mb(before)} | ${inlineRows} rows carry inline payloads (${mb(inlineBytes)}) for ${distinct} distinct ads`);
  if (dryRun) { log('dry run: nothing changed'); process.exit(0); }

  // (1) build the shared copy: the newest inline copy of each ad wins. The winners are chosen up front from
  // the small columns (a connection cannot write while it is still iterating a query), then only those
  // rows' payloads are read and compressed.
  if (inlineRows) {
    const newest = new Map(); // ad_archive_id -> { rowid, last_seen }
    for (const row of db.prepare("SELECT rowid AS rid, ad_archive_id, last_seen FROM scan_ads WHERE payload_json <> '' ORDER BY last_seen ASC, rowid ASC").all()) {
      newest.set(row.ad_archive_id, row);
    }
    const winners = [...newest.entries()];
    const fetch = db.prepare('SELECT payload_json FROM scan_ads WHERE rowid = ?');
    const flush = db.transaction((chunk) => {
      for (const [adId, win] of chunk) payloadStore.save(adId, JSON.parse(fetch.get(win.rid).payload_json), win.last_seen);
    });
    for (let i = 0; i < winners.length; i += 1000) {
      flush(winners.slice(i, i + 1000));
      if ((i / 1000) % 5 === 0) log(`  compressed ${Math.min(i + 1000, winners.length)}/${winners.length} ads`);
    }
    log(`phase 1: ${winners.length} distinct ads folded into ad_payloads (from ${inlineRows} inline rows)`);
  }

  // (2) verify before anything is blanked
  const shared = db.prepare('SELECT COUNT(*) AS n FROM ad_payloads').get().n;
  const missing = db.prepare(`SELECT COUNT(DISTINCT s.ad_archive_id) AS n FROM scan_ads s
    LEFT JOIN ad_payloads p ON p.ad_archive_id = s.ad_archive_id WHERE s.payload_json <> '' AND p.ad_archive_id IS NULL`).get().n;
  if (missing) { console.error(`ABORT: ${missing} ads with an inline payload have no shared copy`); process.exit(3); }
  const ids = db.prepare(`SELECT ad_archive_id FROM scan_ads WHERE payload_json <> '' GROUP BY ad_archive_id ORDER BY RANDOM() LIMIT ${SAMPLE}`).all();
  let mismatches = 0;
  for (const { ad_archive_id: id } of ids) {
    const original = db.prepare("SELECT payload_json FROM scan_ads WHERE ad_archive_id=? AND payload_json <> '' ORDER BY last_seen DESC, rowid DESC LIMIT 1").get(id);
    const stored = db.prepare('SELECT payload FROM ad_payloads WHERE ad_archive_id=?').get(id);
    if (!stored || JSON.stringify(JSON.parse(original.payload_json)) !== JSON.stringify(payloadStore.decode(stored.payload))) mismatches += 1;
  }
  if (mismatches) { console.error(`ABORT: ${mismatches}/${ids.length} sampled payloads differ from the original`); process.exit(4); }
  log(`phase 2: verified — ${shared} shared payloads, 0 missing, ${ids.length}/${ids.length} sampled payloads identical to the original`);

  // (3) blank the inline copies in chunks
  const maxRowid = db.prepare('SELECT COALESCE(MAX(rowid), 0) AS n FROM scan_ads').get().n;
  const blank = db.prepare("UPDATE scan_ads SET payload_json = '' WHERE rowid > ? AND rowid <= ? AND payload_json <> ''");
  let blanked = 0;
  for (let start = 0; start < maxRowid; start += 20000) {
    blanked += blank.run(start, start + 20000).changes;
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
  log(`phase 3: ${blanked} inline payloads blanked`);

  // (4) compact
  if (!skipVacuum) {
    log(`phase 4: VACUUM (file is ${mb(fileSize())} before; needs no extra space beyond the final size)…`);
    db.exec('VACUUM');
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
  const integrity = db.pragma('integrity_check', { simple: true });
  const after = fileSize();
  log(`integrity_check: ${integrity}`);
  log(`done: ${mb(before)} -> ${mb(after)} (${((1 - after / before) * 100).toFixed(0)}% smaller)`);
  db.close();
  process.exit(integrity === 'ok' ? 0 : 5);
})();
