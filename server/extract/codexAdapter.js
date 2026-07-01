'use strict';

const { execFile } = require('child_process');
const config = require('../config');
const { EXTRACTION_PROMPT, parseExtraction } = require('./prompt');

// Build the argv by substituting {image} and {prompt} placeholders in the
// configured args template. This keeps the exact Codex invocation overridable
// (flags vary by version — confirm with `codex exec --help`).
function buildArgs(imagePath) {
  return config.extractor.args.map((arg) =>
    arg.replace('{image}', imagePath).replace('{prompt}', EXTRACTION_PROMPT)
  );
}

// Run the Codex CLI against an image path and parse structured JSON from stdout.
// Returns { fields, raw } on success. Throws on spawn/parse failure so the
// pipeline can fall back to the next extractor.
function extractWithCodex(imagePath) {
  return new Promise((resolve, reject) => {
    const args = buildArgs(imagePath);
    execFile(
      config.extractor.command,
      args,
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === 'ENOENT') {
            return reject(
              new Error(
                `Codex CLI not found (command: "${config.extractor.command}"). ` +
                  `Install it or set EXTRACTOR=tesseract/manual.`
              )
            );
          }
          return reject(new Error(`Codex CLI failed: ${err.message}\n${stderr || ''}`));
        }
        const fields = parseExtraction(stdout);
        if (!fields) {
          return reject(
            new Error('Codex output did not contain parseable JSON.\n' + stdout)
          );
        }
        resolve({ fields, raw: stdout.trim() });
      }
    );
  });
}

module.exports = { extractWithCodex, buildArgs };
