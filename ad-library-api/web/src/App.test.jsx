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

describe('StoreCard scale metrics', () => {
  it('shows variants and scale, and tolerates scans saved before those fields existed', () => {
    const base = { domain: 'a.com', page_names: ['A'], ad_count: 3, active_ads: 3, momentum_score: 50, dropship_score: 4, countries: [], matched_queries: [], sample_ad: {} };
    const modern = renderToStaticMarkup(<StoreCard store={{ ...base, total_variants: 41, scale_score: 77 }} onOpen={() => {}} />);
    expect(modern).toContain('41');
    expect(modern).toContain('77');
    expect(() => renderToStaticMarkup(<StoreCard store={base} onOpen={() => {}} />)).not.toThrow();
  });
});

describe('DiscardedCount', () => {
  it('reports strict launch-window exclusions and hides zero counts', () => {
    expect(renderToStaticMarkup(<DiscardedCount count={484} />)).toContain('484 outside launch window excluded');
    expect(renderToStaticMarkup(<DiscardedCount count={0} />)).toBe('');
  });
});
