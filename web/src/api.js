// Tiny fetch wrapper for the local API.
async function j(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== null && v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  listReceipts: (filters) => j(`/api/receipts${qs(filters)}`),
  getReceipt: (id) => j(`/api/receipts/${id}`),
  updateReceipt: (id, body) =>
    j(`/api/receipts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deleteReceipt: (id) => j(`/api/receipts/${id}`, { method: 'DELETE' }),
  upload: (files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return j('/api/receipts/upload', { method: 'POST', body: fd });
  },
  reports: (filters) => j(`/api/reports${qs(filters)}`),
  status: () => j('/api/settings/status'),
  rules: () => j('/api/settings/rules'),
  addRule: (body) =>
    j('/api/settings/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deleteRule: (id) => j(`/api/settings/rules/${id}`, { method: 'DELETE' }),
  applyRules: () => j('/api/settings/rules/apply', { method: 'POST' }),
  exportZipUrl: (filters) => `/api/export/zip${qs(filters)}`,
  fileUrl: (id) => `/api/receipts/${id}/file`,
};
