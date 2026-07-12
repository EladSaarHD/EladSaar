'use strict';

// Every bit of knowledge about Facebook's raw field names lives here. Routes,
// cache, and the client are all payload-agnostic — when Meta renames a field,
// this is the only file that changes. All functions are pure and null-safe:
// missing upstream fields degrade to null/[] rather than throwing.

function unixToDate(sec) {
  if (sec === null || sec === undefined || sec === '') return null;
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function nonEmpty(value) {
  return value === undefined || value === '' ? null : value;
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images.map((img) => ({
    original_url: nonEmpty(img.original_image_url) || null,
    resized_url: nonEmpty(img.resized_image_url) || null,
    watermarked_url: nonEmpty(img.watermarked_resized_image_url) || null,
  }));
}

function normalizeVideos(videos) {
  if (!Array.isArray(videos)) return [];
  return videos.map((v) => ({
    video_url: nonEmpty(v.video_hd_url) || nonEmpty(v.video_sd_url) || null,
    video_sd_url: nonEmpty(v.video_sd_url) || null,
    preview_image_url: nonEmpty(v.video_preview_image_url) || null,
    watermarked_url: nonEmpty(v.watermarked_video_hd_url) || nonEmpty(v.watermarked_video_sd_url) || null,
  }));
}

function normalizeCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((c) => ({
    title: nonEmpty(c.title) || null,
    body: nonEmpty(typeof c.body === 'object' && c.body ? c.body.text : c.body) || null,
    cta_text: nonEmpty(c.cta_text) || null,
    link_url: nonEmpty(c.link_url) || null,
    image_url: nonEmpty(c.original_image_url) || nonEmpty(c.resized_image_url) || null,
    video_url: nonEmpty(c.video_hd_url) || nonEmpty(c.video_sd_url) || null,
  }));
}

// Parse a "10K - 15K" / "1.2M+" style range into numeric bounds. Best-effort:
// returns nulls when it can't.
function parseMagnitude(token) {
  if (!token) return null;
  const m = String(token).trim().match(/^([\d.,]+)\s*([KMB])?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') n *= 1e3;
  else if (suffix === 'M') n *= 1e6;
  else if (suffix === 'B') n *= 1e9;
  return Math.round(n);
}

function parseImpressions(node) {
  const idx = node.impressions_with_index || {};
  const text = nonEmpty(idx.impressions_text);
  if (text) {
    const parts = String(text).split(/[-–]/);
    return {
      text,
      lower: parseMagnitude(parts[0]),
      upper: parts[1] !== undefined ? parseMagnitude(parts[1]) : parseMagnitude(parts[0]),
    };
  }
  const imp = node.impressions;
  if (imp && (imp.lower_bound || imp.upper_bound)) {
    return {
      text: null,
      lower: imp.lower_bound !== undefined ? Number(imp.lower_bound) : null,
      upper: imp.upper_bound !== undefined ? Number(imp.upper_bound) : null,
    };
  }
  return null;
}

function normalizeSpend(spend) {
  if (!spend || typeof spend !== 'object') return null;
  return {
    lower: spend.lower_bound !== undefined ? Number(spend.lower_bound) : null,
    upper: spend.upper_bound !== undefined ? Number(spend.upper_bound) : null,
  };
}

// Political/EU transparency, or null for ordinary commercial ads.
function normalizeTransparency(node) {
  const aaa = node.aaa_info || {};
  const spend = normalizeSpend(node.spend);
  const impressions = parseImpressions(node);
  const euReach = aaa.eu_total_reach ?? null;
  const reachEstimate = node.reach_estimate ?? null;
  const pb = Array.isArray(aaa.payer_beneficiary_data) ? aaa.payer_beneficiary_data[0] : null;
  const payer = pb ? nonEmpty(pb.payer) : null;
  const beneficiary = pb ? nonEmpty(pb.beneficiary) : null;

  const hasData =
    spend || impressions || euReach !== null || reachEstimate !== null || payer || beneficiary;
  if (!hasData) return null;

  return {
    currency: nonEmpty(node.currency) || null,
    spend,
    impressions,
    eu_total_reach: euReach,
    reach_estimate: reachEstimate,
    payer: payer || null,
    beneficiary: beneficiary || null,
  };
}

// Map one raw ad node (a collated_results[i] or details `ad` object) to the
// stable output schema.
function normalizeAd(node, extra = {}) {
  const n = node || {};
  const snap = n.snapshot || {};
  const body = snap.body && typeof snap.body === 'object' ? snap.body.text : snap.body;

  const aaaSource = extra.aaa_info ? { ...n, aaa_info: extra.aaa_info } : n;

  return {
    ad_archive_id: n.ad_archive_id != null ? String(n.ad_archive_id) : null,
    ad_id: n.ad_id != null ? String(n.ad_id) : null,
    page_id: n.page_id != null ? String(n.page_id) : null,
    page_name: nonEmpty(n.page_name) || null,
    page_profile_url: nonEmpty(snap.page_profile_uri) || null,
    page_profile_picture_url: nonEmpty(snap.page_profile_picture_url) || null,
    is_active: n.is_active === undefined ? null : Boolean(n.is_active),
    start_date: unixToDate(n.start_date),
    end_date: unixToDate(n.end_date),
    publisher_platforms: Array.isArray(n.publisher_platform) ? n.publisher_platform : [],
    display_format: nonEmpty(snap.display_format) || null,
    creative: {
      title: nonEmpty(snap.title) || null,
      body: nonEmpty(body) || null,
      caption: nonEmpty(snap.caption) || null,
      byline: nonEmpty(snap.byline) || null,
      cta_text: nonEmpty(snap.cta_text) || null,
      cta_type: nonEmpty(snap.cta_type) || null,
      link_url: nonEmpty(snap.link_url) || null,
      images: normalizeImages(snap.images),
      videos: normalizeVideos(snap.videos),
      cards: normalizeCards(snap.cards),
    },
    categories: Array.isArray(n.categories) ? n.categories : [],
    contains_sensitive_content:
      n.contains_sensitive_content === undefined ? null : Boolean(n.contains_sensitive_content),
    transparency: normalizeTransparency(aaaSource),
  };
}

function getConnection(data) {
  return (data && data.ad_library_main && data.ad_library_main.search_results_connection) || {};
}

// Search + page-ads responses share this shape.
function normalizeSearchResponse(data) {
  const conn = getConnection(data);
  const edges = Array.isArray(conn.edges) ? conn.edges : [];
  const ads = [];
  for (const edge of edges) {
    const results = (edge && edge.node && edge.node.collated_results) || [];
    for (const node of results) ads.push(normalizeAd(node));
  }
  const pageInfo = conn.page_info || {};
  const continuation = data && data.__continuation;
  let endCursor = nonEmpty(pageInfo.end_cursor) || null;
  if (endCursor && continuation?.sessionID) {
    endCursor = `mal1.${Buffer.from(
      JSON.stringify({
        cursor: endCursor,
        sessionID: continuation.sessionID,
        collationToken: continuation.collationToken ?? null,
        stateID: continuation.stateID || null,
      })
    ).toString('base64url')}`;
  }
  return {
    ads,
    page_info: {
      has_next_page: Boolean(pageInfo.has_next_page),
      end_cursor: endCursor,
    },
    count: typeof conn.count === 'number' ? conn.count : null,
  };
}

// Single-ad details response.
function normalizeDetails(data) {
  const details = (data && data.ad_library_main && data.ad_library_main.ad_details) || null;
  if (!details) return null;
  const adNode = details.ad || details;
  return normalizeAd(adNode, { aaa_info: details.aaa_info });
}

module.exports = {
  normalizeSearchResponse,
  normalizeDetails,
  normalizeAd,
  // exported for unit tests:
  unixToDate,
  normalizeTransparency,
  parseMagnitude,
};
