'use strict';

const express = require('express');
const db = require('../db');
const { buildFilter } = require('./receipts');

const router = express.Router();

// GET /api/reports — summary aggregations, respecting the same filters as the list.
router.get('/', (req, res) => {
  const { clause, params } = buildFilter(req.query);

  const totals = db
    .prepare(
      `SELECT
         COUNT(*)                     AS count,
         COALESCE(SUM(total_amount),0) AS total_spend,
         COALESCE(SUM(tax_amount),0)   AS total_tax
       FROM receipts ${clause}`
    )
    .get(params);

  const byCategory = db
    .prepare(
      `SELECT COALESCE(category,'Uncategorized') AS category,
              COUNT(*) AS count,
              COALESCE(SUM(total_amount),0) AS total
       FROM receipts ${clause}
       GROUP BY COALESCE(category,'Uncategorized')
       ORDER BY total DESC`
    )
    .all(params);

  const byMonth = db
    .prepare(
      `SELECT substr(COALESCE(receipt_date, created_at),1,7) AS month,
              COUNT(*) AS count,
              COALESCE(SUM(total_amount),0) AS total,
              COALESCE(SUM(tax_amount),0)   AS tax
       FROM receipts ${clause}
       GROUP BY month
       ORDER BY month ASC`
    )
    .all(params);

  const byVendor = db
    .prepare(
      `SELECT COALESCE(vendor,'Unknown') AS vendor,
              COUNT(*) AS count,
              COALESCE(SUM(total_amount),0) AS total
       FROM receipts ${clause}
       GROUP BY COALESCE(vendor,'Unknown')
       ORDER BY total DESC
       LIMIT 10`
    )
    .all(params);

  res.json({ totals, byCategory, byMonth, byVendor });
});

module.exports = router;
