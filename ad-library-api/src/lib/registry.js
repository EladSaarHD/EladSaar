'use strict';

// Cross-scan ad registry. `scan_ads` holds a full copy of an ad for every scan that saw it;
// this keeps ONE row per distinct ad (first/last sighting, liveness, scale) so the questions that
// only make sense across days can be asked: what is new, what has run longest, who is scaling.
const db = require('../db');

const upsertStmt = db.prepare(`INSERT INTO ad_registry
  (ad_archive_id,page_id,page_name,domain,link_url,start_date,end_date,is_active,first_seen,last_seen,
   last_active_seen,seen_scans,max_variants,scale_score,first_scan_id,last_scan_id)
  VALUES (@ad_archive_id,@page_id,@page_name,@domain,@link_url,@start_date,@end_date,@is_active,@now,@now,
   @last_active_seen,1,@variants,@scale_score,@scan_id,@scan_id)
  ON CONFLICT(ad_archive_id) DO UPDATE SET
   page_id=COALESCE(excluded.page_id, ad_registry.page_id),
   page_name=COALESCE(excluded.page_name, ad_registry.page_name),
   domain=COALESCE(excluded.domain, ad_registry.domain),
   link_url=COALESCE(excluded.link_url, ad_registry.link_url),
   start_date=COALESCE(excluded.start_date, ad_registry.start_date),
   end_date=excluded.end_date,
   is_active=COALESCE(excluded.is_active, ad_registry.is_active),
   last_seen=excluded.last_seen,
   last_active_seen=COALESCE(excluded.last_active_seen, ad_registry.last_active_seen),
   seen_scans=CASE WHEN ad_registry.last_scan_id = excluded.last_scan_id
                   THEN ad_registry.seen_scans ELSE ad_registry.seen_scans + 1 END,
   max_variants=MAX(COALESCE(ad_registry.max_variants, 0), COALESCE(excluded.max_variants, 0)),
   scale_score=excluded.scale_score,
   last_scan_id=excluded.last_scan_id`);

function recordSighting(scanId, ad, { domain = null, scale = { score: 0, variants: 1 }, now = Date.now() } = {}) {
  if (!ad?.ad_archive_id) return;
  upsertStmt.run({
    ad_archive_id: ad.ad_archive_id,
    page_id: ad.page_id ?? null,
    page_name: ad.page_name ?? null,
    domain,
    link_url: ad.creative?.link_url ?? null,
    start_date: ad.start_date ?? null,
    end_date: ad.end_date ?? null,
    is_active: ad.is_active == null ? null : Number(ad.is_active),
    now,
    last_active_seen: ad.is_active ? now : null,
    variants: scale.variants ?? 1,
    scale_score: scale.score ?? 0,
    scan_id: scanId,
  });
}

function clampLimit(value, fallback = 100) {
  return Math.max(1, Math.min(Number(value) || fallback, 500));
}

function buildFilters(options) {
  const clauses = ['1=1'];
  const args = [];
  if (options.sinceDays) {
    clauses.push('r.first_seen >= ?');
    args.push(Date.now() - Math.max(0, Number(options.sinceDays)) * 86400000);
  }
  if (options.active === '1' || options.active === 1 || options.active === true) clauses.push('r.is_active = 1');
  if (options.active === '0' || options.active === 0) clauses.push('r.is_active = 0');
  if (options.domain) { clauses.push('r.domain = ?'); args.push(String(options.domain).toLowerCase().replace(/^www\./, '')); }
  if (options.pageId) { clauses.push('r.page_id = ?'); args.push(String(options.pageId)); }
  if (options.q) { clauses.push('r.page_name LIKE ?'); args.push(`%${String(options.q).replace(/[%_]/g, '')}%`); }
  if (options.minScale) { clauses.push('r.scale_score >= ?'); args.push(Number(options.minScale) || 0); }
  return { where: clauses.join(' AND '), args };
}

const AD_SORTS = {
  new: 'r.first_seen DESC, r.scale_score DESC',
  scale: 'r.scale_score DESC, r.max_variants DESC',
  longest: 'r.is_active DESC, r.start_date ASC',
  variants: 'r.max_variants DESC, r.scale_score DESC',
  recent: 'r.start_date DESC',
};

function listAds(options = {}) {
  const limit = clampLimit(options.limit);
  const offset = Math.max(0, Number(options.offset) || 0);
  const { where, args } = buildFilters(options);
  const order = AD_SORTS[options.sort] || AD_SORTS.new;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ad_registry r WHERE ${where}`).get(...args).n;
  const rows = db.prepare(`SELECT r.*, s.payload_json FROM ad_registry r
    LEFT JOIN scan_ads s ON s.scan_id = r.last_scan_id AND s.ad_archive_id = r.ad_archive_id
    WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return {
    total, limit, offset,
    ads: rows.map((row) => {
      const { payload_json: payload, ...meta } = row;
      const ad = payload ? JSON.parse(payload) : {
        ad_archive_id: meta.ad_archive_id, page_id: meta.page_id, page_name: meta.page_name,
        start_date: meta.start_date, end_date: meta.end_date, is_active: Boolean(meta.is_active),
        creative: { link_url: meta.link_url },
      };
      return { ...ad, registry: {
        first_seen: meta.first_seen, last_seen: meta.last_seen, last_active_seen: meta.last_active_seen,
        seen_scans: meta.seen_scans, max_variants: meta.max_variants, domain: meta.domain,
      } };
    }),
  };
}

const ADVERTISER_SORTS = {
  ads: 'ads DESC, variants DESC',
  variants: 'variants DESC, ads DESC',
  scale: 'top_scale DESC, ads DESC',
  recent: 'first_seen DESC',
};

function listAdvertisers(options = {}) {
  const limit = clampLimit(options.limit);
  const offset = Math.max(0, Number(options.offset) || 0);
  const { where, args } = buildFilters(options);
  const order = ADVERTISER_SORTS[options.sort] || ADVERTISER_SORTS.ads;
  const rows = db.prepare(`SELECT r.page_id, MAX(r.page_name) AS page_name, COUNT(*) AS ads,
      COALESCE(SUM(r.is_active), 0) AS active_ads, SUM(COALESCE(r.max_variants, 1)) AS variants,
      MIN(r.start_date) AS earliest_start, MAX(r.start_date) AS latest_start, MAX(r.scale_score) AS top_scale,
      MIN(r.first_seen) AS first_seen, MAX(r.last_seen) AS last_seen,
      COUNT(DISTINCT r.domain) AS domain_count, group_concat(DISTINCT r.domain) AS domains
    FROM ad_registry r WHERE ${where} AND r.page_id IS NOT NULL
    GROUP BY r.page_id ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { limit, offset, advertisers: rows.map((row) => ({ ...row, domains: row.domains ? row.domains.split(',').slice(0, 8) : [] })) };
}

const DOMAIN_SORTS = {
  ads: 'ads DESC, variants DESC',
  variants: 'variants DESC, ads DESC',
  scale: 'top_scale DESC, ads DESC',
  recent: 'first_seen DESC',
};

function listDomains(options = {}) {
  const limit = clampLimit(options.limit);
  const offset = Math.max(0, Number(options.offset) || 0);
  const { where, args } = buildFilters(options);
  const order = DOMAIN_SORTS[options.sort] || DOMAIN_SORTS.ads;
  const rows = db.prepare(`SELECT r.domain, COUNT(*) AS ads, COALESCE(SUM(r.is_active), 0) AS active_ads,
      SUM(COALESCE(r.max_variants, 1)) AS variants, COUNT(DISTINCT r.page_id) AS pages,
      MIN(r.start_date) AS earliest_start, MAX(r.start_date) AS latest_start, MAX(r.scale_score) AS top_scale,
      MIN(r.first_seen) AS first_seen, MAX(r.last_seen) AS last_seen
    FROM ad_registry r WHERE ${where} AND r.domain IS NOT NULL
    GROUP BY r.domain ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { limit, offset, domains: rows };
}

function stats() {
  const day = 86400000;
  const now = Date.now();
  const row = db.prepare(`SELECT COUNT(*) AS ads, COALESCE(SUM(is_active), 0) AS active_ads,
      COUNT(DISTINCT page_id) AS advertisers, COUNT(DISTINCT domain) AS domains,
      COALESCE(SUM(first_seen >= ?), 0) AS new_24h, COALESCE(SUM(first_seen >= ?), 0) AS new_7d,
      MIN(first_seen) AS tracking_since, MAX(last_seen) AS last_seen
    FROM ad_registry`).get(now - day, now - 7 * day);
  return row;
}

module.exports = { recordSighting, listAds, listAdvertisers, listDomains, stats };
