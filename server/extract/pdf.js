'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let _pdftoppmChecked = false;
let _pdftoppmAvailable = false;

// Detect poppler's pdftoppm once. Used to render a PDF's first page to PNG
// so image-only extractors (Codex, Tesseract) can read PDF receipts.
function hasPdftoppm() {
  if (_pdftoppmChecked) return Promise.resolve(_pdftoppmAvailable);
  return new Promise((resolve) => {
    execFile('pdftoppm', ['-v'], (err) => {
      _pdftoppmChecked = true;
      // pdftoppm -v prints version to stderr and exits non-zero on some builds;
      // treat "command found" (no ENOENT) as available.
      _pdftoppmAvailable = !(err && err.code === 'ENOENT');
      resolve(_pdftoppmAvailable);
    });
  });
}

// Render page 1 of a PDF to a temp PNG. Returns the PNG path or null.
// Caller is responsible for cleanup via cleanup().
async function pdfFirstPageToPng(pdfPath) {
  if (!(await hasPdftoppm())) return null;
  const outPrefix = path.join(
    os.tmpdir(),
    `receiptify-${path.basename(pdfPath, '.pdf')}`
  );
  return new Promise((resolve) => {
    execFile(
      'pdftoppm',
      ['-png', '-f', '1', '-l', '1', '-r', '200', '-singlefile', pdfPath, outPrefix],
      (err) => {
        if (err) return resolve(null);
        const png = `${outPrefix}.png`;
        resolve(fs.existsSync(png) ? png : null);
      }
    );
  });
}

function cleanup(filePath) {
  if (filePath && filePath.startsWith(os.tmpdir())) {
    fs.rm(filePath, { force: true }, () => {});
  }
}

module.exports = { hasPdftoppm, pdfFirstPageToPng, cleanup };
