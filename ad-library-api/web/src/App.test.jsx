import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DiscardedCount, StoreCard } from './App.jsx';

describe('StoreCard', () => {
  it('renders completed dropshipping store results without crashing the app', () => {
    const store = {
      domain: 'example-store.com',
      page_names: ['Example Store'],
      ad_count: 684,
      active_ads: 502,
      momentum_score: 88,
      dropship_score: 9,
      latest_start: '2026-07-14',
      countries: ['US', 'GB'],
      matched_queries: ['running shoes'],
      sample_ad: { ad_archive_id: '123' },
    };

    expect(() => renderToStaticMarkup(<StoreCard store={store} onOpen={() => {}} />)).not.toThrow();
  });
});

describe('DiscardedCount', () => {
  it('reports strict launch-window exclusions and hides zero counts', () => {
    expect(renderToStaticMarkup(<DiscardedCount count={484} />)).toContain('484 outside launch window excluded');
    expect(renderToStaticMarkup(<DiscardedCount count={0} />)).toBe('');
  });
});
