'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config');
require('./db'); // initialize schema on boot

const symbolsRouter = require('./routes/symbols');
const quoteRouter = require('./routes/quote');
const candlesRouter = require('./routes/candles');
const companyRouter = require('./routes/company');
const watchlistRouter = require('./routes/watchlist');

// Safety net: a bad upstream response or transient network error must never
// take down the whole server — log it and keep serving. Single-user local tool.
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
app.use(express.json());

// Health/status — also reports whether an API key is configured.
app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    version: '0.1.0',
    provider: config.provider.name,
    hasApiKey: Boolean(config.provider.apiKey),
  })
);

app.use('/api/symbols', symbolsRouter);
app.use('/api/quote', quoteRouter);
app.use('/api/candles', candlesRouter);
app.use('/api/company', companyRouter);
app.use('/api/watchlist', watchlistRouter);

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
        '<h1>TradeView API is running</h1>' +
          '<p>The web UI is not built yet. Run <code>npm run build</code> ' +
          'then reload, or <code>npm run dev</code> for the Vite dev server.</p>' +
          '<p>API health: <a href="/api/health">/api/health</a></p>'
      )
  );
}

// Bind to localhost only — this is a private, single-user tool.
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`\n  TradeView → http://localhost:${config.port}`);
  console.log(`  Provider:  ${config.provider.name}`);
  if (!config.provider.apiKey) {
    console.log('  ⚠  No API key set. Add TWELVEDATA_API_KEY to .env for live data.');
  }
});

module.exports = server;
