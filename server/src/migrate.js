const fs = require('fs');
const path = require('path');
const pool = require('./db');

/**
 * Runs all SQL migration files in the migrations/ directory in sorted order.
 * Uses a `schema_migrations` tracking table so each file only runs once.
 * Graceful: logs errors but does NOT crash the server.
 */
async function runMigrations() {
  const migrationsDir = path.resolve(__dirname, '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('[migrate] No migrations directory found – skipping.');
    return;
  }

  // Ensure tracking table exists
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.warn('[migrate] Could not create schema_migrations table:', err.message);
    console.warn('[migrate] Skipping migrations (database may not be ready).');
    return;
  }

  let appliedSet;
  try {
    const { rows: applied } = await pool.query('SELECT filename FROM schema_migrations');
    appliedSet = new Set(applied.map((r) => r.filename));
  } catch (err) {
    console.warn('[migrate] Could not read schema_migrations:', err.message);
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`[migrate] Applying migration: ${file}`);
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      console.log(`[migrate]   ✓ ${file} applied`);
    } catch (err) {
      // Log but do NOT crash — the server should still start
      console.error(`[migrate]   ✗ ${file} failed:`, err.message);
      console.error('[migrate] Continuing server startup despite migration error.');
      // Mark it so we don't retry endlessly on restart
      // (user can manually fix and re-run with npm run migrate)
      break;
    }
  }
}

module.exports = { runMigrations };
