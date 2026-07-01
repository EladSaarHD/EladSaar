'use strict';

const db = require('../db');
const { storeFile } = require('./storage');
const { extract } = require('../extract');
const { categoryFor } = require('../rules');
const config = require('../config');

const insertStmt = db.prepare(`
  INSERT INTO receipts
    (vendor, receipt_date, total_amount, currency, tax_amount, tax_rate,
     category, payment_method, source, original_filename, stored_path,
     mime_type, file_hash, status, extractor, raw_extraction, email_message_id)
  VALUES
    (@vendor, @receipt_date, @total_amount, @currency, @tax_amount, @tax_rate,
     @category, @payment_method, @source, @original_filename, @stored_path,
     @mime_type, @file_hash, @status, @extractor, @raw_extraction, @email_message_id)
`);

const findByHash = db.prepare('SELECT * FROM receipts WHERE file_hash = ?');
const findByMessageId = db.prepare(
  'SELECT * FROM receipts WHERE email_message_id = ? LIMIT 1'
);

// Ingest a single file buffer from any source through the shared pipeline:
// dedupe -> store -> extract -> apply rules -> persist. Returns
// { receipt, duplicate }. Never throws on extractor problems (falls to manual).
async function ingestFile(buffer, meta = {}) {
  const {
    originalName = 'receipt',
    mimeType = null,
    source = 'upload',
    emailMessageId = null,
  } = meta;

  // Email-level dedupe (before hashing, cheap short-circuit).
  if (emailMessageId) {
    const existingMsg = findByMessageId.get(emailMessageId);
    if (existingMsg) return { receipt: existingMsg, duplicate: true };
  }

  // Store first (also computes the content hash used for dedupe).
  const { hash, storedPath } = storeFile(buffer, {
    originalName,
    mimeType,
  });

  const existing = findByHash.get(hash);
  if (existing) return { receipt: existing, duplicate: true };

  // Run extraction (safe — always resolves).
  let extracted = { fields: {}, extractor: 'manual', raw: null };
  try {
    extracted = await extract({ storedPath, mimeType });
  } catch (err) {
    extracted = { fields: {}, extractor: 'manual', raw: null, note: err.message };
  }

  const f = extracted.fields || {};
  const status = extracted.extractor === 'manual' ? 'pending' : 'extracted';

  // Auto-categorize via rules if the extractor didn't supply a category.
  let category = f.category || null;
  if (!category) {
    category = categoryFor({ vendor: f.vendor, original_filename: originalName });
  }

  const row = {
    vendor: f.vendor || null,
    receipt_date: f.receipt_date || null,
    total_amount: f.total_amount ?? null,
    currency: f.currency || config.defaultCurrency,
    tax_amount: f.tax_amount ?? null,
    tax_rate: f.tax_rate ?? null,
    category,
    payment_method: f.payment_method || null,
    source,
    original_filename: originalName,
    stored_path: storedPath,
    mime_type: mimeType,
    file_hash: hash,
    status,
    extractor: extracted.extractor,
    raw_extraction: extracted.raw
      ? typeof extracted.raw === 'string'
        ? extracted.raw
        : JSON.stringify(extracted.raw)
      : extracted.note || null,
    email_message_id: emailMessageId,
  };

  const info = insertStmt.run(row);
  const receipt = db
    .prepare('SELECT * FROM receipts WHERE id = ?')
    .get(info.lastInsertRowid);
  return { receipt, duplicate: false };
}

module.exports = { ingestFile };
