'use strict';

const express = require('express');
const crypto = require('crypto');
const { getPool } = require('../db/pool');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'routine_app_jwt_secret_key_2026_xyz';

function generateToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const inputHash = hashPassword(password);

    // 1. Try DB lookup first
    let userRow = null;
    try {
      const [rows] = await getPool().query(
        'SELECT id, email, password_hash, role FROM users WHERE email = ?',
        [email]
      );
      if (rows.length > 0) {
        userRow = rows[0];
      }
    } catch (_e) {
      // Database not reachable or table not ready
    }

    if (userRow) {
      if (userRow.password_hash !== inputHash) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }
      const token = generateToken({ id: userRow.id, email: userRow.email, role: userRow.role });
      return res.status(200).json({
        success: true,
        token,
        user: { id: userRow.id, email: userRow.email, role: userRow.role },
      });
    }

    // 2. Secure env fallback (compares hashed input with env credentials hashed on the fly)
    const envAdminEmail = process.env.ADMIN_EMAIL || 'cse_admin@gstu.edu.bd';
    const envAdminPassword = process.env.ADMIN_PASSWORD || 'cse_admin13579';

    if (email === envAdminEmail && inputHash === hashPassword(envAdminPassword)) {
      const token = generateToken({ id: 1, email: envAdminEmail, role: 'admin' });
      return res.status(200).json({
        success: true,
        token,
        user: { id: 1, email: envAdminEmail, role: 'admin' },
      });
    }

    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
