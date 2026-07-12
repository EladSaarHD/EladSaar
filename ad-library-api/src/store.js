'use strict';

// Single cache instance shared by all routes, backed by the SQLite database.
const db = require('./db');
const { createCache } = require('./lib/cache');

const cache = createCache(db);

// Drop expired rows on boot so the file doesn't grow unbounded.
cache.sweepExpired();

module.exports = { db, cache };
