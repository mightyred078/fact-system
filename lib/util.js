const db = require('../db/db');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion

function randomCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

function generateOrderCode() {
  const checkStmt = db.prepare('SELECT 1 FROM orders WHERE order_code = ?');
  let code;
  do {
    code = `FACT-${randomCode(5)}`;
  } while (checkStmt.get(code));
  return code;
}

function money(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { generateOrderCode, money };
