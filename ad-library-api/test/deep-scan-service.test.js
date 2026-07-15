'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('runScan persists only ads inside the requested shard and reports discarded ads', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adsignal-run-'));
  process.env.DATA_DIR = dataDir;

  const listQueryPath = require.resolve('../src/lib/listQuery');
  require.cache[listQueryPath] = {
    id: listQueryPath,
    filename: listQueryPath,
    loaded: true,
    exports: {
      runListQuery: async () => ({
        ads: [
          { ad_archive_id: 'valid', page_id: 'p1', page_name: 'Valid', start_date: '2026-07-10', is_active: true },
          { ad_archive_id: 'old', page_id: 'p2', page_name: 'Old', start_date: '2025-09-12', is_active: true },
          { ad_archive_id: 'missing', page_id: 'p3', page_name: 'Missing', is_active: true },
        ],
        page_info: { has_next_page: false, end_cursor: null },
      }),
    },
  };

  const db = require('../src/db');
  const { getJob, listAds, runScan } = require('../src/lib/deepScanService');
  const id = crypto.randomUUID();
  const now = Date.now();
  const config = {
    targetAds: 30,
    lookbackDays: 14,
    activeStatus: 'active',
    sort: 'impressions',
    maxPagesPerShard: 1,
    requestPauseMs: 0,
    pagePauseMs: 0,
  };
  db.prepare(`INSERT INTO scan_jobs
    (id,status,config_json,total_shards,completed_shards,unique_ads,discarded_ads,created_at,updated_at)
    VALUES (?, 'queued', ?, 1, 0, 0, 0, ?, ?)`)
    .run(id, JSON.stringify(config), now, now);

  await runScan(id, [{ query: '% off | Worldwide Shipping', country: 'US', startDate: '2026-07-01', endDate: '2026-07-15' }], config);

  const job = getJob(id);
  const result = listAds(id, { sort: 'impressions', limit: 500 });
  assert.strictEqual(job.status, 'complete');
  assert.strictEqual(job.unique_ads, 1);
  assert.strictEqual(job.discarded_ads, 2);
  assert.match(job.error, /Discarded 2 out-of-window ad\(s\)/);
  assert.deepStrictEqual(result.ads.map((ad) => ad.ad_archive_id), ['valid']);

  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
