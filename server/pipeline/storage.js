'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/tiff': '.tiff',
  'application/pdf': '.pdf',
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function pickExtension(originalName, mimeType) {
  const fromName = path.extname(originalName || '').toLowerCase();
  if (fromName) return fromName;
  return EXT_BY_MIME[mimeType] || '';
}

// Store a receipt file under data/receipts/<year>/<month>/<hash><ext>.
// Returns { hash, storedPath (absolute), relPath (relative to receiptsDir) }.
function storeFile(buffer, { originalName, mimeType, receiptDate } = {}) {
  const hash = sha256(buffer);

  // Bucket by receipt date when known, else by "unsorted" so files are grouped.
  let year = 'unsorted';
  let month = '';
  const d = receiptDate ? new Date(receiptDate) : null;
  if (d && !Number.isNaN(d.getTime())) {
    year = String(d.getUTCFullYear());
    month = String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  const dir = month
    ? path.join(config.receiptsDir, year, month)
    : path.join(config.receiptsDir, year);
  fs.mkdirSync(dir, { recursive: true });

  const ext = pickExtension(originalName, mimeType);
  const storedPath = path.join(dir, `${hash}${ext}`);
  if (!fs.existsSync(storedPath)) {
    fs.writeFileSync(storedPath, buffer);
  }

  return {
    hash,
    storedPath,
    relPath: path.relative(config.receiptsDir, storedPath),
  };
}

module.exports = { storeFile, sha256, pickExtension };
