'use strict';

const { getPool } = require('../db/pool');

/**
 * Automatically deletes any upload batch (and all cascading DB data)
 * that has NOT been created, modified, or regenerated within the last 10 days.
 *
 * @param {number} daysLimit - number of retention days (default: 10)
 * @returns {Promise<number>} - number of deleted expired batches
 */
async function autoCleanupExpiredBatches(daysLimit = 10) {
  try {
    const pool = getPool();

    // 1. Ensure updated_at column exists in upload_batches table
    try {
      await pool.query(`
        ALTER TABLE upload_batches 
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      `);
    } catch (_alterErr) {
      // Ignore if column already exists or syntax unsupported
    }

    // 2. Select batches older than daysLimit (10 days)
    const [expired] = await pool.query(
      `SELECT id, filename, semester, COALESCE(updated_at, created_at) AS last_modified
       FROM upload_batches
       WHERE COALESCE(updated_at, created_at) < NOW() - INTERVAL ? DAY`,
      [daysLimit]
    );

    if (expired.length > 0) {
      const ids = expired.map(b => b.id);
      console.log(`[auto-cleanup] Found ${ids.length} expired batch(es) (> ${daysLimit} days old):`, ids);

      await pool.query(
        'DELETE FROM upload_batches WHERE id IN (?)',
        [ids]
      );

      console.log(`[auto-cleanup] Successfully deleted ${ids.length} expired batch(es).`);
    }

    return expired.length;
  } catch (err) {
    console.error('[auto-cleanup] Error cleaning up expired batches:', err.message);
    return 0;
  }
}

/**
 * Touch a batch to refresh its updated_at timestamp whenever it is modified
 * or regenerated.
 *
 * @param {number} batchId
 */
async function touchBatch(batchId) {
  if (!batchId || !Number.isInteger(Number(batchId))) return;
  try {
    const pool = getPool();
    await pool.query(
      'UPDATE upload_batches SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [batchId]
    );
  } catch (err) {
    console.error(`[touchBatch] Failed to update timestamp for batch ${batchId}:`, err.message);
  }
}

module.exports = {
  autoCleanupExpiredBatches,
  touchBatch,
};
