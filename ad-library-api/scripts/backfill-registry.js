'use strict';

// One-time backfill of ad_registry from historical scan_ads rows.
//
//   node scripts/backfill-registry.js            # fails if the registry already has rows
//   node scripts/backfill-registry.js --force    # clears the registry first, then rebuilds
//   DATA_DIR=/path/to/copy node scripts/backfill-registry.js   # run against a copy
//
// Streams scan_ads once (json_extract keeps parsing inside SQLite), aggregates per distinct
// ad in memory, then writes in a single transaction.

const db = require('../src/db');
const { extractStoreDomain, scoreScale } = require('../src/lib/deepScan');
const payloadStore = require('../src/lib/payloadStore');

const force = process.argv.includes('--force');
const existing = db.prepare('SELECT COUNT(*) AS n FROM ad_registry').get().n;
if (existing && !force) {
  console.error(`ad_registry already has ${existing} rows. Re-run with --force to clear and rebuild.`);
  process.exit(2);
}

const started = Date.now();
// scan id -> the terms the USER typed (so promo/modifier-only hits are not counted as seed hits)
const seedsByScan = new Map(db.prepare('SELECT id, config_json FROM scan_jobs').all().map((job) => {
  const config = JSON.parse(job.config_json);
  return [job.id, new Set([...(config.queries || []), ...((config.pageIds || []).map((id) => `page:${id}`))])];
}));
// Per-sighting columns only (no payload parsing); payload-derived fields are read once per distinct ad below.
const rows = db.prepare(`SELECT scan_id, ad_archive_id, page_id, page_name, start_date, is_active, first_seen, last_seen,
    variant_count, matched_queries_json FROM scan_ads`).iterate();
const payloadFor = db.prepare(`SELECT s.payload_json, p.payload AS stored_payload FROM scan_ads s
  LEFT JOIN ad_payloads p ON p.ad_archive_id = s.ad_archive_id WHERE s.scan_id = ? AND s.ad_archive_id = ?`);

const ads = new Map();
const scansSeen = new Map();
let scanned = 0;
for (const row of rows) {
  scanned += 1;
  let ad = ads.get(row.ad_archive_id);
  if (!ad) {
    ad = { ad_archive_id: row.ad_archive_id, first_seen: row.first_seen, last_seen: 0, last_active_seen: null, scans: new Set(),
      max_variants: null, newest: null, seed_hit: 0 };
    ads.set(row.ad_archive_id, ad);
  }
  ad.first_seen = Math.min(ad.first_seen, row.first_seen);
  ad.scans.add(row.scan_id);
  if (!ad.seed_hit) {
    const seeds = seedsByScan.get(row.scan_id);
    if (seeds && JSON.parse(row.matched_queries_json).some((query) => seeds.has(query))) ad.seed_hit = 1;
  }
  if (row.is_active === 1) ad.last_active_seen = Math.max(ad.last_active_seen || 0, row.last_seen);
  if (row.variant_count != null) ad.max_variants = Math.max(ad.max_variants || 0, Number(row.variant_count) || 0);
  if (row.last_seen >= ad.last_seen) {
    ad.last_seen = row.last_seen;
    ad.newest = row;
  }
}

const insert = db.prepare(`INSERT INTO ad_registry
  (ad_archive_id,page_id,page_name,domain,link_url,start_date,end_date,is_active,first_seen,last_seen,
   last_active_seen,seen_scans,max_variants,scale_score,seed_hit,first_scan_id,last_scan_id)
  VALUES (@ad_archive_id,@page_id,@page_name,@domain,@link_url,@start_date,@end_date,@is_active,@first_seen,@last_seen,
   @last_active_seen,@seen_scans,@max_variants,@scale_score,@seed_hit,@first_scan_id,@last_scan_id)`);

const write = db.transaction(() => {
  if (force) db.prepare('DELETE FROM ad_registry').run();
  for (const ad of ads.values()) {
    const n = ad.newest;
    const stored = payloadStore.payloadOf(payloadFor.get(n.scan_id, ad.ad_archive_id) || {});
    n.end_date = stored.end_date || null;
    const linkUrl = stored.creative?.link_url || stored.creative?.cards?.[0]?.link_url || null;
    const shape = { start_date: n.start_date, end_date: n.end_date, is_active: n.is_active === 1,
      collation_count: ad.max_variants || stored.collation_count || null,
      publisher_platforms: new Array((stored.publisher_platforms || []).length) };
    insert.run({
      ad_archive_id: ad.ad_archive_id, page_id: n.page_id, page_name: n.page_name,
      domain: extractStoreDomain({ creative: { link_url: linkUrl } }), link_url: linkUrl,
      start_date: n.start_date, end_date: n.end_date, is_active: n.is_active,
      first_seen: ad.first_seen, last_seen: ad.last_seen, last_active_seen: ad.last_active_seen,
      seen_scans: ad.scans.size, max_variants: ad.max_variants || stored.collation_count || null, scale_score: scoreScale(shape).score, seed_hit: ad.seed_hit,
      first_scan_id: n.scan_id, last_scan_id: n.scan_id,
    });
  }
});
write();

const total = db.prepare('SELECT COUNT(*) AS n FROM ad_registry').get().n;
console.log(JSON.stringify({ scan_rows_read: scanned, distinct_ads: ads.size, registry_rows: total, seed_hits: db.prepare('SELECT COUNT(*) AS n FROM ad_registry WHERE seed_hit=1').get().n, seconds: Math.round((Date.now() - started) / 100) / 10 }));
db.close();
