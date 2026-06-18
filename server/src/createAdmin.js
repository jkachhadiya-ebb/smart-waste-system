// server/src/createAdmin.js
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

async function createAdmin() {
  const username = 'admin';
  const email = 'admin@example.com';
  const plainPassword = 'admin'; // this will be your login password

  try {
    const hash = await bcrypt.hash(plainPassword, 10);

    // upsert: if admin exists, update; otherwise insert
    const result = await pool.query(
      `
      INSERT INTO users (username, password_hash, email, role)
      VALUES ($1, $2, $3, 'admin')
      ON CONFLICT (username)
      DO UPDATE SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email, role = EXCLUDED.role
      RETURNING id, username, email, role;
      `,
      [username, hash, email]
    );

    console.log('Admin user ready:', result.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('Error creating admin:', err);
    process.exit(1);
  }
}

createAdmin();
