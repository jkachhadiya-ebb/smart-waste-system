const { Pool } = require('pg');

function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.PG_HOST,
    port: process.env.PG_PORT ? Number(process.env.PG_PORT) : undefined,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
  };
}

const pool = new Pool(buildPoolConfig());

module.exports = pool;
