'use strict';

const express = require('express');
const alerts = require('../lib/alerts');

const router = express.Router();
router.get('/', (req, res) => res.json({ alerts: alerts.list({ unackedOnly: req.query.unacked === '1', limit: req.query.limit }), unacked: alerts.unackedCount() }));
router.post('/ack', (req, res) => res.json({ acked: alerts.ack(req.body?.ids === 'all' ? 'all' : req.body?.ids) }));

module.exports = router;
