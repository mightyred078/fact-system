const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/db');
const { requireAdmin } = require('../middleware/auth');
const { sendReadyForPickup } = require('../lib/mailer');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------- Auth ----------

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  req.session.isAdmin = true;
  req.session.username = admin.username;
  res.json({ ok: true, username: admin.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// Everything below requires an admin session.
router.use(requireAdmin);

// ---------- Menu management ----------

router.get('/menu', (req, res) => {
  const items = db.prepare('SELECT * FROM menu_items ORDER BY category, sort_order, name').all();
  const groupStmt = db.prepare('SELECT * FROM variant_groups WHERE menu_item_id = ? ORDER BY sort_order, id');
  const optionStmt = db.prepare('SELECT * FROM variant_options WHERE variant_group_id = ? ORDER BY sort_order, id');

  const result = items.map((item) => ({
    ...item,
    variant_groups: groupStmt.all(item.id).map((g) => ({
      ...g,
      options: optionStmt.all(g.id),
    })),
  }));
  res.json(result);
});

function saveVariantGroups(menuItemId, groups) {
  db.prepare('DELETE FROM variant_groups WHERE menu_item_id = ?').run(menuItemId);
  const insertGroup = db.prepare(
    'INSERT INTO variant_groups (menu_item_id, name, required, sort_order) VALUES (?, ?, ?, ?)'
  );
  const insertOption = db.prepare(
    'INSERT INTO variant_options (variant_group_id, label, price_delta, sort_order) VALUES (?, ?, ?, ?)'
  );
  (groups || []).forEach((g, gi) => {
    const info = insertGroup.run(menuItemId, g.name, g.required ? 1 : 0, gi);
    (g.options || []).forEach((o, oi) => {
      insertOption.run(info.lastInsertRowid, o.label, Number(o.price_delta) || 0, oi);
    });
  });
}

router.post('/menu', (req, res) => {
  const { name, description, category, base_price, sort_order, variant_groups } = req.body;
  if (!name || base_price === undefined) {
    return res.status(400).json({ error: 'Name and base price are required.' });
  }
  const info = db
    .prepare(
      'INSERT INTO menu_items (name, description, category, base_price, sort_order) VALUES (?, ?, ?, ?, ?)'
    )
    .run(name, description || '', category || 'Coffee', Number(base_price), Number(sort_order) || 0);

  saveVariantGroups(info.lastInsertRowid, variant_groups);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/menu/:id', (req, res) => {
  const { name, description, category, base_price, active, sort_order, variant_groups } = req.body;
  const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });

  db.prepare(
    `UPDATE menu_items SET name = ?, description = ?, category = ?, base_price = ?, active = ?, sort_order = ? WHERE id = ?`
  ).run(
    name ?? existing.name,
    description ?? existing.description,
    category ?? existing.category,
    base_price !== undefined ? Number(base_price) : existing.base_price,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    sort_order !== undefined ? Number(sort_order) : existing.sort_order,
    req.params.id
  );

  if (variant_groups !== undefined) {
    saveVariantGroups(req.params.id, variant_groups);
  }
  res.json({ ok: true });
});

router.delete('/menu/:id', (req, res) => {
  const usedInOrder = db.prepare('SELECT 1 FROM order_items WHERE menu_item_id = ? LIMIT 1').get(req.params.id);
  if (usedInOrder) {
    // Keep order history intact — archive instead of deleting.
    db.prepare('UPDATE menu_items SET active = 0 WHERE id = ?').run(req.params.id);
    return res.json({ ok: true, archived: true });
  }
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true, archived: false });
});

// ---------- Slot management ----------

router.get('/slots', (req, res) => {
  const { from, to } = req.query;
  let slots;
  if (from && to) {
    slots = db
      .prepare('SELECT * FROM slots WHERE slot_date BETWEEN ? AND ? ORDER BY slot_date, start_time')
      .all(from, to);
  } else {
    slots = db.prepare('SELECT * FROM slots ORDER BY slot_date, start_time').all();
  }

  const result = slots.map((s) => {
    const orderCount = db
      .prepare("SELECT COUNT(*) AS c FROM orders WHERE slot_id = ? AND status != 'cancelled'")
      .get(s.id).c;
    const itemCount = db
      .prepare(
        `SELECT COALESCE(SUM(oi.quantity), 0) AS c FROM order_items oi
         JOIN orders o ON o.id = oi.order_id WHERE o.slot_id = ? AND o.status != 'cancelled'`
      )
      .get(s.id).c;
    return { ...s, order_count: orderCount, item_count: itemCount };
  });

  res.json(result);
});

router.post('/slots', (req, res) => {
  const { slot_date, start_time, end_time, max_orders, max_items } = req.body;
  if (!slot_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Date, start time and end time are required.' });
  }
  const info = db
    .prepare(
      'INSERT INTO slots (slot_date, start_time, end_time, max_orders, max_items) VALUES (?, ?, ?, ?, ?)'
    )
    .run(slot_date, start_time, end_time, Number(max_orders) || 0, Number(max_items) || 0);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/slots/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM slots WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Slot not found.' });
  const { slot_date, start_time, end_time, max_orders, max_items, active } = req.body;
  db.prepare(
    `UPDATE slots SET slot_date = ?, start_time = ?, end_time = ?, max_orders = ?, max_items = ?, active = ? WHERE id = ?`
  ).run(
    slot_date ?? existing.slot_date,
    start_time ?? existing.start_time,
    end_time ?? existing.end_time,
    max_orders !== undefined ? Number(max_orders) : existing.max_orders,
    max_items !== undefined ? Number(max_items) : existing.max_items,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/slots/:id', (req, res) => {
  const hasOrders = db.prepare('SELECT 1 FROM orders WHERE slot_id = ? LIMIT 1').get(req.params.id);
  if (hasOrders) {
    return res.status(409).json({ error: 'This slot has orders attached. Deactivate it instead of deleting it.' });
  }
  db.prepare('DELETE FROM slots WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Orders ----------

router.get('/orders', (req, res) => {
  const { date, status } = req.query;
  let rows;
  if (date && status) {
    rows = db
      .prepare(
        `SELECT o.*, s.slot_date, s.start_time, s.end_time FROM orders o
         JOIN slots s ON s.id = o.slot_id
         WHERE s.slot_date = ? AND o.status = ? ORDER BY s.start_time, o.created_at`
      )
      .all(date, status);
  } else if (date) {
    rows = db
      .prepare(
        `SELECT o.*, s.slot_date, s.start_time, s.end_time FROM orders o
         JOIN slots s ON s.id = o.slot_id
         WHERE s.slot_date = ? ORDER BY s.start_time, o.created_at`
      )
      .all(date);
  } else if (status) {
    rows = db
      .prepare(
        `SELECT o.*, s.slot_date, s.start_time, s.end_time FROM orders o
         JOIN slots s ON s.id = o.slot_id
         WHERE o.status = ? ORDER BY s.slot_date, s.start_time`
      )
      .all(status);
  } else {
    rows = db
      .prepare(
        `SELECT o.*, s.slot_date, s.start_time, s.end_time FROM orders o
         JOIN slots s ON s.id = o.slot_id
         ORDER BY s.slot_date DESC, s.start_time DESC LIMIT 200`
      )
      .all();
  }

  const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const result = rows.map((o) => ({ ...o, items: itemStmt.all(o.id) }));
  res.json(result);
});

router.patch('/orders/:id', (req, res) => {
  const { status } = req.body;
  const valid = ['pending', 'paid', 'fulfilled', 'cancelled'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order not found.' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

router.post('/orders/:id/notify-ready', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(order.slot_id);
  const sent = await sendReadyForPickup(order, slot);
  res.json({ sent });
});

module.exports = router;
