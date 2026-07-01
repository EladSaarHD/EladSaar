import React, { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { api } from '../api.js';

const COLORS = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1'];

export default function Reports() {
  const [data, setData] = useState(null);
  const [range, setRange] = useState({ from: '', to: '' });

  useEffect(() => {
    api.reports(range).then(setData).catch(() => setData(null));
  }, [range]);

  if (!data) return <p>Loading…</p>;

  return (
    <div className="reports">
      <div className="filters">
        <label>
          From <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </label>
        <label>
          To <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </label>
      </div>

      <div className="cards">
        <div className="card">
          <div className="card-label">Receipts</div>
          <div className="card-value">{data.totals.count}</div>
        </div>
        <div className="card">
          <div className="card-label">Total spend</div>
          <div className="card-value">{Number(data.totals.total_spend).toFixed(2)}</div>
        </div>
        <div className="card">
          <div className="card-label">Total tax</div>
          <div className="card-value">{Number(data.totals.total_tax).toFixed(2)}</div>
        </div>
      </div>

      <div className="chart-row">
        <div className="chart">
          <h3>Spend by month</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.byMonth}>
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="total" fill="#4e79a7" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart">
          <h3>By category</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.byCategory} dataKey="total" nameKey="category" outerRadius={90} label>
                {data.byCategory.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <h3>Top vendors</h3>
      <table className="grid">
        <thead>
          <tr>
            <th>Vendor</th>
            <th className="num">Count</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.byVendor.map((v) => (
            <tr key={v.vendor}>
              <td>{v.vendor}</td>
              <td className="num">{v.count}</td>
              <td className="num">{Number(v.total).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
