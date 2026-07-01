'use strict';

const express = require('express');
const multer = require('multer');
const { ingestFile } = require('../pipeline/ingest');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per receipt
});

// POST /api/receipts/upload — one or more files (field name "files").
router.post('/upload', upload.array('files', 20), async (req, res) => {
  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: 'no files uploaded' });
  }
  const results = [];
  for (const file of req.files) {
    try {
      const { receipt, duplicate } = await ingestFile(file.buffer, {
        originalName: file.originalname,
        mimeType: file.mimetype,
        source: 'upload',
      });
      results.push({ receipt, duplicate });
    } catch (err) {
      results.push({ error: err.message, filename: file.originalname });
    }
  }
  res.json({ results });
});

module.exports = router;
