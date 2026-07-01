'use strict';

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const config = require('../config');
const { ingestFile } = require('../pipeline/ingest');

const ACCEPTED = /\.(pdf|png|jpe?g|webp|gif|tiff?)$/i;

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

// Watch a local folder; every receipt file dropped in is auto-imported.
// Dedupe by content hash means re-scanning existing files is harmless.
function startFolderWatcher() {
  const dir = config.watchDir;
  if (!dir) return null;
  if (!fs.existsSync(dir)) {
    console.warn(`[folder] WATCH_DIR does not exist: ${dir} — watcher disabled.`);
    return null;
  }

  console.log(`  Watching folder: ${dir}`);
  const watcher = chokidar.watch(dir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    depth: 3,
  });

  watcher.on('add', async (filePath) => {
    if (!ACCEPTED.test(filePath)) return;
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const { receipt, duplicate } = await ingestFile(buffer, {
        originalName: path.basename(filePath),
        mimeType: MIME_BY_EXT[ext] || null,
        source: 'folder',
      });
      if (!duplicate) {
        console.log(`[folder] imported ${path.basename(filePath)} → receipt #${receipt.id}`);
      }
    } catch (err) {
      console.warn(`[folder] failed to import ${filePath}: ${err.message}`);
    }
  });

  return watcher;
}

module.exports = { startFolderWatcher };
