'use strict';

// Live end-to-end smoke test. Bootstraps a session, runs one real search
// against Facebook, and prints the result. Run with --capture to also save
// raw payloads into test/fixtures/ for the offline unit tests.
//
//   node scripts/smoke.js
//   node scripts/smoke.js --capture
//   node scripts/smoke.js --capture "nike" US

const fs = require('fs');
const path = require('path');
const session = require('../src/lib/session');
const client = require('../src/lib/graphqlClient');
const { buildSearchVariables, buildDetailsVariables } = require('../src/lib/variables');
const { httpFetch } = require('../src/lib/http');
const { LIBRARY_URL } = require('../src/constants');
const config = require('../config');

const FIXTURES = path.join(__dirname, '..', 'test', 'fixtures');

function firstAd(data) {
  const edges = data?.ad_library_main?.search_results_connection?.edges || [];
  for (const edge of edges) {
    const results = edge?.node?.collated_results || [];
    if (results.length) return results[0];
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const capture = args.includes('--capture');
  const positional = args.filter((a) => !a.startsWith('--'));
  const q = positional[0] || 'nike';
  const country = (positional[1] || config.defaultCountry || 'US').toUpperCase();

  console.log(`\n▶ smoke: q="${q}" country=${country} capture=${capture}\n`);

  if (capture) {
    fs.mkdirSync(FIXTURES, { recursive: true });
    console.log('· capturing library page HTML …');
    const res = await httpFetch(
      `${LIBRARY_URL}?active_status=all&ad_type=all&country=${country}&media_type=all`,
      { headers: { 'user-agent': session.userAgent, 'accept-language': 'en-US,en;q=0.9' } }
    );
    const html = await res.text();
    fs.writeFileSync(path.join(FIXTURES, 'library-page.html'), html);
    console.log(`  saved library-page.html (${html.length} bytes, HTTP ${res.status})`);
  }

  const t0 = Date.now();
  const sess = await session.getSession({ force: true });
  console.log(`· session bootstrapped in ${Date.now() - t0}ms`);
  console.log(`  lsd: ${sess.lsd.slice(0, 8)}…  docIds:`, sess.docIds);

  const t1 = Date.now();
  const variables = buildSearchVariables({ q, country, first: 5 });
  const data = await client.request({ kind: 'search', variables });
  const elapsed = Date.now() - t1;

  const conn = data?.ad_library_main?.search_results_connection || {};
  const edges = conn.edges || [];
  const count = edges.reduce((n, e) => n + (e?.node?.collated_results?.length || 0), 0);
  console.log(`\n✓ search returned ~${count} ads in ${elapsed}ms (total_count=${conn.count ?? '?'})`);
  console.log(`  has_next_page=${conn.page_info?.has_next_page} end_cursor=${conn.page_info?.end_cursor ? 'yes' : 'no'}`);

  if (capture) {
    fs.writeFileSync(path.join(FIXTURES, 'search-response.json'), JSON.stringify(data, null, 2));
    console.log('  saved search-response.json');
  }

  // Optional: try normalize if the module is implemented.
  try {
    const { normalizeSearchResponse } = require('../src/lib/normalize');
    const norm = normalizeSearchResponse(data);
    console.log(`\n· normalized ${norm.ads.length} ads. First:`);
    console.log(JSON.stringify(norm.ads[0], null, 2).split('\n').slice(0, 30).join('\n'));
  } catch (err) {
    console.log(`\n· (normalize not run: ${err.message})`);
  }

  // Optional: fetch details for the first ad to capture a details fixture.
  const ad = firstAd(data);
  if (ad && ad.ad_archive_id) {
    try {
      const dvars = buildDetailsVariables({
        adArchiveId: ad.ad_archive_id,
        pageId: ad.page_id,
        country,
      });
      const details = await client.request({ kind: 'details', variables: dvars });
      console.log(`\n✓ fetched details for ad ${ad.ad_archive_id}`);
      if (capture) {
        fs.writeFileSync(path.join(FIXTURES, 'details-response.json'), JSON.stringify(details, null, 2));
        console.log('  saved details-response.json');
      }
    } catch (err) {
      console.log(`\n· details fetch failed (non-fatal): ${err.message}`);
    }
  }

  console.log('\n✓ smoke complete\n');
}

main().catch((err) => {
  console.error('\n✗ smoke failed:', err.message);
  process.exitCode = 1;
});
