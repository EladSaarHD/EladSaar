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
  };
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value != null));
}

export function sortAds(ads, mode) {
  return [...ads].sort((a, b) => {
    if (mode === 'evidence') return (b.evidence_score || 0) - (a.evidence_score || 0);
    if (mode === 'newest') return String(b.start_date || '').localeCompare(String(a.start_date || ''));
    if (mode === 'longest') return String(a.start_date || '9999').localeCompare(String(b.start_date || '9999'));
    if (mode === 'advertiser') return String(a.page_name || '').localeCompare(String(b.page_name || ''));
    return 0;
  });
}
