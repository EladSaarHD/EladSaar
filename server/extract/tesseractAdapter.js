'use strict';

const { parseExtraction } = require('./prompt');

// Offline OCR fallback. tesseract.js is an optionalDependency — if it isn't
// installed, this adapter reports unavailable and the pipeline drops to manual.
let _tesseract = null;
function loadTesseract() {
  if (_tesseract !== null) return _tesseract;
  try {
    _tesseract = require('tesseract.js');
  } catch {
    _tesseract = false;
  }
  return _tesseract;
}

// Heuristic parse of raw OCR text into our field shape. OCR gives no JSON, so
// we pull a total, a date, and guess the vendor from the first line.
function heuristicFields(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Vendor: first non-numeric line.
  const vendor = lines.find((l) => /[a-z]/i.test(l) && !/^\d/.test(l)) || null;

  // Total: largest currency-looking number near a "total" keyword, else largest.
  let total = null;
  const amountRe = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/g;
  const totalLine = lines.find((l) => /total|amount due|balance/i.test(l));
  const scanLine = totalLine || lines.join(' ');
  const amounts = (scanLine.match(amountRe) || []).map((s) =>
    parseFloat(s.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'))
  );
  if (amounts.length) total = Math.max(...amounts);

  // Date: first ISO / dd-mm-yyyy / mm/dd/yyyy match.
  let date = null;
  const iso = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  const dmy = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (iso) {
    date = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  } else if (dmy) {
    const yr = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    date = `${yr}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  return parseExtraction(
    JSON.stringify({
      vendor,
      receipt_date: date,
      total_amount: total,
      currency: /€|eur/i.test(text) ? 'EUR' : /£|gbp/i.test(text) ? 'GBP' : /₪|ils|nis/i.test(text) ? 'ILS' : /\$|usd/i.test(text) ? 'USD' : null,
      tax_amount: null,
      tax_rate: null,
      category: null,
      payment_method: null,
    })
  );
}

// If OCR fails once (e.g. it can't download language data offline), stop
// trying so we don't repeatedly spawn failing workers — degrade to manual.
let _disabled = false;

async function extractWithTesseract(imagePath) {
  const T = loadTesseract();
  if (!T || _disabled) {
    throw new Error(
      'tesseract.js unavailable. Run `npm install tesseract.js` (needs one-time network access for language data) or use EXTRACTOR=manual.'
    );
  }
  try {
    // Bound OCR so a stuck worker can't hang a request.
    const recognize = T.recognize(imagePath, 'eng');
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OCR timed out')), 60000)
    );
    const {
      data: { text },
    } = await Promise.race([recognize, timeout]);
    const fields = heuristicFields(text || '');
    return { fields, raw: text || '' };
  } catch (err) {
    _disabled = true; // don't retry a broken OCR setup for the rest of this run
    throw err;
  }
}

function isAvailable() {
  return Boolean(loadTesseract()) && !_disabled;
}

module.exports = { extractWithTesseract, isAvailable, heuristicFields };
