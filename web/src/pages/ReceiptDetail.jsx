import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const FIELDS = [
  ['vendor', 'Vendor', 'text'],
  ['receipt_date', 'Date', 'date'],
  ['total_amount', 'Total', 'number'],
  ['currency', 'Currency', 'text'],
  ['tax_amount', 'Tax amount', 'number'],
  ['tax_rate', 'Tax rate %', 'number'],
  ['category', 'Category', 'text'],
  ['payment_method', 'Payment method', 'text'],
];

export default function ReceiptDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [r, setR] = useState(null);
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState('');

  useEffect(() => {
    api.getReceipt(id).then((data) => {
      setR(data);
      setForm(data);
    });
  }, [id]);

  if (!r) return <p>Loading…</p>;

  const save = async () => {
    const payload = {};
    for (const [k] of FIELDS) payload[k] = form[k] === '' ? null : form[k];
    payload.notes = form.notes || null;
    payload.status = 'reviewed';
    const updated = await api.updateReceipt(id, payload);
    setR(updated);
    setForm(updated);
    setSaved('Saved ✓');
    setTimeout(() => setSaved(''), 2000);
  };

  const remove = async () => {
    if (!confirm('Delete this receipt and its file?')) return;
    await api.deleteReceipt(id);
    navigate('/');
  };

  const isImage = (r.mime_type || '').startsWith('image/');

  return (
    <div className="detail">
      <button className="link" onClick={() => navigate(-1)}>
        ← Back
      </button>
      <div className="detail-grid">
        <div className="preview">
          {isImage ? (
            <img src={api.fileUrl(r.id)} alt={r.original_filename} />
          ) : (
            <iframe title="receipt" src={api.fileUrl(r.id)} />
          )}
          <p className="muted">
            {r.original_filename} · extracted by <b>{r.extractor || 'manual'}</b>
          </p>
        </div>

        <div className="form">
          {FIELDS.map(([key, label, type]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                type={type}
                step={type === 'number' ? 'any' : undefined}
                value={form[key] ?? ''}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            <span>Notes</span>
            <textarea
              rows={3}
              value={form.notes ?? ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>

          <div className="actions">
            <button className="btn primary" onClick={save}>
              Save
            </button>
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
            {saved && <span className="ok">{saved}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
