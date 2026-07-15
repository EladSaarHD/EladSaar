import { describe, expect, it } from 'vitest';
import {
  COUNTRY_OPTIONS, SCAN_WINDOWS, buildSearchParams, normalizeQueries, sortAds, toggleCountry,
} from './search.js';

describe('search helpers', () => {
  it('normalizes pipes, wrapper quotes, newlines and commas without duplicates', () => {
    expect(normalizeQueries('"% off" | "Worldwide Shipping"\nRelief,Worldwide Shipping')).toEqual([
      '% off', 'Worldwide Shipping', 'Relief',
    ]);
  });

  it('builds only supported API search parameters', () => {
    const params = buildSearchParams({
      query: 'running shoes', country: 'US', activeStatus: 'active', mediaType: 'video',
      platform: 'instagram', startDate: '2026-01-01', endDate: '', limit: 12, sort: 'recent',
    });
    expect(Object.fromEntries(params)).toEqual({
      q: 'running shoes', country: 'US', active_status: 'active', media_type: 'video',
      platform: 'instagram', start_date: '2026-01-01', first: '12', sort: 'recent',
    });
  });

  it('sorts ads by evidence, longevity, or newest start date', () => {
    const ads = [
      { ad_archive_id: '1', evidence_score: 2, start_date: '2026-06-01' },
      { ad_archive_id: '2', evidence_score: 8, start_date: '2025-01-01' },
    ];
    expect(sortAds(ads, 'evidence')[0].ad_archive_id).toBe('2');
    expect(sortAds(ads, 'newest')[0].ad_archive_id).toBe('1');
    expect(sortAds(ads, 'longest')[0].ad_archive_id).toBe('2');
  });

  it('sorts ads by published impression upper bound', () => {
    const ads = [
      { ad_archive_id: '1', transparency: { impressions: { upper: 12000 } } },
      { ad_archive_id: '2', transparency: { impressions: { upper: 98000 } } },
      { ad_archive_id: '3', transparency: null },
    ];
    expect(sortAds(ads, 'impressions').map((ad) => ad.ad_archive_id)).toEqual(['2', '1', '3']);
  });

  it('exposes only the requested scan windows and supports country chips', () => {
    expect(SCAN_WINDOWS).toEqual([3, 7, 14, 21, 30, 60, 90]);
    expect(COUNTRY_OPTIONS).toContain('IL');
    expect(toggleCountry(['US', 'GB'], 'GB')).toEqual(['US']);
    expect(toggleCountry(['US'], 'US')).toEqual(['US']);
    expect(toggleCountry(['US'], 'CA')).toEqual(['US', 'CA']);
  });
});
