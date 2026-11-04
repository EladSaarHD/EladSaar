'use strict';

// Cross-scan ad registry. `scan_ads` holds a full copy of an ad for every scan that saw it;
// this keeps ONE row per distinct ad (first/last sighting, liveness, scale) so the questions that
// only make sense across days can be asked: what is new, what has run longest, who is scaling.
const db = require('../db');

const upsertStmt = db.prepare(`INSERT INTO ad_registry
  (ad_archive_id,page_id,page_name,domain,link_url,start_date,end_date,is_active,first_seen,last_seen,
   last_active_seen,seen_scans,max_variants,scale_score,seed_hit,first_scan_id,last_scan_id)
  VALUES (@ad_archive_id,@page_id,@page_name,@domain,@link_url,@start_date,@end_date,@is_active,@now,@now,
   @last_active_seen,1,@variants,@scale_score,@seed_hit,@scan_id,@scan_id)
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
   seed_hit=MAX(ad_registry.seed_hit, excluded.seed_hit),
   last_scan_id=excluded.last_scan_id`);

function recordSighting(scanId, ad, { domain = null, scale = { score: 0, variants: 1 }, now = Date.now(), seedHit = true } = {}) {
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
    seed_hit: seedHit ? 1 : 0,
    scan_id: scanId,
  });
}

// Destinations that are not storefronts: app stores, marketplaces, social/link hubs.
const NON_STORE_DOMAINS = [
  'play.google.com', 'apps.apple.com', 'itunes.apple.com', 'apple.com', 'google.com', 'amazon.com', 'amazon.co.uk',
  'amazon.de', 'ebay.com', 'etsy.com', 'walmart.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'wa.me',
  'whatsapp.com', 'facebook.com', 'instagram.com', 'linktr.ee', 't.me', 'bit.ly', 'm.me', 'messenger.com', 'forms.gle',
];

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
  // seeds_only: ads found by a term the user typed (drops promo-phrase noise from old scans).
  if (options.seedsOnly === '1' || options.seedsOnly === 1 || options.seedsOnly === true) clauses.push('r.seed_hit = 1');
  // stores_only: destination looks like a storefront (not an app store / marketplace / link hub).
  if (options.storesOnly === '1' || options.storesOnly === 1 || options.storesOnly === true) {
    // match the domain itself AND any subdomain (api.whatsapp.com, m.facebook.com, …)
    clauses.push(`r.domain IS NOT NULL AND ${NON_STORE_DOMAINS.map(() => '(r.domain != ? AND r.domain NOT LIKE ?)').join(' AND ')}`);
    for (const domain of NON_STORE_DOMAINS) args.push(domain, `%.${domain}`);
  }
  // launched_days: start_date within N days (an ad's own launch, not when we first saw it).
  if (options.launchedDays) {
    clauses.push('r.start_date >= ?');
    args.push(new Date(Date.now() - Number(options.launchedDays) * 86400000).toISOString().slice(0, 10));
  }
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
      return { ...ad,
        // Backfilled rows come from older scans whose payload has no scale fields: the registry
        // columns are the source of truth.
        scale_score: meta.scale_score, variant_count: meta.max_variants ?? ad.variant_count ?? null,
        registry: {
        seed_hit: Boolean(meta.seed_hit), first_seen: meta.first_seen, last_seen: meta.last_seen, last_active_seen: meta.last_active_seen,
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

// Daily digest: what is NEW since `hours` ago, restricted to ads the user's own terms found, and to
// ads that actually launched recently (so a brand-new watch term does not flood it with old ads).
function digest({ hours = 24, limit = 15, launchedDays = null } = {}) {
  const windowHours = Math.max(1, Math.min(Number(hours) || 24, 24 * 30));
  const since = Date.now() - windowHours * 3600000;
  const launched = Number(launchedDays) || Math.max(2, Math.ceil(windowHours / 24) + 1);
  const common = { seedsOnly: '1', storesOnly: '1', launchedDays: launched };
  const base = buildFilters({ ...common, sinceDays: windowHours / 24 });
  const top = Math.max(1, Math.min(Number(limit) || 15, 50));
  const counts = db.prepare(`SELECT COUNT(*) AS ads, COUNT(DISTINCT r.domain) AS stores, COUNT(DISTINCT r.page_id) AS advertisers
    FROM ad_registry r WHERE ${base.where}`).get(...base.args);
  const ads = listAds({ ...common, sinceDays: windowHours / 24, sort: 'scale', limit: top }).ads;
  const scope = buildFilters(common);
  const newStores = db.prepare(`SELECT r.domain, COUNT(*) AS ads, SUM(COALESCE(r.max_variants,1)) AS variants,
      MAX(r.scale_score) AS top_scale, MIN(r.first_seen) AS first_seen, MIN(r.start_date) AS earliest_start
    FROM ad_registry r WHERE ${scope.where} GROUP BY r.domain HAVING MIN(r.first_seen) >= ?
    ORDER BY top_scale DESC, variants DESC LIMIT ?`).all(...scope.args, since, top);
  const newAdvertisers = db.prepare(`SELECT r.page_id, MAX(r.page_name) AS page_name, COUNT(*) AS ads,
      SUM(COALESCE(r.max_variants,1)) AS variants, MAX(r.scale_score) AS top_scale, MIN(r.first_seen) AS first_seen
    FROM ad_registry r WHERE ${scope.where} AND r.page_id IS NOT NULL GROUP BY r.page_id HAVING MIN(r.first_seen) >= ?
    ORDER BY top_scale DESC, variants DESC LIMIT ?`).all(...scope.args, since, top);
  return { window_hours: windowHours, launched_within_days: launched, since, counts, top_ads: ads, new_stores: newStores, new_advertisers: newAdvertisers };
}

function digestText(result) {
  const { counts } = result;
  const lines = [`📡 AdSignal — last ${result.window_hours}h`,
    `${counts.ads} new launches tracked · ${counts.stores} stores · ${counts.advertisers} advertisers`];
  if (result.top_ads.length) {
    lines.push('', 'Top by scale:');
    result.top_ads.slice(0, 8).forEach((ad, index) => {
      lines.push(`${index + 1}. ${ad.page_name || 'Unknown'} — ${ad.registry?.domain || 'no store link'} · ×${ad.variant_count || 1} variants · scale ${ad.scale_score} · since ${ad.start_date || '?'}`);
      lines.push(`   ${ad.ad_library_url || `https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`}`);
    });
  }
  if (result.new_stores.length) {
    lines.push('', 'New stores: ' + result.new_stores.slice(0, 8).map((s) => `${s.domain} (×${s.variants})`).join(', '));
  }
  return lines.join('\n');
}

module.exports = { recordSighting, listAds, listAdvertisers, listDomains, stats, digest, digestText, NON_STORE_DOMAINS };
