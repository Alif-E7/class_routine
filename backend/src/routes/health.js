'use strict';

const express = require('express');
const router = express.Router();
const { getPool } = require('../db/pool');

// GET /api/health — quick liveness check + DB ping.
router.get('/', async (_req, res) => {
  try {
    await getPool().query('SELECT 1 AS ok');
    return res.json({ status: 'ok', db: 'ok', uptime_seconds: Math.round(process.uptime()) });
  } catch (err) {
    // DB not reachable is a soft warning here — the build-prompt asks only
    // for a health-check route that confirms the app boots. DB comes later.
    return res.json({ status: 'ok', db: 'unreachable', db_error: err.code || err.message });
  }
});

module.exports = router;