export const COUNTRY_OPTIONS = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'IL'];
export const SCAN_WINDOWS = [3, 7, 14, 21, 30, 60, 90];
export const SCAN_ORDERS = [
  { value: 'impressions', label: 'Top by Meta impressions' },
  { value: 'recent', label: 'Newest launches first' },
];
export const TRACKER_VIEWS = [
  { id: 'new', label: 'New this week', path: '/api/registry/ads?sort=new&since_days=7&seeds_only=1&limit=60', kind: 'ads' },
  { id: 'scaling', label: 'Scaling now', path: '/api/registry/ads?sort=scale&active=1&seeds_only=1&limit=60', kind: 'ads' },
  { id: 'longest', label: 'Longest running', path: '/api/registry/ads?sort=longest&active=1&seeds_only=1&limit=60', kind: 'ads' },
  { id: 'advertisers', label: 'Advertisers', path: '/api/registry/advertisers?sort=scale&seeds_only=1&limit=40', kind: 'advertisers' },
  { id: 'stores', label: 'Stores', path: '/api/registry/domains?sort=scale&seeds_only=1&stores_only=1&limit=40', kind: 'domains' },
];

// Quote-aware split on OR separators (| , newline) — mirrors the server so a phrase such as
// "Buy 2, Get 1 Free" stays whole. Returns { text, exact }; exact = wrapped in double quotes.
export function parseQueries(value) {
  const values = Array.isArray(value) ? value : [value];
  const terms = []; const seen = new Set();
  for (const input of values) {
    const text = String(input || '');
    let tokens = []; let current = ''; let inQuote = false;
    for (const ch of text) {
      if (ch === '"') inQuote = !inQuote;
      if (!inQuote && (ch === ',' || ch === '|' || ch === '\n')) { tokens.push(current); current = ''; } else current += ch;
    }
    tokens.push(current);
    if (inQuote) tokens = text.split(/[\n,|]+/);
    for (const token of tokens) {
      let clean = token.trim(); let exact = false;
      while (clean.length >= 2 && ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'")))) {
        if (clean.startsWith('"')) exact = true;
        clean = clean.slice(1, -1).trim();
      }
      if (clean && !seen.has(clean)) { seen.add(clean); terms.push({ text: clean, exact }); }
    }
  }
  return terms;
}

export function normalizeQueries(value) {
  const values = Array.isArray(value) ? value : [value];
  const terms = values.flatMap((input) => String(input || '').split(/[\n,|]+/)).map((term) => {
    let clean = term.trim();
    while (clean.length >= 2 && ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'")))) {
      clean = clean.slice(1, -1).trim();
    }
    return clean;
  }).filter(Boolean);
  return [...new Set(terms)];
}

export function buildSearchParams(filters) {
  const values = {
    q: filters.query,
    country: filters.country,
    active_status: filters.activeStatus,
    media_type: filters.mediaType,
    platform: filters.platform,
    start_date: filters.startDate,
    end_date: filters.endDate,
    first: Math.max(1, Math.min(Number(filters.limit) || 10, 50)),
    sort: ['impressions', 'recent'].includes(filters.sort) ? filters.sort : '',
    search_type: filters.searchType || '',
  };
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value != null));
}

export function sortAds(ads, mode) {
  return [...ads].sort((a, b) => {
    if (mode === 'evidence') return (b.evidence_score || 0) - (a.evidence_score || 0);
    if (mode === 'newest' || mode === 'recent') return String(b.start_date || '').localeCompare(String(a.start_date || ''));
    if (mode === 'longest') return String(a.start_date || '9999').localeCompare(String(b.start_date || '9999'));
    if (mode === 'advertiser') return String(a.page_name || '').localeCompare(String(b.page_name || ''));
    if (mode === 'impressions') {
      const upper = (ad) => ad.impressions_upper ?? ad.transparency?.impressions?.upper ?? -1;
      return upper(b) - upper(a);
    }
    return 0;
  });
}

export function toggleCountry(countries, country) {
  const current = [...new Set(countries || [])];
  if (current.includes(country)) {
    return current.length === 1 ? current : current.filter((value) => value !== country);
  }
  return [...current, country];
}
