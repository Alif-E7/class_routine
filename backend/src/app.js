'use strict';

const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/health');
const uploadRoutes = require('./routes/upload');
const scheduleRoutes = require('./routes/schedule');
const batchesRoutes = require('./routes/batches');
const exportRoutes = require('./routes/export');
const editRoutes = require('./routes/edit');
const authRoutes = require('./routes/auth');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Simple request log so we can see boot activity.
  app.use((req, _res, next) => {
    if (process.env.LOG !== '0') {
      console.log(`${new Date().toISOString()}  ${req.method} ${req.url}`);
    }
    next();
  });

  app.use('/api/health', healthRoutes);
  app.use('/api/upload', uploadRoutes);
  // batches routes must mount BEFORE schedule routes since both use /:id,
  // and Express matches in declaration order. We put the collection + detail
  // endpoints first, then the sub-routes (generate / schedule) on the same path.
  app.use('/api/batches', batchesRoutes);
  app.use('/api/batches', scheduleRoutes);
  app.use('/api/batches', exportRoutes);
  app.use('/api/batches', editRoutes);
  app.use('/api/auth', authRoutes);

  // Multer errors (e.g. file-too-big, wrong field name) throw inside the
  // upload route. Map them to clean 4xx instead of letting them fall to the
  // generic 500 handler below.
  app.use((err, _req, res, next) => {
    if (err && err.name === 'MulterError') {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({
        success: false,
        code: err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
        message: err.message,
      });
    }
    // Wrong-extension / unsupported media from upload.js's fileFilter.
    if (err && /Only \.xlsx files are accepted/i.test(err.message || '')) {
      return res.status(415).json({
        success: false,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: err.message,
      });
    }
    return next(err);
  });

  // 404
  app.use((req, res) => {
    res.status(404).json({ success: false, message: `No route for ${req.method} ${req.url}` });
  });

  // Error handler — keeps the response shape consistent.
  // Maps database transport / credential failures to a clean 503 so the
  // admin UI can show "Database unreachable — check DB_HOST/USER/PASSWORD"
  // instead of a generic 500/502 that proxy layers amplify.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('UNHANDLED ERROR:', err);
    const dbError = mapDbError(err);
    if (dbError) {
      return res.status(503).json({
        success: false,
        code: dbError.code,
        message: dbError.message,
        detail: err.code || err.message,
      });
    }
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      message: err.message || 'Server error',
      code: err.code || null,
    });
  });

  return app;
}

/**
 * If `err` looks like a database transport / auth failure, return a
 * short, actionable description. Otherwise return null so the caller
 * falls through to the generic handler.
 *
 * Recognised mysql2 codes:
 *   ER_ACCESS_DENIED_ERROR  — wrong user/password (or missing GRANT)
 *   ER_BAD_DB_ERROR         — database name doesn't exist
 *   ECONNREFUSED            — MySQL not running or wrong port
 *   ETIMEDOUT / EHOSTUNREACH — network unreachable
 *   ENOTFOUND               — DNS lookup failed for DB_HOST
 *   PROTOCOL_CONNECTION_LOST — connection dropped mid-query
 */
function mapDbError(err) {
  if (!err) return null;
  const code = err.code || '';
  const knownDbCodes = new Set([
    'ER_ACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENOTFOUND',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'POOL_CLOSED',
  ]);
  if (!knownDbCodes.has(code)) return null;

  if (code === 'ER_ACCESS_DENIED_ERROR') {
    return {
      code: 'DATABASE_AUTH_FAILED',
      message:
        'MySQL rejected the credentials in backend/.env. Run the one-time GRANT ' +
        'step from the README (CREATE USER \'routine_app\'@\'localhost\' ' +
        'IDENTIFIED BY ...; GRANT ALL ON routine_generator.* TO ...) and ' +
        'make sure DB_PASSWORD in .env matches.',
    };
  }
  if (code === 'ER_BAD_DB_ERROR') {
    return {
      code: 'DATABASE_NOT_FOUND',
      message:
        'The configured DB_NAME does not exist on the MySQL server. ' +
        'Run `npm run migrate` from backend/ — the migration runner ' +
        'creates the database automatically.',
    };
  }
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') {
    return {
      code: 'DATABASE_UNREACHABLE',
      message:
        `Could not reach the MySQL server at ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}. ` +
        'Is MySQL running? Check DB_HOST/DB_PORT in backend/.env.',
    };
  }
  return {
    code: 'DATABASE_TRANSPORT_ERROR',
    message: 'The database connection was lost mid-request. Please retry.',
  };
}

module.exports = { createApp };