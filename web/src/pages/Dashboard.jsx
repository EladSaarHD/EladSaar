import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const money = (v, c) =>
  v === null || v === undefined ? '—' : `${Number(v).toFixed(2)} ${c || ''}`.trim();

export default function Dashboard() {
  const [receipts, setReceipts] = useState([]);
  const [filters, setFilters] = useState({ q: '', category: '', from: '', to: '' });
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoading(true);
    api
      .listReceipts(filters)
      .then(setReceipts)
      .catch((e) => setMessage(e.message))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const doUpload = async (fileList) => {
    if (!fileList || !fileList.length) return;
    setMessage('Uploading & extracting…');
    try {
      const { results } = await api.upload(Array.from(fileList));
      const dupes = results.filter((r) => r.duplicate).length;
      const errs = results.filter((r) => r.error).length;
      setMessage(
        `Imported ${results.length - dupes - errs}, ${dupes} duplicate(s)` +
          (errs ? `, ${errs} error(s)` : '')
      );
      load();
    } catch (e) {
      setMessage(`Upload failed: ${e.message}`);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    doUpload(e.dataTransfer.files);
  };

  return (
    <div>
      <div
        className={`dropzone ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p>Drag &amp; drop receipts here (PDF or image), or</p>
        <label className="btn">
          Choose files
          <input
            type="file"
            multiple
            hidden
            accept="image/*,application/pdf"
            onChange={(e) => doUpload(e.target.files)}
          />
        </label>
      </div>

      {message && <div className="banner">{message}</div>}

      <div className="filters">
        <input
          placeholder="Search vendor / notes…"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <input
          placeholder="Category"
          value={filters.category}
          onChange={(e) => setFilters({ ...filters, category: e.target.value })}
        />
        <label>
          From <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </label>
        <label>
          To <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </label>
        <a className="btn" href={api.exportZipUrl(filters)}>
          ⬇ Export ZIP
        </a>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : receipts.length === 0 ? (
        <p className="muted">No receipts yet. Upload one above to get started.</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Date</th>
              <th>Vendor</th>
              <th>Category</th>
              <th className="num">Total</th>
              <th className="num">Tax</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id} onClick={() => navigate(`/receipts/${r.id}`)}>
                <td>{r.receipt_date || '—'}</td>
                <td>{r.vendor || <span className="muted">Unknown</span>}</td>
                <td>{r.category || '—'}</td>
                <td className="num">{money(r.total_amount, r.currency)}</td>
                <td className="num">{money(r.tax_amount, r.currency)}</td>
                <td>{r.source}</td>
                <td>
                  <span className={`pill pill-${r.status}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
