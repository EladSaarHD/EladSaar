export const COUNTRY_OPTIONS = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'IL'];
export const SCAN_WINDOWS = [3, 7, 14, 21, 30, 60, 90];

export function normalizeQueries(value) {
  return [...new Set(String(value || '').split(/[\n,]+/).map((q) => q.trim()).filter(Boolean))];
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
