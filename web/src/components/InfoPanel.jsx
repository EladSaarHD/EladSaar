import React from 'react';

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function bigMoney(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return fmt(n, 0);
}

function Row({ label, value }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export default function InfoPanel({ symbol, quote, company }) {
  if (!symbol) return <section className="info-panel" />;
  const q = quote || {};
  const up = (q.change || 0) >= 0;
  const stats = (company && company.statistics) || {};
  const profile = (company && company.profile) || {};

  return (
    <section className="info-panel">
      <div className="ip-head">
        <div className="ip-symbol">{symbol}</div>
        <div className="ip-name">{q.name || profile.name || ''}</div>
        <div className="ip-exch">
          {q.exchange || profile.exchange || ''} {q.currency ? `· ${q.currency}` : ''}
        </div>
      </div>

      <div className="ip-price">
        <span className="ip-last">{fmt(q.price)}</span>
        <span className={`ip-change ${up ? 'up' : 'down'}`}>
          {q.change != null ? `${up ? '+' : ''}${fmt(q.change)}` : ''}{' '}
          {q.changePercent != null
            ? `(${up ? '+' : ''}${fmt(q.changePercent)}%)`
            : ''}
        </span>
      </div>

      <div className="ip-stats">
        <Row label="Open" value={fmt(q.open)} />
        <Row label="High" value={fmt(q.high)} />
        <Row label="Low" value={fmt(q.low)} />
        <Row label="Prev close" value={fmt(q.previousClose)} />
        <Row label="Volume" value={bigMoney(q.volume)} />
        <Row
          label="52-wk range"
          value={
            q.week52Low != null || stats.week52Low != null
              ? `${fmt(q.week52Low ?? stats.week52Low)} – ${fmt(
                  q.week52High ?? stats.week52High
                )}`
              : '—'
          }
        />
        <Row label="Market cap" value={bigMoney(stats.marketCap)} />
        <Row label="P/E (TTM)" value={fmt(stats.peRatio)} />
        <Row label="EPS" value={fmt(stats.eps)} />
        <Row label="Beta" value={fmt(stats.beta)} />
        <Row
          label="Div yield"
          value={
            stats.dividendYield != null
              ? `${fmt(stats.dividendYield * 100)}%`
              : '—'
          }
        />
      </div>

      {profile.description && (
        <div className="ip-about">
          <div className="ip-about-head">
            About{profile.sector ? ` · ${profile.sector}` : ''}
          </div>
          <p>{profile.description}</p>
          {profile.website && (
            <a href={profile.website} target="_blank" rel="noreferrer">
              {profile.website.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
