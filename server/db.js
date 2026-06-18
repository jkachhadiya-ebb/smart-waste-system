const { Pool } = require('pg');

// Managed Postgres providers (Render, Neon, Supabase, Railway, …) require TLS.
// Enable it when DATABASE_SSL=true or the connection string asks for sslmode=require.
// Local development (no flag) is unaffected.
function resolveSsl() {
  const url = process.env.DATABASE_URL || '';
  const wantsSsl = process.env.DATABASE_SSL === 'true' || /sslmode=require/i.test(url);
  return wantsSsl ? { rejectUnauthorized: false } : false;
}

function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl: resolveSsl() };
  }
  return {
    host: process.env.PG_HOST,
    port: process.env.PG_PORT ? Number(process.env.PG_PORT) : undefined,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: resolveSsl(),
  };
}

const pool = new Pool(buildPoolConfig());

module.exports = pool;
