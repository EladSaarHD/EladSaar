'use strict';

// The structured-extraction contract shared by every adapter.
// Adapters ask the AI to return ONLY this JSON shape.
const FIELDS = [
  'vendor',
  'receipt_date',
  'total_amount',
  'currency',
  'tax_amount',
  'tax_rate',
  'category',
  'payment_method',
];

const EXTRACTION_PROMPT = [
  'You are a receipt/invoice data extractor.',
  'Look at the attached receipt or invoice and extract its fields.',
  'Respond with ONLY a single JSON object and no other text, no markdown fences.',
  'Use this exact shape:',
  '{',
  '  "vendor": string|null,            // merchant / supplier name',
  '  "receipt_date": string|null,      // ISO date YYYY-MM-DD',
  '  "total_amount": number|null,      // grand total incl. tax',
  '  "currency": string|null,          // ISO code e.g. USD, EUR, ILS',
  '  "tax_amount": number|null,        // tax/VAT amount',
  '  "tax_rate": number|null,          // tax percent e.g. 17',
  '  "category": string|null,          // e.g. Travel, Meals, Software, Office',
  '  "payment_method": string|null     // e.g. Visa ****1234, Cash',
  '}',
  'If a field is not present, use null. Do not invent values.',
].join('\n');

// Given raw text (which may include prose or code fences), pull the first
// valid JSON object and coerce it to our schema. Returns null on failure.
function parseExtraction(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  // Try fenced block first, then the first {...} span.
  let candidate = null;
  const fence = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1];
  if (!candidate) {
    const first = rawText.indexOf('{');
    const last = rawText.lastIndexOf('}');
    if (first !== -1 && last > first) candidate = rawText.slice(first, last + 1);
  }
  if (!candidate) return null;

  let obj;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;

  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const str = (v) => (v === null || v === undefined ? null : String(v).trim() || null);

  return {
    vendor: str(obj.vendor),
    receipt_date: str(obj.receipt_date),
    total_amount: num(obj.total_amount),
    currency: str(obj.currency),
    tax_amount: num(obj.tax_amount),
    tax_rate: num(obj.tax_rate),
    category: str(obj.category),
    payment_method: str(obj.payment_method),
  };
}

module.exports = { FIELDS, EXTRACTION_PROMPT, parseExtraction };
