const jwt = require('jsonwebtoken');
const pool = require('./db');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token' });
  }

  const token = authHeader.split(' ')[1];
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }

  if (!payload?.id) {
    return res.status(401).json({ message: 'Invalid token payload' });
  }

  const sessionId = payload.sessionId;
  let sessionInfo = null;

  if (sessionId) {
    try {
      const sessionResult = await pool.query(
        `SELECT revoked_at, expires_at
         FROM user_sessions
         WHERE id = $1 AND user_id = $2`,
        [sessionId, payload.id]
      );
      sessionInfo = sessionResult.rows[0];
    } catch (err) {
      console.error('Session lookup failed', err);
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!sessionInfo) {
      return res.status(401).json({ message: 'Session not found' });
    }

    if (sessionInfo.revoked_at) {
      return res.status(401).json({ message: 'Session revoked' });
    }

    if (sessionInfo.expires_at && new Date(sessionInfo.expires_at) < new Date()) {
      return res.status(401).json({ message: 'Session expired' });
    }

    try {
      await pool.query(
        'UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1',
        [sessionId]
      );
    } catch (err) {
      console.error('Failed to refresh session last seen', err);
    }
  }

  let municipalityId = payload.municipality_id;
  let role = payload.role;

  if (!municipalityId || !role) {
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.id]);
      if (rows[0]) {
        if (rows[0].municipality_id !== undefined) {
          municipalityId = municipalityId || rows[0].municipality_id;
        }
        if (rows[0].role !== undefined) {
          role = role || rows[0].role;
        }
      }
    } catch (err) {
      console.error('Failed to hydrate user', err);
    }
  }

  req.user = {
    id: payload.id,
    username: payload.username,
    municipality_id: municipalityId,
    role,
    sessionId: sessionId || null,
  };

  next();
}

module.exports = authMiddleware;
