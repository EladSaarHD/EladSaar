'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adsignal-engine-'));
process.env.DATA_DIR = dataDir;

// Scripted stand-in for the Meta-facing pipeline. Each test installs `script(params, variables)`.
let script = null;
const calls = [];
const listQueryPath = require.resolve('../src/lib/listQuery');
require.cache[listQueryPath] = {
  id: listQueryPath, filename: listQueryPath, loaded: true,
  exports: {
    runListQuery: async ({ cacheParams, variables }) => {
      calls.push({ params: cacheParams, variables });
      return script(cacheParams, variables);
    },
  },
};

const db = require('../src/db');
const service = require('../src/lib/deepScanService');
const registry = require('../src/lib/registry');

const SHARD = { query: 'posture corrector', country: 'US', startDate: '2026-10-01', endDate: '2026-11-30' };
const FAST = { requestPauseMs: 0, pagePauseMs: 0, initialRetryPauseMs: 0, continuationRetryPauseMs: 0 };

function makeAd(id, overrides = {}) {
  const bucket = Number(String(id).replace(/\D/g, '')) % 3; // three advertisers / three stores
  return {
    ad_archive_id: String(id), page_id: `p${bucket}`, page_name: `Page ${bucket}`, start_date: '2026-10-15', is_active: true,
    publisher_platforms: ['FACEBOOK'], collation_count: 1, creative: { link_url: `https://shop${bucket}.example/products/x` }, ...overrides,
  };
}

function newJob(config, shards = [SHARD]) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO scan_jobs (id,status,config_json,total_shards,completed_shards,unique_ads,discarded_ads,created_at,updated_at)
    VALUES (?, 'queued', ?, ?, 0, 0, 0, ?, ?)`).run(id, JSON.stringify(config), shards.length, now, now);
  return id;
}

// Pages of ads: page 1 = 30 ads (server-rendered), continuation pages = 10 ads, like Meta.
function pagedScript(totalAds, { makeOne = makeAd } = {}) {
  return (params) => {
    const pageIndex = params.cursor ? Number(params.cursor.split('-')[1]) : 0;
    const start = pageIndex === 0 ? 0 : 30 + (pageIndex - 1) * 10;
    const size = pageIndex === 0 ? 30 : 10;
    const ads = [];
    for (let i = start; i < Math.min(start + size, totalAds); i += 1) ads.push(makeOne(i));
    const hasNext = start + size < totalAds;
    return { ads, page_info: { has_next_page: hasNext, end_cursor: hasNext ? `c-${pageIndex + 1}` : null }, count: totalAds };
  };
}

test('runScan follows continuation pages to the target and records Meta rank + scale', async () => {
  calls.length = 0;
  script = pagedScript(200);
  const config = { targetAds: 70, lookbackDays: 90, activeStatus: 'active', sort: 'impressions', ...FAST };
  const id = newJob(config);
  await service.runScan(id, [SHARD], config);

  const job = service.getJob(id);
  assert.strictEqual(job.status, 'complete');
  assert.strictEqual(job.unique_ads, 70, 'page1(30)+4 continuation pages(40)');
  assert.strictEqual(calls.length, 5);
  assert.deepStrictEqual(calls.map((c) => c.params.cursor ?? null), [null, 'c-1', 'c-2', 'c-3', 'c-4']);

  const byRank = service.listAds(id, { sort: 'rank', limit: 500 }).ads;
  assert.deepStrictEqual(byRank.slice(0, 3).map((a) => a.meta_rank), [0, 1, 2]);
  assert.strictEqual(byRank[69].meta_rank, 69);
  // For an impressions-ordered scan the stored rank IS the impression ranking.
  const byImpressions = service.listAds(id, { sort: 'impressions', limit: 5 }).ads;
  assert.deepStrictEqual(byImpressions.map((a) => a.ad_archive_id), ['0', '1', '2', '3', '4']);
});

test('the page budget scales with the target instead of the old hard cap of 3 pages', async () => {
  calls.length = 0;
  script = pagedScript(1000);
  const config = { targetAds: 300, lookbackDays: 90, activeStatus: 'active', sort: 'impressions', ...FAST };
  const id = newJob(config);
  await service.runScan(id, [SHARD], config);
  assert.strictEqual(service.getJob(id).unique_ads, 300);
  assert.ok(calls.length > 3, `expected more than 3 requests, made ${calls.length}`);
  assert.strictEqual(calls.length, 28, '1 first page + 27 continuations');
});

test('a long single-shard scan reports live progress instead of sitting at 0% until the shard ends', async () => {
  const observed = [];
  let jobId = null;
  const inner = pagedScript(100);
  script = (params, variables) => {
    if (params.cursor === 'c-3') observed.push(service.getJob(jobId));
    return inner(params, variables);
  };
  const config = { targetAds: 100, lookbackDays: 90, activeStatus: 'active', sort: 'impressions', heartbeatMs: 0, ...FAST };
  jobId = newJob(config);
  await service.runScan(jobId, [SHARD], config);
  const midway = observed[0];
  assert.strictEqual(midway.status, 'running');
  assert.ok(midway.unique_ads >= 50, `heartbeat should have recorded collected ads, saw ${midway.unique_ads}`);
  assert.ok(midway.progress > 0 && midway.progress < 100, `progress ${midway.progress}`);
  assert.strictEqual(midway.completed_shards, 0, 'shard not finished yet');
  const done = service.getJob(jobId);
  assert.strictEqual(done.status, 'complete');
  assert.strictEqual(done.progress, 100);
});

test('exact-phrase shards run as keyword_exact_phrase and carry the scan sort mode to Meta', async () => {
  calls.length = 0;
  script = pagedScript(5);
  const config = { targetAds: 30, lookbackDays: 90, activeStatus: 'active', sort: 'recent', ...FAST };
  const id = newJob(config);
  await service.runScan(id, [{ ...SHARD, searchType: 'keyword_exact_phrase' }], config);
  assert.strictEqual(calls[0].variables.searchType, 'keyword_exact_phrase');
  assert.strictEqual(calls[0].variables.sortData.mode, 'SORT_BY_RELEVANCY_MONTHLY_GROUPED');
  calls.length = 0;
  const id2 = newJob(config);
  await service.runScan(id2, [SHARD], { ...config, sort: 'impressions' });
  assert.strictEqual(calls[0].variables.searchType, 'keyword_unordered');
  assert.strictEqual(calls[0].variables.sortData.mode, 'SORT_BY_TOTAL_IMPRESSIONS');
});

test('a recent-sorted launch-window scan stops once pages are entirely older than the window', async () => {
  calls.length = 0;
  const old = { start_date: '2026-06-01' };
  script = (params) => {
    const page = params.cursor ? Number(params.cursor.split('-')[1]) : 0;
    const ads = page === 0 ? [makeAd(1), makeAd(2)] : [makeAd(100 + page * 2, old), makeAd(101 + page * 2, old)];
    return { ads, page_info: { has_next_page: true, end_cursor: `c-${page + 1}` }, count: 9999 };
  };
  const config = { targetAds: 500, lookbackDays: 30, activeStatus: 'active', sort: 'recent', ...FAST };
  const id = newJob(config);
  const shard = { ...SHARD, startDate: '2026-10-06', endDate: '2026-11-04' };
  await service.runScan(id, [shard], config);
  assert.strictEqual(calls.length, 3, 'in-window page + two all-older pages, then stop');
  const job = service.getJob(id);
  assert.strictEqual(job.unique_ads, 2);
  assert.match(job.error, /stopped early after paging past the 30-day launch window/);
});

test('an expansion shard that only returns already-collected ads is abandoned, not paged to the end', async () => {
  calls.length = 0;
  // Seed shard collects 40 ads; the modifier shard then keeps returning those same ads.
  script = (params, variables) => {
    if (variables.queryString === 'posture corrector') return pagedScript(40)(params);
    const page = params.cursor ? Number(params.cursor.split('-')[1]) : 0;
    return { ads: Array.from({ length: 10 }, (_, i) => makeAd(i)), page_info: { has_next_page: true, end_cursor: `c-${page + 1}` }, count: 500 };
  };
  const config = { targetAds: 500, lookbackDays: 90, activeStatus: 'active', sort: 'impressions', ...FAST };
  const shards = [SHARD, { ...SHARD, query: 'buy posture corrector', origin: 'modifier' }];
  const id = newJob(config, shards);
  await service.runScan(id, shards, config);
  const modifierCalls = calls.filter((c) => c.variables.queryString === 'buy posture corrector').length;
  assert.strictEqual(modifierCalls, 3, 'stops after 3 pages with no new ads');
  const job = service.getJob(id);
  assert.strictEqual(job.unique_ads, 40);
  assert.match(job.error, /1 expansion shard\(s\) stopped early/);
});

test('listAds supports scale / variants sorting and a minimum-scale filter; seed matches are flagged', async () => {
  script = pagedScript(30, { makeOne: (i) => makeAd(i, { collation_count: i === 7 ? 25 : 1, start_date: i === 7 ? '2026-10-02' : '2026-11-02' }) });
  const config = { targetAds: 30, queries: ['posture corrector'], lookbackDays: 90, activeStatus: 'active', sort: 'impressions', ...FAST };
  const id = newJob(config);
  await service.runScan(id, [SHARD], config);
  const top = service.listAds(id, { sort: 'scale', limit: 3 });
  assert.strictEqual(top.ads[0].ad_archive_id, '7', 'the 25-variant, month-old ad outranks fresh single ads');
  assert.strictEqual(top.ads[0].variant_count, 25);
  assert.ok(top.ads[0].scale_score > top.ads[1].scale_score);
  assert.strictEqual(top.ads[0].matched_seed, true);
  const filtered = service.listAds(id, { sort: 'scale', scaleMin: top.ads[0].scale_score });
  assert.ok(filtered.total >= 1 && filtered.total < 30);
  assert.strictEqual(service.listAds(id, { sort: 'variants', limit: 1 }).ads[0].ad_archive_id, '7');
});

test('the registry tracks each distinct ad across scans: first/last seen, scans seen, best variants', async () => {
  script = pagedScript(12, { makeOne: (i) => makeAd(`R${i}`, { collation_count: 3 }) });
  const config = { targetAds: 30, lookbackDays: 90, activeStatus: 'active', sort: 'impressions', ...FAST };
  const first = newJob(config);
  await service.runScan(first, [SHARD], config);
  const before = db.prepare("SELECT * FROM ad_registry WHERE ad_archive_id='RR0' OR ad_archive_id='R0'").get();
  assert.ok(before, 'registry row created');
  assert.strictEqual(before.seen_scans, 1);

  await new Promise((resolve) => setTimeout(resolve, 15));
  script = pagedScript(12, { makeOne: (i) => makeAd(`R${i}`, { collation_count: i === 0 ? 9 : 3 }) });
  const second = newJob(config);
  await service.runScan(second, [SHARD], config);
  const after = db.prepare("SELECT * FROM ad_registry WHERE ad_archive_id='R0'").get();
  assert.strictEqual(after.seen_scans, 2);
  assert.strictEqual(after.first_seen, before.first_seen, 'first_seen is never moved');
  assert.ok(after.last_seen > before.last_seen);
  assert.strictEqual(after.max_variants, 9);
  assert.strictEqual(after.first_scan_id, first);
  assert.strictEqual(after.last_scan_id, second);
  assert.match(after.domain, /^shop\d\.example$/);
  // Re-saving within one scan must not inflate seen_scans.
  assert.strictEqual(db.prepare("SELECT seen_scans FROM ad_registry WHERE ad_archive_id='R1'").get().seen_scans, 2);
});

test('registry queries: new-since, advertiser and domain roll-ups, filters', async () => {
  const stats = registry.stats();
  assert.ok(stats.ads >= 12 && stats.new_24h >= 12);

  const fresh = registry.listAds({ sort: 'new', sinceDays: 1, limit: 500 });
  assert.ok(fresh.total >= 12);
  assert.ok(fresh.ads[0].registry.first_seen >= fresh.ads[fresh.ads.length - 1].registry.first_seen);
  // Backdate one ad's first sighting: a 7-day "new" window must exclude it, a 60-day one include it.
  db.prepare("UPDATE ad_registry SET first_seen = ? WHERE ad_archive_id = 'R3'").run(Date.now() - 30 * 86400000);
  const inLastWeek = registry.listAds({ sinceDays: 7, limit: 500 }).ads.map((ad) => ad.ad_archive_id);
  const inLastTwoMonths = registry.listAds({ sinceDays: 60, limit: 500 }).ads.map((ad) => ad.ad_archive_id);
  assert.ok(!inLastWeek.includes('R3'));
  assert.ok(inLastTwoMonths.includes('R3'));

  const byScale = registry.listAds({ sort: 'scale', limit: 1 }).ads[0];
  assert.strictEqual(byScale.variant_count !== undefined, true);

  const longest = registry.listAds({ sort: 'longest', active: '1', limit: 3 }).ads;
  assert.ok(longest.every((ad) => ad.is_active));
  assert.ok(longest[0].start_date <= longest[longest.length - 1].start_date);

  const advertisers = registry.listAdvertisers({ sort: 'ads', limit: 10 }).advertisers;
  assert.ok(advertisers.length >= 3);
  assert.ok(advertisers[0].ads >= advertisers[advertisers.length - 1].ads);
  assert.ok(advertisers[0].domains.length >= 1);

  const domains = registry.listDomains({ sort: 'variants', limit: 10 }).domains;
  assert.ok(domains.every((d) => /\.example$/.test(d.domain)));
  assert.strictEqual(registry.listAds({ domain: 'www.SHOP1.example', limit: 500 }).ads.every((ad) => ad.registry.domain === 'shop1.example'), true);
});

test('createScan: seeds-only by default, quoted terms become exact phrases, bad options are rejected', async () => {
  calls.length = 0;
  script = () => ({ ads: [], page_info: { has_next_page: false, end_cursor: null }, count: 0 });
  const job = service.createScan({ queries: '"posture corrector" | back brace', lookbackDays: 30, targetAds: 30 });
  assert.deepStrictEqual(job.config.queries, ['posture corrector', 'back brace']);
  assert.deepStrictEqual(job.config.exactTerms, ['posture corrector']);
  assert.strictEqual(job.config.expansion, 'none');
  assert.strictEqual(job.config.sort, 'impressions');
  assert.deepStrictEqual(job.config.expandedQueries, ['posture corrector', 'back brace']);
  assert.strictEqual(job.config.queryExpression, '"posture corrector" | back brace');
  assert.strictEqual(job.total_shards, 2);

  // wait for the (empty) scan to finish before starting the next one
  for (let i = 0; i < 100 && ['queued', 'running'].includes(service.getJob(job.id).status); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.strictEqual(service.getJob(job.id).status, 'complete');
  const byQuery = Object.fromEntries(calls.map((c) => [c.variables.queryString, c.variables.searchType]));
  assert.strictEqual(byQuery['posture corrector'], 'keyword_exact_phrase');
  assert.strictEqual(byQuery['back brace'], 'keyword_unordered');

  assert.throws(() => service.createScan({ queries: 'x', lookbackDays: 30, sort: 'bogus' }), /Invalid sort/);
  assert.throws(() => service.createScan({ queries: 'x', lookbackDays: 30, expansion: 'everything' }), /Invalid expansion/);
  assert.throws(() => service.createScan({ queries: 'x', lookbackDays: 31 }), /Launch window/);
});

test('createScan: a dropshipping store-finder with no terms still runs the discovery phrases', async () => {
  const job = service.createScan({ mode: 'dropshipping', queries: [], lookbackDays: 7, targetAds: 30 });
  assert.strictEqual(job.config.expansion, 'discovery');
  assert.ok(job.config.expandedQueries.includes('free worldwide shipping'));
  for (let i = 0; i < 300 && ['queued', 'running'].includes(service.getJob(job.id).status); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});


test('registry separates ads found by the user\'s own terms from expansion-only hits; storefront filter drops app stores', async () => {
  script = (params, variables) => {
    const ads = variables.queryString === 'seed term'
      ? [makeAd('S1'), makeAd('S2')]
      : [makeAd('M1'), makeAd('M2', { creative: { link_url: 'https://play.google.com/store/apps/details?id=x' } })];
    return { ads, page_info: { has_next_page: false, end_cursor: null }, count: ads.length };
  };
  const config = { targetAds: 500, queries: ['seed term'], lookbackDays: 90, activeStatus: 'active', sort: 'impressions', ...FAST };
  const shards = [{ ...SHARD, query: 'seed term' }, { ...SHARD, query: 'buy seed term', origin: 'modifier' }];
  const id = newJob(config, shards);
  await service.runScan(id, shards, config);
  const seedOnly = registry.listAds({ seedsOnly: '1', limit: 500 }).ads.map((ad) => ad.ad_archive_id);
  assert.ok(seedOnly.includes('S1') && seedOnly.includes('S2'));
  assert.ok(!seedOnly.includes('M1') && !seedOnly.includes('M2'), 'modifier-only hits are not seed hits');
  const stores = registry.listDomains({ storesOnly: '1', limit: 500 }).domains.map((d) => d.domain);
  assert.ok(!stores.includes('play.google.com'));
  assert.ok(!stores.some((d) => /(^|\.)whatsapp\.com$/.test(d)), 'subdomains of non-store hosts are excluded too');
  assert.ok(registry.listDomains({ limit: 500 }).domains.some((d) => d.domain === 'play.google.com'));
  // backfilled rows have no scale in their old payload: the registry column wins
  const top = registry.listAds({ sort: 'scale', limit: 1 }).ads[0];
  assert.strictEqual(typeof top.scale_score, 'number');
});

test('an advertiser sweep collects every ad from the page, ignoring the launch window', async () => {
  calls.length = 0;
  script = pagedScript(25, { makeOne: (i) => makeAd(`P${i}`, { start_date: i % 2 ? '2025-01-05' : '2026-10-20' }) });
  const config = { targetAds: 100, queries: [], pageIds: ['123456789'], lookbackDays: 30, activeStatus: 'active', sort: 'impressions', ...FAST };
  const shard = { query: '', pageId: '123456789', searchType: 'page', startDate: '2026-10-06', endDate: '2026-11-04' };
  const id = newJob(config, [shard]);
  await service.runScan(id, [shard], config);
  assert.strictEqual(calls[0].variables.searchType, 'page');
  assert.strictEqual(calls[0].variables.viewAllPageID, '123456789');
  const job = service.getJob(id);
  assert.strictEqual(job.unique_ads, 25, 'old (2025) ads are kept: a sweep is not window-limited');
  assert.strictEqual(job.discarded_ads, 0);
  const ads = service.listAds(id, { limit: 5 }).ads;
  assert.ok(ads.every((ad) => ad.matched_seed === true && ad.matched_queries[0] === 'page:123456789'));
});

test('createScan accepts pageIds (sweep) and rejects junk ids', async () => {
  script = () => ({ ads: [], page_info: { has_next_page: false, end_cursor: null }, count: 0 });
  const job = service.createScan({ pageIds: ['111111111', 'not-an-id', '222222222'], lookbackDays: 30, targetAds: 30 });
  assert.deepStrictEqual(job.config.pageIds, ['111111111', '222222222']);
  assert.strictEqual(job.total_shards, 2);
  assert.strictEqual(job.config.queryExpression, 'page:111111111 | page:222222222');
  for (let i = 0; i < 100 && ['queued', 'running'].includes(service.getJob(job.id).status); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.throws(() => service.createScan({ pageIds: ['abc'], queries: [], lookbackDays: 30 }), /At least one query/);
});

test('digest lists new launches from the user\'s own terms, new stores and advertisers, with a text form', async () => {
  const day = new Date().toISOString().slice(0, 10);
  script = pagedScript(6, { makeOne: (i) => makeAd(`D${i}`, { start_date: day, collation_count: 4 + i, creative: { link_url: `https://digest${i % 2}.example/products/p` } }) });
  const config = { targetAds: 30, queries: ['digest term'], lookbackDays: 90, activeStatus: 'active', sort: 'impressions', ...FAST };
  const shard = { ...SHARD, query: 'digest term', endDate: day };
  const id = newJob(config, [shard]);
  await service.runScan(id, [shard], config);
  const result = registry.digest({ hours: 24, limit: 5 });
  assert.ok(result.counts.ads >= 6 && result.counts.stores >= 2);
  assert.ok(result.top_ads.length >= 1 && result.top_ads.length <= 5);
  assert.ok(result.top_ads[0].scale_score >= result.top_ads[result.top_ads.length - 1].scale_score);
  assert.ok(result.new_stores.some((s) => /^digest\d\.example$/.test(s.domain)));
  const text = registry.digestText(result);
  assert.match(text, /AdSignal — last 24h/);
  assert.match(text, /Top by scale:/);
  assert.match(text, /facebook\.com\/ads\/library\/\?id=/);
});


test('a second scan queues behind the running one (no 409); identical requests attach to the live job', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  script = async (params, variables) => {
    await gate;
    return { ads: [makeAd(`QUEUE-${variables.queryString.length}-${variables.queryString.charCodeAt(6)}`)], page_info: { has_next_page: false, end_cursor: null }, count: 1 };
  };
  const a = service.createScan({ queries: 'queue alpha', lookbackDays: 30, targetAds: 30 });
  const b = service.createScan({ queries: 'queue beta', lookbackDays: 30, targetAds: 30 });
  assert.strictEqual(b.status, 'queued');
  assert.ok(b.queue_position >= 1, 'something is ahead of it');
  const again = service.createScan({ queries: 'queue beta', lookbackDays: 30, targetAds: 30 });
  assert.strictEqual(again.id, b.id, 'identical request re-attaches to the same job');
  assert.strictEqual(again.attached_to_existing, true);
  assert.throws(() => service.createScan({ queries: 'queue gamma', lookbackDays: 30, queue: false }), /already/);
  release();
  for (let i = 0; i < 300 && !['complete', 'failed'].includes(service.getJob(b.id).status); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const ja = service.getJob(a.id);
  const jb = service.getJob(b.id);
  assert.strictEqual(ja.status, 'complete');
  assert.strictEqual(jb.status, 'complete');
  assert.ok(jb.updated_at >= ja.updated_at, 'FIFO: the later request finished after the earlier one');
  // once finished, the same request starts a NEW scan (attach only applies to live jobs)
  script = () => ({ ads: [], page_info: { has_next_page: false, end_cursor: null }, count: 0 });
  const rerun = service.createScan({ queries: 'queue beta', lookbackDays: 30, targetAds: 30 });
  assert.notStrictEqual(rerun.id, b.id);
  for (let i = 0; i < 200 && !['complete', 'failed'].includes(service.getJob(rerun.id).status); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
});

test('queued scans with a stored plan are resumed by pump() (restart safety)', async () => {
  script = () => ({ ads: [makeAd('RESUME-1')], page_info: { has_next_page: false, end_cursor: null }, count: 1 });
  const config = { mode: 'deep', queries: ['resume me'], targetAds: 30, lookbackDays: 30, activeStatus: 'active', sort: 'impressions', ...FAST };
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO scan_jobs (id,status,config_json,total_shards,completed_shards,unique_ads,discarded_ads,created_at,updated_at,shards_json,request_hash)
    VALUES (?, 'queued', ?, 1, 0, 0, 0, ?, ?, ?, ?)`).run(id, JSON.stringify(config), now, now, JSON.stringify([{ ...SHARD, query: 'resume me' }]), 'resume-hash');
  service.pump();
  for (let i = 0; i < 200 && service.getJob(id).status !== 'complete'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.strictEqual(service.getJob(id).status, 'complete');
  assert.strictEqual(service.getJob(id).unique_ads, 1);
});


test('a scan interrupted by a restart is re-queued once; a second interruption fails it but keeps results', async () => {
  script = () => ({ ads: [makeAd('RECOVER-1')], page_info: { has_next_page: false, end_cursor: null }, count: 1 });
  const config = { mode: 'deep', queries: ['recover me'], targetAds: 30, lookbackDays: 30, activeStatus: 'active', sort: 'impressions', ...FAST };
  const plan = JSON.stringify([{ ...SHARD, query: 'recover me' }]);
  const insert = db.prepare(`INSERT INTO scan_jobs (id,status,config_json,total_shards,completed_shards,unique_ads,discarded_ads,created_at,updated_at,shards_json,request_hash,attempts)
    VALUES (?, 'running', ?, 1, 0, 5, 0, ?, ?, ?, ?, ?)`);
  const first = crypto.randomUUID();
  const again = crypto.randomUUID();
  const noPlan = crypto.randomUUID();
  const now = Date.now();
  insert.run(first, JSON.stringify(config), now, now, plan, 'h-first', 0);
  insert.run(again, JSON.stringify(config), now, now, plan, 'h-again', 1);
  db.prepare(`INSERT INTO scan_jobs (id,status,config_json,total_shards,completed_shards,unique_ads,discarded_ads,created_at,updated_at)
    VALUES (?, 'running', ?, 1, 0, 0, 0, ?, ?)`).run(noPlan, JSON.stringify(config), now, now);
  const outcome = service.recoverInterruptedScans();
  assert.strictEqual(outcome.resumed, 1);
  assert.strictEqual(service.getJob(first).status, 'queued');
  assert.strictEqual(service.getJob(again).status, 'failed');
  assert.match(service.getJob(again).error, /Interrupted by service restart/);
  assert.strictEqual(service.getJob(noPlan).status, 'failed');
  service.pump();
  for (let i = 0; i < 200 && service.getJob(first).status !== 'complete'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.strictEqual(service.getJob(first).status, 'complete');
});


test('storage diet: ads are stored once, compressed; scan rows stay small; legacy inline rows still read', async () => {
  script = (params, variables) => ({ ads: [makeAd('DIET-1'), makeAd('DIET-2')], page_info: { has_next_page: false, end_cursor: null }, count: 2 });
  const config = { targetAds: 30, queries: ['diet'], lookbackDays: 90, activeStatus: 'active', sort: 'impressions', ...FAST };
  const shard = { ...SHARD, query: 'diet' };
  const first = newJob(config, [shard]);
  await service.runScan(first, [shard], config);
  const second = newJob(config, [shard]);
  await service.runScan(second, [shard], config);
  // scan rows carry no inline payload; exactly one shared copy exists per distinct ad
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM scan_ads WHERE scan_id IN (?,?) AND payload_json <> ''").get(first, second).n, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM ad_payloads WHERE ad_archive_id IN ('DIET-1','DIET-2')").get().n, 2);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM scan_ads WHERE ad_archive_id='DIET-1' AND scan_id IN (?,?)").get(first, second).n, 2, 'both sightings are kept');
  // both scans list the full ad, with this scan's own scores
  for (const id of [first, second]) {
    const ads = service.listAds(id, { limit: 10 }).ads;
    assert.deepStrictEqual(ads.map((ad) => ad.ad_archive_id).sort(), ['DIET-1', 'DIET-2']);
    assert.ok(ads[0].creative && ads[0].page_name, 'payload fields are present');
    assert.strictEqual(typeof ads[0].scale_score, 'number');
  }
  assert.ok(service.listStores(first).stores.length >= 1);
  // a legacy row (inline JSON, no shared copy) is still readable
  const legacy = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO scan_jobs (id,status,config_json,total_shards,completed_shards,unique_ads,discarded_ads,created_at,updated_at) VALUES (?, 'complete', ?, 1, 1, 1, 0, ?, ?)`).run(legacy, JSON.stringify(config), now, now);
  db.prepare(`INSERT INTO scan_ads (scan_id,ad_archive_id,page_id,page_name,start_date,is_active,impressions_upper,momentum_score,dropship_score,signals_json,matched_queries_json,countries_json,payload_json,first_seen,last_seen)
    VALUES (?, 'LEGACY-1', 'p', 'Legacy Page', '2026-10-30', 1, NULL, 1, 1, '[]', '["diet"]', '["US"]', ?, ?, ?)`)
    .run(legacy, JSON.stringify({ ad_archive_id: 'LEGACY-1', page_name: 'Legacy Page', creative: { body: 'old inline body' } }), now, now);
  assert.strictEqual(service.listAds(legacy, { limit: 5 }).ads[0].creative.body, 'old inline body');
});


test('a Meta rate limit mid-chain stops the whole scan, keeps what was collected, and skips the remaining shards', async () => {
  const { RateLimitedError } = require('../src/lib/errors');
  const seenQueries = [];
  let page = 0;
  script = (params, variables) => {
    seenQueries.push(variables.queryString);
    page += 1;
    if (page === 1) return { ads: [makeAd('RL-1'), makeAd('RL-2'), makeAd('RL-3')], page_info: { has_next_page: true, end_cursor: 'c1' }, count: 100 };
    throw new RateLimitedError('Meta rate limit exceeded (Rate limit exceeded)');
  };
  const config = { targetAds: 500, queries: ['rl one', 'rl two'], lookbackDays: 90, activeStatus: 'active', sort: 'impressions', ...FAST };
  const shards = [{ ...SHARD, query: 'rl one' }, { ...SHARD, query: 'rl two' }];
  const id = newJob(config, shards);
  await service.runScan(id, shards, config);
  const job = service.getJob(id);
  assert.strictEqual(job.status, 'failed');
  assert.match(job.error, /Stopped by Meta's rate limit after collecting 3 ad/);
  assert.strictEqual(job.unique_ads, 3, 'the ads collected before the limit are kept');
  assert.ok(!seenQueries.includes('rl two'), 'the second shard never ran: it would only hit the same limit');
  assert.strictEqual(service.listAds(id, { limit: 10 }).ads.length, 3, 'partial results stay viewable');
});


test('an incremental scan stops at ads the tracker already held, using far fewer requests than a full scan', async () => {
  const config = { targetAds: 500, queries: ['inc term'], lookbackDays: 90, activeStatus: 'active', sort: 'recent', ...FAST };
  const shard = { ...SHARD, query: 'inc term' };
  const makeIncAd = (i) => makeAd(`INC-${i}`);
  calls.length = 0;
  script = pagedScript(200, { makeOne: makeIncAd });
  const full = newJob(config, [shard]);
  await service.runScan(full, [shard], config);
  const fullCalls = calls.length;
  assert.ok(fullCalls >= 15, `the full scan walked the whole chain (${fullCalls} requests)`);
  assert.strictEqual(service.getJob(full).unique_ads, 200);
  // new ads appeared at the front since the last scan; everything behind them is known
  calls.length = 0;
  script = pagedScript(215, { makeOne: (i) => makeIncAd(i < 15 ? 1000 + i : i - 15) });
  const incConfig = { ...config, incremental: true };
  await new Promise((resolve) => setTimeout(resolve, 5)); // job.created_at must be after the first scan's sightings
  const inc = newJob(incConfig, [shard]);
  await service.runScan(inc, [shard], incConfig);
  const job = service.getJob(inc);
  assert.ok(calls.length <= 8, `incremental used ${calls.length} requests instead of ${fullCalls}`);
  assert.ok(job.unique_ads >= 15, 'the 15 new ads were collected');
  assert.match(job.error || '', /Incremental: 1 shard\(s\) stopped after reaching ads the tracker already held \(15 ad\(s\) were new to it\)/);
  assert.doesNotMatch(job.error || '', /exhausted/, 'reaching known territory is a complete scan, not a shortfall');
});

test('createScan: incremental forces newest-first and is part of the request identity', async () => {
  script = () => ({ ads: [], page_info: { has_next_page: false, end_cursor: null }, count: 0 });
  const a = service.createScan({ queries: ['inc identity'], lookbackDays: 30, targetAds: 30, sort: 'impressions', incremental: true });
  assert.strictEqual(a.config.incremental, true);
  assert.strictEqual(a.config.sort, 'recent');
  for (let i = 0; i < 100 && ['queued', 'running'].includes(service.getJob(a.id).status); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  const b = service.createScan({ queries: ['inc identity'], lookbackDays: 30, targetAds: 30, sort: 'recent' });
  assert.notStrictEqual(b.id, a.id);
  assert.strictEqual(b.config.incremental, false);
  for (let i = 0; i < 100 && ['queued', 'running'].includes(service.getJob(b.id).status); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
});

test.after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
