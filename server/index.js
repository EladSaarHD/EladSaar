'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config');
require('./db'); // initialize schema on boot

const { router: receiptsRouter } = require('./routes/receipts');
const uploadRouter = require('./sources/uploadRouter');
const reportsRouter = require('./routes/reports');
const exportRouter = require('./routes/export');
const settingsRouter = require('./routes/settings');
const { startFolderWatcher } = require('./sources/folderWatcher');
const { startEmailPoller } = require('./sources/emailPoller');

// Safety net: extraction can shell out to external CLIs and spawn worker
// threads (Codex, Tesseract). A failure in one of those must never take down
// the whole server — log it and keep serving. This is a single-user local tool.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] kept server alive:', err && err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] kept server alive:', reason && reason.message ? reason.message : reason);
});

const app = express();
app.use(express.json());

// Health/status.
app.get('/api/health', (req, res) => res.json({ ok: true, version: '0.1.0' }));

// Upload lives under /api/receipts/upload; mount before the :id routes.
app.use('/api/receipts', uploadRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/export', exportRouter);
app.use('/api/settings', settingsRouter);

// Serve the built SPA if present; otherwise show a hint.
const webDist = path.join(config.root, 'web', 'dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (req, res) =>
    res.sendFile(path.join(webDist, 'index.html'))
  );
} else {
  app.get('/', (req, res) =>
    res
      .type('html')
      .send(
        '<h1>Receiptify API is running</h1>' +
          '<p>The web UI is not built yet. Run <code>npm run build</code> ' +
          'then reload, or <code>npm run dev</code> for the dev server on Vite.</p>' +
          '<p>API health: <a href="/api/health">/api/health</a></p>'
      )
  );
}

// Bind to localhost only — this is a private, single-user tool.
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`\n  Receiptify → http://localhost:${config.port}`);
  console.log(`  Data dir:   ${config.dataDir}`);
  console.log(`  Extractor:  ${config.extractor.mode}`);

  // Background ingestion sources (safe no-ops when not configured).
  startFolderWatcher();
  startEmailPoller();
});

module.exports = server;
