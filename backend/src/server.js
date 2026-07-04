'use strict';

require('dotenv').config();
const { createApp } = require('./app');
const { closePool } = require('./db/pool');

const port = Number(process.env.PORT) || 4000;
const app = createApp();

const server = app.listen(port, () => {
  console.log(`[backend] listening on http://localhost:${port}`);
  console.log(`         health: GET /api/health`);
  console.log(`         upload: POST /api/upload  (multipart .xlsx)`);
});

async function shutdown(signal) {
  console.log(`\n[backend] ${signal} received, shutting down…`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  // Hard exit after 5s if server.close hangs.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));