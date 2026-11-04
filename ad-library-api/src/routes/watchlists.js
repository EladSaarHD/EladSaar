'use strict';

const express = require('express');
const watchlists = require('../lib/watchlists');

const router = express.Router();
const fail = (res, error) => res.status(error.status || 400).json({ error: { code: error.code || 'invalid_watchlist', message: error.message } });
const notFound = (res) => res.status(404).json({ error: { code: 'not_found', message: 'Watchlist not found' } });

router.get('/', (req, res) => res.json({ watchlists: watchlists.list() }));
router.post('/', (req, res) => { try { res.status(201).json(watchlists.create(req.body)); } catch (error) { fail(res, error); } });
router.patch('/:id', (req, res) => { try { const w = watchlists.update(req.params.id, req.body || {}); return w ? res.json(w) : notFound(res); } catch (error) { return fail(res, error); } });
router.delete('/:id', (req, res) => (watchlists.remove(req.params.id) ? res.json({ ok: true }) : notFound(res)));
router.post('/:id/run', (req, res) => { const w = watchlists.runNow(req.params.id); return w ? res.json(w) : notFound(res); });

module.exports = router;
