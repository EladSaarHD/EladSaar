import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Settings() {
  const [status, setStatus] = useState(null);
  const [rules, setRules] = useState([]);
  const [draft, setDraft] = useState({ match_field: 'vendor', pattern: '', category: '' });
  const [msg, setMsg] = useState('');

  const loadRules = () => api.rules().then(setRules);

  useEffect(() => {
    api.status().then(setStatus);
    loadRules();
  }, []);

  const addRule = async () => {
    if (!draft.pattern || !draft.category) return;
    await api.addRule(draft);
    setDraft({ match_field: 'vendor', pattern: '', category: '' });
    loadRules();
  };

  const apply = async () => {
    const { updated } = await api.applyRules();
    setMsg(`Applied rules to ${updated} receipt(s).`);
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <div className="settings">
      <section>
        <h3>Runtime status</h3>
        {status ? (
          <ul className="status">
            <li>Extractor: <b>{status.extractor}</b>{status.extractor === 'codex' && ` (${status.codexCommand})`}</li>
            <li>Watched folder: <b>{status.watchDir || 'disabled'}</b></li>
            <li>Email inbox: <b>{status.imapEnabled ? status.imapHost : 'disabled'}</b></li>
            <li>Default currency: <b>{status.defaultCurrency}</b></li>
          </ul>
        ) : (
          <p>Loading…</p>
        )}
        <p className="muted">
          These are configured in <code>.env</code> / <code>config.local.json</code> and applied on restart.
        </p>
      </section>

      <section>
        <h3>Auto-categorization rules</h3>
        <p className="muted">
          When a receipt's {`{field}`} contains the pattern, assign the category.
        </p>
        <div className="rule-form">
          <select
            value={draft.match_field}
            onChange={(e) => setDraft({ ...draft, match_field: e.target.value })}
          >
            <option value="vendor">Vendor</option>
            <option value="filename">Filename</option>
          </select>
          <input
            placeholder="contains…"
            value={draft.pattern}
            onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
          />
          <input
            placeholder="Category"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
          <button className="btn" onClick={addRule}>
            Add
          </button>
        </div>

        <table className="grid">
          <thead>
            <tr>
              <th>Field</th>
              <th>Pattern</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.match_field}</td>
                <td>{r.pattern}</td>
                <td>{r.category}</td>
                <td>
                  <button
                    className="link danger"
                    onClick={() => api.deleteRule(r.id).then(loadRules)}
                  >
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button className="btn" onClick={apply}>
          Apply rules to uncategorized receipts
        </button>
        {msg && <span className="ok"> {msg}</span>}
      </section>
    </div>
  );
}
