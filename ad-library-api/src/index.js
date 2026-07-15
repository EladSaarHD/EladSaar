'use strict';

const express = require('express');
const path = require('path');
const config = require('../config');
require('./db'); // initialize schema on boot

const apiKey = require('./middleware/apiKey');
const errorHandler = require('./middleware/errorHandler');
const healthRouter = require('./routes/health');
const searchRouter = require('./routes/search');
const pagesRouter = require('./routes/pages');
const adsRouter = require('./routes/ads');
const scansRouter = require('./routes/scans');

// A scraping error must never take down the server — log and keep serving.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] kept server alive:', err && err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error(
    '[unhandledRejection] kept server alive:',
    reason && reason.message ? reason.message : reason
  );
});

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// Optional API-key gate (health stays open).
app.use(apiKey);

app.use('/api/health', healthRouter);
app.use('/api/search', searchRouter);
app.use('/api/pages', pagesRouter);
app.use('/api/ads', adsRouter);
app.use('/api/scans', scansRouter);

// 404 for unknown /api routes.
app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Unknown endpoint' } });
});

// Production React UI. Client-side routes fall back to index.html.
const uiDist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(uiDist, { maxAge: '1h', index: false }));
app.get('*', (req, res) => res.sendFile(path.join(uiDist, 'index.html')));

app.use(errorHandler);

// Bind to localhost only — this is a private, single-user tool.
const server = app.listen(config.port, config.bindHost, () => {
  console.log(`\n  Ad Library API → http://${config.bindHost}:${config.port}`);
  console.log(`  Data dir:  ${config.dataDir}`);
  console.log(`  Auth:      ${config.apiKey ? 'X-API-Key required' : 'open (no API key set)'}`);
  console.log(`  Country:   ${config.defaultCountry}  ·  cache TTL ${config.cacheTtlSeconds}s\n`);
});

module.exports = server;
