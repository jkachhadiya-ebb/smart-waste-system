const express = require('express');
const pool = require('../db');
const auth = require('../authMiddleware');

const router = express.Router();

async function ensureNotificationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title varchar(200) NOT NULL,
      message text NOT NULL,
      event_key varchar(80),
      meta jsonb,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      read_at timestamptz
    )
  `);

  const alterStatements = [
    "ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS title varchar(200)",
    "ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS message text",
    "ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS event_key varchar(80)",
    "ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS meta jsonb",
    "ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW()",
    "ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS read_at timestamptz",
  ];
  for (const stmt of alterStatements) {
    await pool.query(stmt);
  }

  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications (user_id, created_at DESC)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread ON user_notifications (user_id, read_at)'
  );
}

function mapNotification(row) {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    eventKey: row.event_key || null,
    meta: row.meta || null,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

router.get('/', auth, async (req, res) => {
  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  try {
    await ensureNotificationsTable();
    const [listResult, unreadResult] = await Promise.all([
      pool.query(
        `SELECT id, title, message, event_key, meta, created_at, read_at
         FROM user_notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS unread_count
         FROM user_notifications
         WHERE user_id = $1 AND read_at IS NULL`,
        [req.user.id]
      ),
    ]);

    res.json({
      notifications: listResult.rows.map(mapNotification),
      unreadCount: unreadResult.rows[0]?.unread_count ?? 0,
    });
  } catch (err) {
    console.error('Notifications fetch failed', err);
    res.status(500).json({ message: 'Could not load notifications' });
  }
});

router.post('/', auth, async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const message = String(req.body?.message || '').trim();
  const rawEventKey = req.body?.eventKey ?? req.body?.event_key ?? '';
  const eventKey = String(rawEventKey || '').trim() || null;
  const meta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : null;

  if (!title || !message) {
    return res.status(400).json({ message: 'Title and message are required' });
  }
  if (title.length > 200) {
    return res.status(400).json({ message: 'Title too long' });
  }
  if (message.length > 2000) {
    return res.status(400).json({ message: 'Message too long' });
  }
  if (eventKey && eventKey.length > 80) {
    return res.status(400).json({ message: 'Event key too long' });
  }

  try {
    await ensureNotificationsTable();
    const { rows } = await pool.query(
      `INSERT INTO user_notifications (user_id, title, message, event_key, meta)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, message, event_key, meta, created_at, read_at`,
      [req.user.id, title, message, eventKey, meta]
    );

    res.json({ notification: mapNotification(rows[0]) });
  } catch (err) {
    console.error('Notification create failed', err);
    res.status(500).json({ message: 'Could not create notification' });
  }
});

router.post('/mark-read', auth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];

  if (!ids.length) {
    return res.status(400).json({ message: 'Notification ids are required' });
  }

  try {
    await ensureNotificationsTable();
    const result = await pool.query(
      `UPDATE user_notifications
       SET read_at = NOW()
       WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`,
      [req.user.id, ids]
    );
    res.json({ updated: result.rowCount || 0 });
  } catch (err) {
    console.error('Notifications mark read failed', err);
    res.status(500).json({ message: 'Could not mark notifications read' });
  }
});

router.post('/mark-all-read', auth, async (req, res) => {
  try {
    await ensureNotificationsTable();
    const result = await pool.query(
      `UPDATE user_notifications
       SET read_at = NOW()
       WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ updated: result.rowCount || 0 });
  } catch (err) {
    console.error('Notifications mark all read failed', err);
    res.status(500).json({ message: 'Could not mark notifications read' });
  }
});

module.exports = router;
