'use strict';

const config = require('../config');
const { extractWithCodex } = require('./codexAdapter');
const tesseract = require('./tesseractAdapter');
const { pdfFirstPageToPng, cleanup } = require('./pdf');

// Resolve an image path to feed an image-only extractor. PDFs are rendered to
// PNG via poppler; if that isn't available we return null (→ manual).
async function resolveImagePath(storedPath, mimeType) {
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(storedPath)) {
    const png = await pdfFirstPageToPng(storedPath);
    return { imagePath: png, temp: Boolean(png) };
  }
  if ((mimeType && mimeType.startsWith('image/')) || /\.(png|jpe?g|webp|gif|tiff?)$/i.test(storedPath)) {
    return { imagePath: storedPath, temp: false };
  }
  return { imagePath: null, temp: false };
}

// Extract structured fields from a stored receipt file.
// Returns { fields, extractor, raw }. Never throws — falls back to manual so
// the file is never lost. `extractor` records which engine actually ran.
async function extract({ storedPath, mimeType }) {
  const mode = config.extractor.mode;
  if (mode === 'manual') {
    return { fields: {}, extractor: 'manual', raw: null };
  }

  const { imagePath, temp } = await resolveImagePath(storedPath, mimeType);
  if (!imagePath) {
    return {
      fields: {},
      extractor: 'manual',
      raw: null,
      note: 'Could not produce an image to extract (PDF rendering unavailable?).',
    };
  }

  try {
    if (mode === 'codex') {
      const { fields, raw } = await extractWithCodex(imagePath);
      return { fields, extractor: 'codex', raw };
    }
    if (mode === 'tesseract') {
      const { fields, raw } = await tesseract.extractWithTesseract(imagePath);
      return { fields, extractor: 'tesseract', raw };
    }
  } catch (primaryErr) {
    // Codex failed → try Tesseract if present → else manual.
    if (mode === 'codex' && tesseract.isAvailable()) {
      try {
        const { fields, raw } = await tesseract.extractWithTesseract(imagePath);
        return {
          fields,
          extractor: 'tesseract',
          raw,
          note: `Codex failed, used OCR fallback: ${primaryErr.message}`,
        };
      } catch (ocrErr) {
        return { fields: {}, extractor: 'manual', raw: null, note: ocrErr.message };
      }
    }
    return { fields: {}, extractor: 'manual', raw: null, note: primaryErr.message };
  } finally {
    if (temp) cleanup(imagePath);
  }

  return { fields: {}, extractor: 'manual', raw: null };
}

module.exports = { extract };
