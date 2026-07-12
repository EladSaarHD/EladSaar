'use strict';

const express = require('express');
const config = require('../config');
require('./db'); // initialize schema on boot

const apiKey = require('./middleware/apiKey');
const errorHandler = require('./middleware/errorHandler');
const healthRouter = require('./routes/health');
const searchRouter = require('./routes/search');
const pagesRouter = require('./routes/pages');
const adsRouter = require('./routes/ads');

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

app.get('/', (req, res) =>
  res.type('html').send(
    '<h1>Ad Library API</h1>' +
      '<p>Personal Meta Ad Library scraper. See the README for endpoints.</p>' +
      '<ul>' +
      '<li><code>GET /api/search?q=nike&amp;country=US</code></li>' +
      '<li><code>GET /api/pages/:pageId/ads?country=US</code></li>' +
      '<li><code>GET /api/ads/:id?page_id=…&amp;country=US</code></li>' +
      '<li><a href="/api/health">/api/health</a></li>' +
      '</ul>'
  )
);

// 404 for unknown /api routes.
app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Unknown endpoint' } });
});

app.use(errorHandler);

// Bind to localhost only — this is a private, single-user tool.
const server = app.listen(config.port, config.bindHost, () => {
  console.log(`\n  Ad Library API → http://${config.bindHost}:${config.port}`);
  console.log(`  Data dir:  ${config.dataDir}`);
  console.log(`  Auth:      ${config.apiKey ? 'X-API-Key required' : 'open (no API key set)'}`);
  console.log(`  Country:   ${config.defaultCountry}  ·  cache TTL ${config.cacheTtlSeconds}s\n`);
});

module.exports = server;
