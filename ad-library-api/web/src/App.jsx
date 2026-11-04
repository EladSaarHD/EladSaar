import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronRight, Copy, Facebook,
  Film, Filter, Image as ImageIcon, Instagram, Layers3, LoaderCircle, Menu,
  Play, Search, SlidersHorizontal, Sparkles, Target, X, Zap,
} from 'lucide-react';
import {
  COUNTRY_OPTIONS, SCAN_ORDERS, SCAN_WINDOWS, TRACKER_VIEWS, buildSearchParams, normalizeQueries, parseQueries, sortAds, toggleCountry,
} from './search.js';

const initialFilters = {
  queries: 'running shoes', country: 'US', activeStatus: 'active', mediaType: 'all',
  platform: '', startDate: '', endDate: '', limit: 12, targetAds: 500,
  scanCountries: ['US'], lookbackDays: 14, scanSort: 'impressions',
};

function daysRunning(date) {
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
}

function scoreAd(ad) {
  const longevity = Math.min(5, Math.floor(daysRunning(ad.start_date) / 30));
  return (ad.is_active ? 4 : 0) + longevity + Math.min(3, (ad.publisher_platforms || []).length) +
    Math.min(3, (ad.matched_queries || []).length) + (ad.creative?.body || ad.creative?.title ? 1 : 0);
}

function creativeMedia(ad) {
  const creative = ad.creative || {};
  const video = creative.videos?.[0];
  const image = creative.images?.[0] || creative.cards?.[0]?.image_url;
  return { video, image };
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function Pill({ children, tone = 'neutral' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

// Live pace + time-left for a running scan, from what the poller already receives. Needs a few seconds of
// movement before it will guess, so it never shows a made-up ETA.
export function ScanTiming({ job }) {
  const start = useRef({ id: null, at: 0, ads: 0, progress: 0 });
  if (start.current.id !== job.id) start.current = { id: job.id, at: Date.now(), ads: job.unique_ads, progress: job.progress };
  if (job.status === 'queued') {
    return <>{job.queue_position > 0 ? `${job.queue_position} scan${job.queue_position === 1 ? '' : 's'} ahead in the queue. ` : 'Starting… '}</>;
  }
  if (job.paused_ms > 0) {
    return <>Meta asked us to slow down, so the scan is waiting about {Math.max(1, Math.round(job.paused_ms / 60000))} min before it continues (nothing is lost). </>;
  }
  const seconds = (Date.now() - start.current.at) / 1000;
  const gained = job.unique_ads - start.current.ads;
  const progressGained = job.progress - start.current.progress;
  if (seconds < 15 || gained < 5) return null;
  const perMinute = Math.round((gained / seconds) * 60);
  const minutesLeft = progressGained >= 2 ? Math.max(1, Math.round(((100 - job.progress) / progressGained) * seconds / 60)) : null;
  return <>{perMinute.toLocaleString()} ads/min{minutesLeft ? ` · about ${minutesLeft} min left` : ''}. </>;
}

export function DiscardedCount({ count }) {
  const value = Number(count) || 0;
  return value > 0 ? <span className="discarded-count">{value.toLocaleString()} outside launch window excluded</span> : null;
}

function App() {
  const [filters, setFilters] = useState(initialFilters);
  const [ads, setAds] = useState([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState('evidence');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState(null);
  const [workspaceMode, setWorkspaceMode] = useState('search');
  const [scanJob, setScanJob] = useState(null);
  const [scanOffset, setScanOffset] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);
  const [resultView, setResultView] = useState('ads');
  const [stores, setStores] = useState([]);
  const [storeTotal, setStoreTotal] = useState(0);
  const [recentScans, setRecentScans] = useState([]);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
    fetch('/api/scans?limit=6').then((r) => r.json()).then((data) => {
      setRecentScans(data.scans || []);
      const latest = data.scans?.[0];
      if (latest && ['queued', 'running'].includes(latest.status)) {
        setScanJob(latest); setWorkspaceMode(latest.config?.mode === 'dropshipping' ? 'dropshipping' : 'deep');
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!scanJob || !['queued', 'running'].includes(scanJob.status)) return undefined;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/scans/${scanJob.id}`);
      if (!response.ok) return;
      const job = await response.json();
      setScanJob(job);
      if (job.unique_ads > 0 && (job.unique_ads !== scanJob.unique_ads || job.status === 'complete')) {
        await loadScanAds(job.id, 0, false, sort);
        await loadStores(job.id, workspaceMode === 'dropshipping' ? 'dropship' : 'volume');
      }
      if (job.status === 'failed') setError(job.error || 'Deep scan failed');
      if (['complete', 'failed'].includes(job.status)) {
        setRecentScans((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 6));
      }
    }, 1800);
    return () => clearInterval(timer);
  }, [scanJob?.id, scanJob?.status, sort]);

  const sortedAds = useMemo(() => sortAds(ads, sort), [ads, sort]);
  const stats = useMemo(() => ({
    active: ads.filter((ad) => ad.is_active).length,
    video: ads.filter((ad) => ad.creative?.videos?.length).length,
    avgDays: ads.length ? Math.round(ads.reduce((sum, ad) => sum + daysRunning(ad.start_date), 0) / ads.length) : 0,
    pages: new Set(ads.map((ad) => ad.page_id).filter(Boolean)).size,
  }), [ads]);

  async function loadScanAds(id, offset = 0, append = false, sortMode = sort, mode = workspaceMode) {
    const backendSort = ['momentum', 'impressions', 'recent', 'dropship', 'scale', 'variants'].includes(sortMode) ? sortMode : 'momentum';
    const params = new URLSearchParams({ sort: backendSort, limit: '100', offset: String(offset) });
    if (mode === 'dropshipping') params.set('dropship_min', '3');
    const response = await fetch(`/api/scans/${id}/ads?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Could not load scan results');
    setAds((current) => append ? [...current, ...data.ads] : data.ads);
    setScanTotal(data.total); setScanOffset(offset + data.ads.length); setTotal(data.total); setSearched(true);
  }

  async function loadStores(id, storeSort = 'dropship') {
    const response = await fetch(`/api/scans/${id}/stores?sort=${encodeURIComponent(storeSort)}&limit=500`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Could not load store results');
    setStores(data.stores || []); setStoreTotal(data.total || 0);
  }

  async function openSavedScan(job) {
    const mode = job.config?.mode === 'dropshipping' ? 'dropshipping' : 'deep';
    const nextSort = mode === 'dropshipping' ? 'dropship' : 'momentum';
    setError(''); setScanJob(job); setWorkspaceMode(mode); setSort(nextSort);
    setResultView(mode === 'dropshipping' ? 'stores' : 'ads');
    await Promise.all([
      loadScanAds(job.id, 0, false, nextSort, mode),
      loadStores(job.id, mode === 'dropshipping' ? 'dropship' : 'volume'),
    ]);
    window.scrollTo({ top: 500, behavior: 'smooth' });
  }

  async function startScan(event) {
    event?.preventDefault();
    setLoading(true); setError(''); setAds([]); setSearched(false); setScanJob(null);
    // Send the raw text: wrapping a phrase in "quotes" asks the server for an exact-phrase search.
    const queries = filters.queries;
    try {
      const response = await fetch('/api/scans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: workspaceMode === 'dropshipping' ? 'dropshipping' : 'deep',
          queries, sort: filters.scanSort, countries: filters.scanCountries,
          targetAds: Number(filters.targetAds), lookbackDays: Number(filters.lookbackDays),
          activeStatus: filters.activeStatus, mediaType: filters.mediaType, platform: filters.platform,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not start deep scan');
      setScanJob(data); setSort(workspaceMode === 'dropshipping' ? 'dropship' : 'momentum');
      setResultView(workspaceMode === 'dropshipping' ? 'stores' : 'ads'); setStores([]); setStoreTotal(0);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function runSearch(event, requestedSort = sort) {
    event?.preventDefault();
    const terms = parseQueries(filters.queries);
    if (!terms.length) return;
    setLoading(true); setError(''); setSelected(null);
    try {
      const responses = await Promise.all(terms.map(async ({ text: query, exact }) => {
        const params = buildSearchParams({ ...filters, query, sort: requestedSort, searchType: exact ? 'keyword_exact_phrase' : '' });
        const response = await fetch(`/api/search?${params}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Search failed');
        return { query, data };
      }));
      const map = new Map();
      let combinedTotal = 0;
      responses.forEach(({ query, data }) => {
        combinedTotal += data.count || 0;
        (data.ads || []).forEach((ad) => {
          const id = ad.ad_archive_id;
          const current = map.get(id) || { ...ad, matched_queries: [] };
          if (!current.matched_queries.includes(query)) current.matched_queries.push(query);
          map.set(id, current);
        });
      });
      const combined = [...map.values()].map((ad) => ({ ...ad, evidence_score: scoreAd(ad) }));
      setAds(combined); setTotal(combinedTotal); setSearched(true);
    } catch (err) {
      setError(err.message || 'Unable to search Meta Ad Library');
    } finally { setLoading(false); }
  }

  async function openDetails(ad) {
    setSelected(ad); setDetailLoading(true);
    try {
      const params = new URLSearchParams({ country: filters.country });
      const response = await fetch(`/api/ads/${ad.ad_archive_id}?${params}`);
      const data = await response.json();
      if (response.ok && data.ad) setSelected({ ...data.ad, matched_queries: ad.matched_queries, evidence_score: ad.evidence_score });
    } finally { setDetailLoading(false); }
  }

  async function changeSort(value) {
    setSort(value);
    if (workspaceMode === 'search') {
      if (['impressions', 'recent'].includes(value)) await runSearch(null, value);
      return;
    }
    if (workspaceMode !== 'search' && scanJob?.status === 'complete') {
      if (resultView === 'stores') {
        const storeSort = value === 'momentum' ? 'volume' : value;
        await loadStores(scanJob.id, storeSort);
      } else {
        await loadScanAds(scanJob.id, 0, false, value);
      }
    }
  }

  function update(key, value) { setFilters((current) => ({ ...current, [key]: value })); }

  async function copyHunterPrompt() {
    const chosen = selected || sortedAds[0];
    if (!chosen) return;
    const text = `Analyze Meta ad ${chosen.ad_archive_id} from ${chosen.page_name}. Focus on hook, offer, angle, audience, creative structure and testable variations.`;
    await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Zap size={19} /></div><div><strong>AdSignal</strong><span>Meta intelligence</span></div></div>
        <div className="top-actions">
          {health?.ok && <span className="cache-status">{health.cache?.rows || 0} cached responses</span>}
          <span className={`status ${health?.ok ? 'online' : health?.ok === false ? 'offline' : ''}`}><i />{health?.ok ? 'Connected' : health?.ok === false ? 'Offline' : 'Checking'}</span>
          <button className="icon-button mobile-only" onClick={() => setFiltersOpen(!filtersOpen)} aria-label="Toggle filters"><Menu size={20} /></button>
        </div>
      </header>

      <main>
        <section className="hero workspace-hero">
          <div><div className="eyebrow"><Sparkles size={14} /> Private Meta research</div>
          <h1>Find signals worth <span>acting on.</span></h1>
          <p>Search campaigns, map durable angles, and uncover active storefronts from one focused workspace.</p></div>
          <div className="workspace-summary">
            <div><span>Source</span><strong>Meta Ad Library</strong></div>
            <div><span>Session</span><strong>{health?.session?.bootstrapped ? 'Ready' : 'Warms on first search'}</strong></div>
            <div><span>Storage</span><strong>Local only</strong></div>
          </div>
        </section>

        <nav className="mode-tabs" aria-label="Research mode">
          <button className={workspaceMode === 'search' ? 'active' : ''} onClick={() => { setWorkspaceMode('search'); setScanJob(null); setSort('evidence'); setResultView('ads'); }}><span>Quick search</span><small>One-pass creative lookup</small></button>
          <button className={workspaceMode === 'deep' ? 'active' : ''} onClick={() => { setWorkspaceMode('deep'); setScanJob(null); setSort('momentum'); setResultView('ads'); }}><span>Deep scan</span><small>Broader market evidence</small></button>
          <button className={workspaceMode === 'dropshipping' ? 'active' : ''} onClick={() => { setWorkspaceMode('dropshipping'); setScanJob(null); setSort('dropship'); setResultView('stores'); }}><span><Sparkles size={14} /> Dropshipping finder</span><small>Storefront discovery</small></button>
          <button className={workspaceMode === 'tracker' ? 'active' : ''} onClick={() => { setWorkspaceMode('tracker'); setScanJob(null); setSearched(false); setError(''); }}><span><Activity size={14} /> Tracker</span><small>New, scaling &amp; longest-running</small></button>
        </nav>

        {workspaceMode === 'tracker' && <Tracker onOpen={openDetails} />}

        {workspaceMode !== 'tracker' && <form className="search-panel" onSubmit={workspaceMode === 'search' ? runSearch : startScan}>
          <div className="query-row">
            <Search size={21} />
            <textarea value={filters.queries} onChange={(e) => update('queries', e.target.value)} placeholder={workspaceMode === 'dropshipping' ? 'Optional product niches—leave broad for store discovery…' : 'Search brands, products, pains, or benefits…'} rows="1" />
            <button className="primary-button" disabled={loading || ['queued', 'running'].includes(scanJob?.status)}>{loading || ['queued', 'running'].includes(scanJob?.status) ? <LoaderCircle className="spin" size={18} /> : workspaceMode === 'search' ? <Search size={18} /> : <Layers3 size={18} />}<span>{loading ? 'Starting' : ['queued', 'running'].includes(scanJob?.status) ? 'Scan running' : workspaceMode === 'search' ? 'Search ads' : workspaceMode === 'dropshipping' ? 'Find stores' : 'Start scan'}</span></button>
          </div>
          {workspaceMode !== 'search' && <div className="scan-settings">
            <div className="scan-presets"><span>Scan size</span><div><button type="button" className={Number(filters.targetAds) === 100 ? 'active' : ''} onClick={() => update('targetAds', 100)}>Fast <small>100</small></button><button type="button" className={Number(filters.targetAds) === 500 ? 'active' : ''} onClick={() => update('targetAds', 500)}>Standard <small>500</small></button><button type="button" className={Number(filters.targetAds) === 1000 ? 'active' : ''} onClick={() => update('targetAds', 1000)}>Deep <small>1,000</small></button><button type="button" className={Number(filters.targetAds) === 5000 ? 'active' : ''} onClick={() => update('targetAds', 5000)}>Max <small>5,000</small></button></div></div>
            <label><span>Custom target</span><input type="number" min="30" max="10000" step="10" value={filters.targetAds} onChange={(e) => update('targetAds', e.target.value)} /></label>
            <div className="country-picker"><span>Countries</span><div className="country-chips">{COUNTRY_OPTIONS.map((country) => <button type="button" key={country} className={filters.scanCountries.includes(country) ? 'active' : ''} onClick={() => update('scanCountries', toggleCountry(filters.scanCountries, country))}>{country}</button>)}</div></div>
            <label><span>Launch window</span><select value={filters.lookbackDays} onChange={(e) => update('lookbackDays', e.target.value)}>{SCAN_WINDOWS.map((days) => <option key={days} value={days}>{days} days</option>)}</select></label>
            <label><span>Collect in order</span><select value={filters.scanSort} onChange={(e) => update('scanSort', e.target.value)}>{SCAN_ORDERS.map((order) => <option key={order.value} value={order.value}>{order.label}</option>)}</select></label>
            <div className="scan-note"><Activity size={15} /><span>One scan at a time; results stream in and stay local. Put a phrase in "quotes" for an exact match. “Newest launches” finds new ads fastest for short windows.</span></div>
          </div>}
          <div className={`filters ${workspaceMode !== 'search' ? 'scan-filters' : ''} ${filtersOpen ? 'open' : ''}`}>
            {workspaceMode === 'search' && <label><span>Country</span><div className="select-wrap"><select value={filters.country} onChange={(e) => update('country', e.target.value)}>{COUNTRY_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select><ChevronDown size={14} /></div></label>}
            <label><span>Status</span><div className="select-wrap"><select value={filters.activeStatus} onChange={(e) => update('activeStatus', e.target.value)}><option value="all">All ads</option><option value="active">Active</option><option value="inactive">Inactive</option></select><ChevronDown size={14} /></div></label>
            <label><span>Media</span><div className="select-wrap"><select value={filters.mediaType} onChange={(e) => update('mediaType', e.target.value)}><option value="all">All formats</option><option value="image">Images</option><option value="video">Videos</option><option value="meme">Memes</option></select><ChevronDown size={14} /></div></label>
            <label><span>Platform</span><div className="select-wrap"><select value={filters.platform} onChange={(e) => update('platform', e.target.value)}><option value="">All platforms</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="threads">Threads</option><option value="messenger">Messenger</option></select><ChevronDown size={14} /></div></label>
            {workspaceMode === 'search' && <><label><span>From</span><input type="date" value={filters.startDate} onChange={(e) => update('startDate', e.target.value)} /></label>
            <label><span>To</span><input type="date" value={filters.endDate} onChange={(e) => update('endDate', e.target.value)} /></label></>}
          </div>
          <button type="button" className="filter-toggle" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} /> Filters <span>{filtersOpen ? 'Hide' : 'Show'}</span></button>
        </form>}

        {error && workspaceMode !== 'tracker' && <div className="error-banner"><Activity size={18} />{error}</div>}
        {workspaceMode !== 'tracker' && scanJob && ['queued', 'running'].includes(scanJob.status) && <section className="scan-progress">
          <div className="scan-progress-head"><div><LoaderCircle className="spin" size={19} /><span><strong>{scanJob.status === 'queued' ? 'Deep scan queued' : 'Deep scan running'}</strong><small>{scanJob.unique_ads.toLocaleString()} unique ads collected{scanJob.discarded_ads > 0 && <> · <DiscardedCount count={scanJob.discarded_ads} /></>}</small></span></div><b>{scanJob.progress}%</b></div>
          <div className="progress-track"><i style={{ width: `${scanJob.progress}%` }} /></div>
          <p><ScanTiming job={scanJob} /> Shard {scanJob.completed_shards} of {scanJob.total_shards} · Partial results appear below as they arrive and are stored locally.</p>
        </section>}
        {workspaceMode !== 'tracker' && scanJob?.status === 'complete' && scanJob.error && <div className="scan-summary"><Activity size={17} /><span>{scanJob.error}</span></div>}

        {workspaceMode !== 'tracker' && searched && !loading && <>
          <section className="stats-grid">
            <div className="stat-card"><span>Unique ads</span><strong>{ads.length}</strong><small>{total.toLocaleString()} market matches</small></div>
            <div className="stat-card"><span>Active now</span><strong>{stats.active}</strong><small>{ads.length ? Math.round(stats.active / ads.length * 100) : 0}% of this set</small></div>
            <div className="stat-card"><span>Avg. runtime</span><strong>{stats.avgDays}<em>d</em></strong><small>Longevity signal</small></div>
            <div className="stat-card"><span>Advertisers</span><strong>{stats.pages}</strong><small>{stats.video} video creatives</small></div>
          </section>

          <div className="results-toolbar">
            <div><h2>{resultView === 'stores' ? 'Likely storefronts' : 'Creative results'}</h2><p>{resultView === 'stores' ? `${storeTotal.toLocaleString()} unique merchant domains` : normalizeQueries(filters.queries).join(' | ')}</p></div>
            <div className="result-actions">{workspaceMode !== 'search' && <div className="view-toggle"><button className={resultView === 'ads' ? 'active' : ''} onClick={() => setResultView('ads')}>Ads</button><button className={resultView === 'stores' ? 'active' : ''} onClick={() => setResultView('stores')}>Stores</button></div>}
            <label className="sort-control"><Filter size={15} /><select value={sort} onChange={(e) => changeSort(e.target.value)}>{workspaceMode === 'search' ? <><option value="evidence">Best evidence</option><option value="impressions">Impressions: high to low</option><option value="recent">Most recent</option><option value="longest">Longest running</option><option value="advertiser">Advertiser A–Z</option></> : <><option value="momentum">High momentum + recent</option><option value="scale">Scale: variants + longevity</option><option value="variants">Most ad variants</option><option value="impressions">Meta impression rank</option><option value="recent">Most recent</option><option value="dropship">Dropshipping likelihood</option></>}</select></label></div>
          </div>

          {resultView === 'ads' ? <section className="ad-grid">
            {sortedAds.map((ad) => <AdCard key={ad.ad_archive_id} ad={ad} onOpen={() => openDetails(ad)} />)}
          </section> : <section className="store-grid">{stores.map((store) => <StoreCard key={store.domain} store={store} onOpen={() => openDetails(store.sample_ad)} />)}</section>}
          {resultView === 'ads' && workspaceMode !== 'search' && scanOffset < scanTotal && <button className="load-more" onClick={() => loadScanAds(scanJob.id, scanOffset, true, sort)}>Load 100 more <span>{scanOffset.toLocaleString()} of {scanTotal.toLocaleString()}</span></button>}
          {workspaceMode !== 'search' && <p className="impressions-note">Meta only publishes actual impression ranges for eligible transparency ads. “High momentum” is a clearly labeled discovery score based on recency, active status, placements and available public signals—not invented impressions.</p>}
          {!ads.length && <div className="empty-state"><Target size={36} /><h3>No ads found</h3><p>Try a broader term, another country, or “All ads”.</p></div>}
        </>}

        {workspaceMode !== 'tracker' && recentScans.length > 0 && !searched && !loading && <section className="recent-scans">
          <div className="section-heading"><div><span>Recent work</span><h2>Resume a saved scan</h2></div><small>Results remain on this Mac</small></div>
          <div className="recent-scan-grid">{recentScans.slice(0, 4).map((job) => <button key={job.id} className="recent-scan" onClick={() => void openSavedScan(job)} disabled={job.unique_ads === 0}>
            <span className={`recent-state state-${job.status}`}>{job.status}</span>
            <strong>{job.config?.mode === 'dropshipping' ? 'Store finder' : 'Deep scan'}</strong>
            <p>{normalizeQueries(job.config?.queryExpression || job.config?.queries || []).join(' | ') || 'Broad market discovery'}</p>
            <footer><span>{job.unique_ads.toLocaleString()} ads{job.discarded_ads > 0 && <> · <DiscardedCount count={job.discarded_ads} /></>}</span><span>{formatDate(job.updated_at)}</span></footer>
          </button>)}</div>
        </section>}

        {workspaceMode !== 'tracker' && !searched && !loading && <section className="starter-grid">
          <div><Layers3 size={22} /><h3>Multi-query search</h3><p>Separate terms with pipes, commas, or new lines to compare related angles.</p></div>
          <div><Target size={22} /><h3>Evidence scoring</h3><p>Prioritize active, durable, multi-platform campaigns—not vanity metrics.</p></div>
          <div><Sparkles size={22} /><h3>Hunter-ready</h3><p>Open any result, copy a focused brief, and continue the analysis with Hunter.</p></div>
        </section>}
      </main>

      {selected && <DetailDrawer ad={selected} loading={detailLoading} onClose={() => setSelected(null)} onCopy={copyHunterPrompt} copied={copied} />}
    </div>
  );
}

export function StoreCard({ store, onOpen }) {
  const page = store.page_names?.[0] || store.domain;
  return <article className="store-card">
    <div className="store-head"><div className="store-icon">{page.slice(0, 1).toUpperCase()}</div><div><strong>{page}</strong><a href={`https://${store.domain}`} target="_blank" rel="noreferrer">{store.domain} <ArrowUpRight size={12} /></a></div><Pill tone="success">DS {store.dropship_score}</Pill></div>
    <div className="store-metrics"><div><span>Ads found</span><strong>{store.ad_count}</strong></div><div><span>Active</span><strong>{store.active_ads}</strong></div><div><span>Variants</span><strong>{store.total_variants ?? '—'}</strong></div><div><span>Scale</span><strong>{store.scale_score ?? store.momentum_score}</strong></div></div>
    <div className="tag-list">{store.countries?.slice(0, 5).map((country) => <Pill key={country}>{country}</Pill>)}{store.matched_queries?.slice(0, 3).map((query) => <Pill key={query} tone="accent">{query}</Pill>)}</div>
    <div className="store-foot"><span>Latest launch {store.latest_start || 'unknown'}</span><button onClick={onOpen}>Inspect sample ad <ChevronRight size={14} /></button></div>
  </article>;
}

function AdCard({ ad, onOpen }) {
  const { video, image } = creativeMedia(ad);
  const creative = ad.creative || {};
  return <article className="ad-card" onClick={onOpen}>
    <div className="media-frame">
      {video ? <video src={video} poster={image || undefined} muted playsInline preload="metadata" /> : image ? <img src={image} alt="Ad creative" loading="lazy" /> : <div className="media-placeholder"><ImageIcon size={28} /><span>Creative preview unavailable</span></div>}
      {video && <span className="video-badge"><Play size={12} fill="currentColor" /> Video</span>}
      <span className={`active-badge ${ad.is_active ? '' : 'inactive'}`}><i />{ad.is_active ? 'Active' : 'Inactive'}</span>
    </div>
    <div className="ad-content">
      <div className="advertiser-row"><div className="avatar">{(ad.page_name || '?').slice(0, 1)}</div><div><strong>{ad.page_name || 'Unknown advertiser'}</strong><span>Ad #{ad.ad_archive_id}</span></div><ArrowUpRight size={17} /></div>
      <p className="ad-copy">{creative.body || creative.title || 'No primary text available.'}</p>
      {creative.title && <h3>{creative.title}</h3>}
      <div className="platform-row">{(ad.publisher_platforms || []).map((p) => <span key={p}>{p.toLowerCase().includes('instagram') ? <Instagram size={13} /> : <Facebook size={13} />}{p.replace('_', ' ')}</span>)}</div>
      <div className="card-footer"><span><CalendarDays size={14} /> {daysRunning(ad.start_date)} days</span><div className="score-pills">{(ad.variant_count || ad.collation_count) > 1 && <Pill tone="success">×{ad.variant_count || ad.collation_count} variants</Pill>}{ad.scale_score > 0 && <Pill tone="accent">Scale {ad.scale_score}</Pill>}{ad.impressions_upper != null && <Pill tone="success">{ad.impressions_upper.toLocaleString()} imp.</Pill>}{ad.dropship_score != null && <Pill tone="accent">DS {ad.dropship_score}</Pill>}<Pill tone="accent">{ad.momentum_score != null ? `Momentum ${ad.momentum_score}` : `Score ${ad.evidence_score || scoreAd(ad)}`}</Pill></div></div>
    </div>
  </article>;
}

function DetailDrawer({ ad, loading, onClose, onCopy, copied }) {
  const { video, image } = creativeMedia(ad); const creative = ad.creative || {};
  return <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <aside className="drawer">
      <div className="drawer-header"><div><Pill tone={ad.is_active ? 'success' : 'neutral'}>{ad.is_active ? 'Active campaign' : 'Inactive campaign'}</Pill><h2>{ad.page_name}</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div>
      {loading && <div className="drawer-loading"><LoaderCircle className="spin" /> Loading full ad details…</div>}
      <div className="drawer-media">{video ? <video src={video} poster={image || undefined} controls playsInline /> : image ? <img src={image} alt="Ad creative" /> : <div className="media-placeholder"><Film size={32} />No media preview</div>}</div>
      <div className="drawer-body">
        <div className="detail-metrics"><div><span>Evidence</span><strong>{ad.evidence_score || scoreAd(ad)}</strong></div><div><span>Running</span><strong>{daysRunning(ad.start_date)}d</strong></div><div><span>Started</span><strong>{formatDate(ad.start_date)}</strong></div>{(ad.collation_count || ad.variant_count) > 1 && <div><span>Ads using this creative</span><strong>{ad.collation_count || ad.variant_count}</strong></div>}{ad.page_like_count != null && <div><span>Page likes</span><strong>{ad.page_like_count.toLocaleString()}</strong></div>}{ad.scale_score > 0 && <div><span>Scale score</span><strong>{ad.scale_score}</strong></div>}</div>
        <section><span className="section-label">Primary text</span><p className="full-copy">{creative.body || 'No primary text available.'}</p></section>
        {creative.title && <section><span className="section-label">Headline</span><h3>{creative.title}</h3></section>}
        <section><span className="section-label">Placement</span><div className="tag-list">{(ad.publisher_platforms || []).map((p) => <Pill key={p}>{p.replace('_', ' ')}</Pill>)}</div></section>
        {ad.matched_queries?.length > 0 && <section><span className="section-label">Matched searches</span><div className="tag-list">{ad.matched_queries.map((q) => <Pill key={q} tone="accent">{q}</Pill>)}</div></section>}
        {ad.page_categories?.length > 0 && <section><span className="section-label">Advertiser category</span><div className="tag-list">{ad.page_categories.map((category) => <Pill key={category}>{category}</Pill>)}</div></section>}
        {ad.creative?.link_url && <section><span className="section-label">Destination</span><a className="dest-link" href={ad.creative.link_url} target="_blank" rel="noreferrer">{ad.creative.link_url.replace(/^https?:\/\//, '').slice(0, 70)} <ArrowUpRight size={12} /></a></section>}
        {ad.dropship_signals?.length > 0 && <section><span className="section-label">Dropshipping discovery signals</span><div className="tag-list">{ad.dropship_signals.map((signal) => <Pill key={signal} tone="success">{signal}</Pill>)}</div><p className="signal-note">These are public direct-response/storefront signals, not proof that the merchant uses dropshipping fulfillment.</p></section>}
        <div className="drawer-actions"><button className="primary-button" onClick={onCopy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Copied' : 'Copy Hunter brief'}</button><a className="secondary-button" href={`https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`} target="_blank" rel="noreferrer">Open in Meta <ArrowUpRight size={16} /></a></div>
      </div>
    </aside>
  </div>;
}

function Tracker({ onOpen }) {
  const [sweepNote, setSweepNote] = useState('');
  async function sweep(row) {
    setSweepNote(`Starting a sweep of ${row.page_name || row.page_id}…`);
    try {
      const response = await fetch(`/api/registry/advertisers/${encodeURIComponent(row.page_id)}/sweep`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetAds: 500 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not start the sweep');
      setSweepNote(`Sweep started for ${row.page_name || row.page_id}: collecting every active ad (scan ${data.id.slice(0, 8)}). Open Deep scan → recent work when it finishes.`);
    } catch (err) { setSweepNote(err.message); }
  }
  const [view, setView] = useState('new');
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetch('/api/registry/stats').then((r) => r.json()).then(setStats).catch(() => {}); }, []);
  useEffect(() => {
    const current = TRACKER_VIEWS.find((item) => item.id === view);
    setLoading(true); setError('');
    fetch(current.path).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Could not load the tracker');
      setData({ kind: current.kind, payload });
    }).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [view]);

  return <section className="tracker">
    <div className="tracker-head">
      <div><h2>Ad tracker</h2><p>{stats ? `${stats.ads.toLocaleString()} distinct ads tracked across all scans · ${stats.new_7d.toLocaleString()} first seen this week · ${stats.new_24h.toLocaleString()} in the last 24h` : 'Everything every scan has ever collected, de-duplicated.'}</p></div>
      <div className="view-toggle">{TRACKER_VIEWS.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>)}</div>
    </div>
    {error && <div className="error-banner"><Activity size={18} />{error}</div>}
    {sweepNote && <div className="scan-summary"><Activity size={17} /><span>{sweepNote}</span></div>}
    {loading && <div className="drawer-loading"><LoaderCircle className="spin" /> Loading…</div>}
    {!loading && data?.kind === 'ads' && (data.payload.ads.length
      ? <section className="ad-grid">{data.payload.ads.map((ad) => <AdCard key={ad.ad_archive_id} ad={ad} onOpen={() => onOpen(ad)} />)}</section>
      : <div className="empty-state"><Target size={36} /><h3>Nothing here yet</h3><p>Run a few scans — the tracker fills as ads are seen again over time.</p></div>)}
    {!loading && data?.kind === 'advertisers' && <div className="tracker-table">
      <div className="tracker-row tracker-row-head"><span>Advertiser</span><span>Ads</span><span>Active</span><span>Variants</span><span>Top scale</span><span>Since</span><span /></div>
      {data.payload.advertisers.map((row) => <div className="tracker-row" key={row.page_id}>
        <span><strong>{row.page_name || row.page_id}</strong><small>{row.domains.slice(0, 2).join(' · ') || 'no storefront seen'}</small></span>
        <span>{row.ads}</span><span>{row.active_ads}</span><span>{row.variants}</span><span>{row.top_scale}</span><span>{row.earliest_start || '—'}</span><span><button className="sweep-button" onClick={() => sweep(row)}>Sweep</button></span>
      </div>)}
    </div>}
    {!loading && data?.kind === 'domains' && <div className="tracker-table">
      <div className="tracker-row tracker-row-head"><span>Store</span><span>Ads</span><span>Active</span><span>Variants</span><span>Top scale</span><span>Advertisers</span></div>
      {data.payload.domains.map((row) => <div className="tracker-row" key={row.domain}>
        <span><strong>{row.domain}</strong><small>first launch {row.earliest_start || 'unknown'}</small></span>
        <span>{row.ads}</span><span>{row.active_ads}</span><span>{row.variants}</span><span>{row.top_scale}</span><span>{row.pages}</span>
      </div>)}
    </div>}
    <p className="impressions-note">Scale score = ads sharing the creative + how long it has run + live status + placements. It shows how hard an advertiser leans on a creative — not spend, sales or profit.</p>
  </section>;
}

export default App;
