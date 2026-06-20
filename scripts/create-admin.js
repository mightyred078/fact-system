require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db/db');

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.log('Usage: node scripts/create-admin.js <username> <password>');
  console.log('   or: npm run create-admin -- <username> <password>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);

// Only one admin account is supported — replace any existing one.
db.prepare('DELETE FROM admin_users').run();
db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(username, hash);

console.log(`Admin account "${username}" created. You can now log in at /admin.html`);
