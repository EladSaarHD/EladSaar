import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

// Debounced symbol autocomplete. Calls onPick(symbolRow) when a result is chosen.
export default function SymbolSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const rows = await api.searchSymbols(q.trim());
        setResults(rows.slice(0, 20));
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (row) => {
    onPick(row);
    setQ('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="symbol-search" ref={boxRef}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="Search symbol or company…  (e.g. AAPL, Tesla)"
        spellCheck={false}
      />
      {open && (results.length > 0 || loading) && (
        <ul className="search-results">
          {loading && <li className="muted">Searching…</li>}
          {results.map((r) => (
            <li key={`${r.symbol}:${r.exchange}`} onClick={() => pick(r)}>
              <span className="r-symbol">{r.symbol}</span>
              <span className="r-name">{r.name}</span>
              <span className="r-exch">{r.exchange || r.country}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
