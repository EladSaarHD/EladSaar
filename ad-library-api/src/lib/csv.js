'use strict';

// CSV for spreadsheets. UTF-8 BOM so Excel reads non-Latin text correctly; CRLF line ends; quotes doubled.
// Cells that start with = + - @ would be run as formulas by Excel/Sheets (CSV injection: ad copy is attacker-controlled),
// so they are prefixed with an apostrophe — except plain numbers.
function cell(value) {
  if (value == null) return '';
  let text = Array.isArray(value) ? value.join('; ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(columns, rows) {
  const header = columns.map((column) => cell(column.label)).join(',');
  const lines = rows.map((row) => columns.map((column) => cell(column.get(row))).join(','));
  return `\ufeff${[header, ...lines].join('\r\n')}\r\n`;
}

const firstOf = (...values) => values.find((value) => value != null && value !== '');
const bodyOf = (ad) => String(firstOf(ad.creative?.body, ad.creative?.cards?.[0]?.body, '') || '').replace(/\s+/g, ' ').slice(0, 400);

const AD_COLUMNS = [
  { label: 'Ad ID', get: (ad) => ad.ad_archive_id },
  { label: 'Ad Library URL', get: (ad) => ad.ad_library_url || (ad.ad_archive_id ? `https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}` : '') },
  { label: 'Advertiser', get: (ad) => ad.page_name },
  { label: 'Page ID', get: (ad) => ad.page_id },
  { label: 'Store / destination', get: (ad) => firstOf(ad.creative?.link_url, ad.creative?.cards?.[0]?.link_url) },
  { label: 'Started', get: (ad) => ad.start_date },
  { label: 'Active', get: (ad) => (ad.is_active == null ? '' : ad.is_active ? 'yes' : 'no') },
  { label: 'Ads sharing this creative', get: (ad) => firstOf(ad.variant_count, ad.collation_count) },
  { label: 'Scale score', get: (ad) => ad.scale_score },
  { label: 'Momentum', get: (ad) => ad.momentum_score },
  { label: 'Dropship score', get: (ad) => ad.dropship_score },
  { label: 'Meta impression rank', get: (ad) => ad.meta_rank },
  { label: 'Platforms', get: (ad) => ad.publisher_platforms },
  { label: 'Countries', get: (ad) => ad.countries },
  { label: 'Matched terms', get: (ad) => ad.matched_queries },
  { label: 'Found by your terms', get: (ad) => (ad.matched_seed == null ? '' : ad.matched_seed ? 'yes' : 'no') },
  { label: 'Page likes', get: (ad) => ad.page_like_count },
  { label: 'Headline', get: (ad) => ad.creative?.title },
  { label: 'Call to action', get: (ad) => ad.creative?.cta_text },
  { label: 'Ad copy (first 400 chars)', get: bodyOf },
];

const STORE_COLUMNS = [
  { label: 'Store', get: (s) => s.domain },
  { label: 'Advertiser pages', get: (s) => [...(s.page_names || [])] },
  { label: 'Ads', get: (s) => s.ad_count },
  { label: 'Active ads', get: (s) => s.active_ads },
  { label: 'Ad variants', get: (s) => s.total_variants },
  { label: 'Scale score', get: (s) => s.scale_score },
  { label: 'Dropship score', get: (s) => s.dropship_score },
  { label: 'Momentum', get: (s) => s.momentum_score },
  { label: 'Earliest start', get: (s) => s.earliest_start },
  { label: 'Latest start', get: (s) => s.latest_start },
  { label: 'Page likes', get: (s) => s.page_like_count },
  { label: 'Countries', get: (s) => [...(s.countries || [])] },
  { label: 'Matched terms', get: (s) => [...(s.matched_queries || [])] },
  { label: 'Example ad', get: (s) => (s.sample_ad?.ad_archive_id ? `https://www.facebook.com/ads/library/?id=${s.sample_ad.ad_archive_id}` : '') },
];

module.exports = { toCsv, cell, AD_COLUMNS, STORE_COLUMNS };
