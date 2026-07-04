import React from 'react';

function pct(n) {
  if (n === null || n === undefined) return '';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(2)}%`;
}

export default function Watchlist({ items, activeSymbol, onSelect, onRemove }) {
  return (
    <aside className="watchlist">
      <div className="wl-head">Watchlist</div>
      {items.length === 0 && (
        <div className="wl-empty muted">
          Search a symbol and press ★ to add it here.
        </div>
      )}
      <ul>
        {items.map((it) => {
          const q = it.quote || {};
          const up = (q.changePercent || 0) >= 0;
          return (
            <li
              key={it.symbol}
              className={it.symbol === activeSymbol ? 'active' : ''}
              onClick={() => onSelect(it.symbol)}
            >
              <div className="wl-sym">
                <span className="wl-ticker">{it.symbol}</span>
                <span className="wl-name">{it.name || q.name || ''}</span>
              </div>
              <div className="wl-nums">
                <span className="wl-price">
                  {q.price != null ? q.price.toFixed(2) : '—'}
                </span>
                <span className={`wl-chg ${up ? 'up' : 'down'}`}>
                  {pct(q.changePercent)}
                </span>
              </div>
              <button
                className="wl-remove"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(it.symbol);
                }}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
