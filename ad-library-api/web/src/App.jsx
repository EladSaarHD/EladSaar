import { useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowUpRight, CalendarDays, Check, ChevronDown, Copy, Facebook,
  Film, Filter, Image as ImageIcon, Instagram, Layers3, LoaderCircle, Menu,
  Play, Search, SlidersHorizontal, Sparkles, Target, X, Zap,
} from 'lucide-react';
import { buildSearchParams, normalizeQueries, sortAds } from './search.js';

const COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'IL'];
const initialFilters = {
  queries: 'running shoes', country: 'US', activeStatus: 'active', mediaType: 'all',
  platform: '', startDate: '', endDate: '', limit: 12,
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

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((d) => setHealth(Boolean(d.ok))).catch(() => setHealth(false));
  }, []);

  const sortedAds = useMemo(() => sortAds(ads, sort), [ads, sort]);
  const stats = useMemo(() => ({
    active: ads.filter((ad) => ad.is_active).length,
    video: ads.filter((ad) => ad.creative?.videos?.length).length,
    avgDays: ads.length ? Math.round(ads.reduce((sum, ad) => sum + daysRunning(ad.start_date), 0) / ads.length) : 0,
    pages: new Set(ads.map((ad) => ad.page_id).filter(Boolean)).size,
  }), [ads]);

  async function runSearch(event) {
    event?.preventDefault();
    const queries = normalizeQueries(filters.queries);
    if (!queries.length) return;
    setLoading(true); setError(''); setSelected(null);
    try {
      const responses = await Promise.all(queries.map(async (query) => {
        const params = buildSearchParams({ ...filters, query });
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
        <div className="brand"><div className="brand-mark"><Zap size={19} /></div><div><strong>AdSignal</strong><span>Meta Intelligence</span></div></div>
        <div className="top-actions">
          <span className={`status ${health ? 'online' : health === false ? 'offline' : ''}`}><i />{health ? 'Live' : health === false ? 'Offline' : 'Checking'}</span>
          <button className="icon-button mobile-only" onClick={() => setFiltersOpen(!filtersOpen)}><Menu size={20} /></button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="eyebrow"><Sparkles size={14} /> Creative intelligence workspace</div>
          <h1>Find the ads that reveal<br /><span>what a market believes.</span></h1>
          <p>Search live Meta campaigns, compare angles, and surface durable creative signals—not just pretty ads.</p>
        </section>

        <form className="search-panel" onSubmit={runSearch}>
          <div className="query-row">
            <Search size={21} />
            <textarea value={filters.queries} onChange={(e) => update('queries', e.target.value)} placeholder="Search brands, products, pains, or benefits…" rows="1" />
            <button className="primary-button" disabled={loading}>{loading ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}<span>{loading ? 'Searching' : 'Search ads'}</span></button>
          </div>
          <div className={`filters ${filtersOpen ? 'open' : ''}`}>
            <label><span>Country</span><div className="select-wrap"><select value={filters.country} onChange={(e) => update('country', e.target.value)}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</select><ChevronDown size={14} /></div></label>
            <label><span>Status</span><div className="select-wrap"><select value={filters.activeStatus} onChange={(e) => update('activeStatus', e.target.value)}><option value="all">All ads</option><option value="active">Active</option><option value="inactive">Inactive</option></select><ChevronDown size={14} /></div></label>
            <label><span>Media</span><div className="select-wrap"><select value={filters.mediaType} onChange={(e) => update('mediaType', e.target.value)}><option value="all">All formats</option><option value="image">Images</option><option value="video">Videos</option><option value="meme">Memes</option></select><ChevronDown size={14} /></div></label>
            <label><span>Platform</span><div className="select-wrap"><select value={filters.platform} onChange={(e) => update('platform', e.target.value)}><option value="">All platforms</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="threads">Threads</option><option value="messenger">Messenger</option></select><ChevronDown size={14} /></div></label>
            <label><span>From</span><input type="date" value={filters.startDate} onChange={(e) => update('startDate', e.target.value)} /></label>
            <label><span>To</span><input type="date" value={filters.endDate} onChange={(e) => update('endDate', e.target.value)} /></label>
          </div>
          <button type="button" className="filter-toggle" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} /> Filters <span>{filtersOpen ? 'Hide' : 'Show'}</span></button>
        </form>

        {error && <div className="error-banner"><Activity size={18} />{error}</div>}

        {searched && !loading && <>
          <section className="stats-grid">
            <div className="stat-card"><span>Unique ads</span><strong>{ads.length}</strong><small>{total.toLocaleString()} market matches</small></div>
            <div className="stat-card"><span>Active now</span><strong>{stats.active}</strong><small>{ads.length ? Math.round(stats.active / ads.length * 100) : 0}% of this set</small></div>
            <div className="stat-card"><span>Avg. runtime</span><strong>{stats.avgDays}<em>d</em></strong><small>Longevity signal</small></div>
            <div className="stat-card"><span>Advertisers</span><strong>{stats.pages}</strong><small>{stats.video} video creatives</small></div>
          </section>

          <div className="results-toolbar">
            <div><h2>Creative results</h2><p>{normalizeQueries(filters.queries).join(' · ')}</p></div>
            <label className="sort-control"><Filter size={15} /><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="evidence">Best evidence</option><option value="newest">Newest first</option><option value="longest">Longest running</option><option value="advertiser">Advertiser A–Z</option></select></label>
          </div>

          <section className="ad-grid">
            {sortedAds.map((ad) => <AdCard key={ad.ad_archive_id} ad={ad} onOpen={() => openDetails(ad)} />)}
          </section>
          {!ads.length && <div className="empty-state"><Target size={36} /><h3>No ads found</h3><p>Try a broader term, another country, or “All ads”.</p></div>}
        </>}

        {!searched && !loading && <section className="starter-grid">
          <div><Layers3 size={22} /><h3>Multi-query search</h3><p>Separate terms with commas or new lines to compare related angles.</p></div>
          <div><Target size={22} /><h3>Evidence scoring</h3><p>Prioritize active, durable, multi-platform campaigns—not vanity metrics.</p></div>
          <div><Sparkles size={22} /><h3>Hunter-ready</h3><p>Open any result, copy a focused brief, and continue the analysis with Hunter.</p></div>
        </section>}
      </main>

      {selected && <DetailDrawer ad={selected} loading={detailLoading} onClose={() => setSelected(null)} onCopy={copyHunterPrompt} copied={copied} />}
    </div>
  );
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
      <div className="card-footer"><span><CalendarDays size={14} /> {daysRunning(ad.start_date)} days</span><Pill tone="accent">Score {ad.evidence_score || scoreAd(ad)}</Pill></div>
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
        <div className="detail-metrics"><div><span>Evidence</span><strong>{ad.evidence_score || scoreAd(ad)}</strong></div><div><span>Running</span><strong>{daysRunning(ad.start_date)}d</strong></div><div><span>Started</span><strong>{formatDate(ad.start_date)}</strong></div></div>
        <section><span className="section-label">Primary text</span><p className="full-copy">{creative.body || 'No primary text available.'}</p></section>
        {creative.title && <section><span className="section-label">Headline</span><h3>{creative.title}</h3></section>}
        <section><span className="section-label">Placement</span><div className="tag-list">{(ad.publisher_platforms || []).map((p) => <Pill key={p}>{p.replace('_', ' ')}</Pill>)}</div></section>
        {ad.matched_queries?.length > 0 && <section><span className="section-label">Matched searches</span><div className="tag-list">{ad.matched_queries.map((q) => <Pill key={q} tone="accent">{q}</Pill>)}</div></section>}
        <div className="drawer-actions"><button className="primary-button" onClick={onCopy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Copied' : 'Copy Hunter brief'}</button><a className="secondary-button" href={`https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`} target="_blank" rel="noreferrer">Open in Meta <ArrowUpRight size={16} /></a></div>
      </div>
    </aside>
  </div>;
}

export default App;
