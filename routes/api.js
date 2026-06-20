const express = require('express');
const db = require('../db/db');
const QRCode = require('qrcode');
const { generateOrderCode, money } = require('../lib/util');
const { buildPayNowPayload } = require('../lib/paynow');
const { sendOrderConfirmation } = require('../lib/mailer');

const router = express.Router();

const BUSINESS_NAME = process.env.BUSINESS_NAME || 'FACT';

// ---------- Menu ----------

router.get('/menu', (req, res) => {
  const items = db
    .prepare('SELECT * FROM menu_items WHERE active = 1 ORDER BY category, sort_order, name')
    .all();

  const groupStmt = db.prepare(
    'SELECT * FROM variant_groups WHERE menu_item_id = ? ORDER BY sort_order, id'
  );
  const optionStmt = db.prepare(
    'SELECT * FROM variant_options WHERE variant_group_id = ? ORDER BY sort_order, id'
  );

  const result = items.map((item) => {
    const groups = groupStmt.all(item.id).map((g) => ({
      id: g.id,
      name: g.name,
      required: !!g.required,
      options: optionStmt.all(g.id).map((o) => ({
        id: o.id,
        label: o.label,
        price_delta: o.price_delta,
      })),
    }));
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      base_price: item.base_price,
      variant_groups: groups,
    };
  });

  res.json(result);
});

// ---------- Slot availability ----------

function slotUsage(slotId) {
  const orderCount = db
    .prepare(
      "SELECT COUNT(*) AS c FROM orders WHERE slot_id = ? AND status != 'cancelled'"
    )
    .get(slotId).c;
  const itemCount = db
    .prepare(
      `SELECT COALESCE(SUM(oi.quantity), 0) AS c
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.slot_id = ? AND o.status != 'cancelled'`
    )
    .get(slotId).c;
  return { orderCount, itemCount };
}

router.get('/slots', (req, res) => {
  const { from, to } = req.query;
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = from || today;

  let slots;
  if (to) {
    slots = db
      .prepare(
        'SELECT * FROM slots WHERE active = 1 AND slot_date BETWEEN ? AND ? ORDER BY slot_date, start_time'
      )
      .all(fromDate, to);
  } else {
    slots = db
      .prepare(
        'SELECT * FROM slots WHERE active = 1 AND slot_date >= ? ORDER BY slot_date, start_time'
      )
      .all(fromDate);
  }

  const result = slots.map((s) => {
    const { orderCount, itemCount } = slotUsage(s.id);
    const ordersLeft = s.max_orders > 0 ? Math.max(s.max_orders - orderCount, 0) : null;
    const itemsLeft = s.max_items > 0 ? Math.max(s.max_items - itemCount, 0) : null;
    const isFull = (ordersLeft !== null && ordersLeft <= 0) || (itemsLeft !== null && itemsLeft <= 0);
    return {
      id: s.id,
      slot_date: s.slot_date,
      start_time: s.start_time,
      end_time: s.end_time,
      orders_left: ordersLeft,
      items_left: itemsLeft,
      is_full: isFull,
    };
  });

  res.json(result);
});

// ---------- Place an order ----------

router.post('/orders', async (req, res) => {
  try {
    const { customer_name, customer_phone, customer_email, slot_id, payment_method, items, notes } =
      req.body;

    if (!customer_name || !customer_phone) {
      return res.status(400).json({ error: 'Name and phone are required.' });
    }
    if (!slot_id) {
      return res.status(400).json({ error: 'Please choose a pickup slot.' });
    }
    if (!['pickup', 'paynow'].includes(payment_method)) {
      return res.status(400).json({ error: 'Invalid payment method.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your order is empty.' });
    }

    const slot = db.prepare('SELECT * FROM slots WHERE id = ? AND active = 1').get(slot_id);
    if (!slot) {
      return res.status(400).json({ error: 'That pickup slot is no longer available.' });
    }

    // Recalculate prices server-side — never trust client-submitted prices.
    const itemStmt = db.prepare('SELECT * FROM menu_items WHERE id = ? AND active = 1');
    const optionStmt = db.prepare('SELECT * FROM variant_options WHERE id = ?');

    let total = 0;
    let totalQty = 0;
    const lineItems = [];

    for (const reqItem of items) {
      const menuItem = itemStmt.get(reqItem.menu_item_id);
      if (!menuItem) {
        return res.status(400).json({ error: 'One of the items in your order is no longer available.' });
      }
      const qty = Math.max(1, parseInt(reqItem.quantity, 10) || 1);

      let unitPrice = menuItem.base_price;
      const variantLabels = [];
      for (const optId of reqItem.selected_option_ids || []) {
        const opt = optionStmt.get(optId);
        if (opt) {
          unitPrice += opt.price_delta;
          variantLabels.push(opt.label);
        }
      }
      unitPrice = money(unitPrice);
      const lineTotal = money(unitPrice * qty);

      total += lineTotal;
      totalQty += qty;

      lineItems.push({
        menu_item_id: menuItem.id,
        name_snapshot: menuItem.name,
        variant_summary: variantLabels.join(', '),
        quantity: qty,
        unit_price: unitPrice,
        line_total: lineTotal,
      });
    }
    total = money(total);

    // Capacity check
    const { orderCount, itemCount } = slotUsage(slot.id);
    if (slot.max_orders > 0 && orderCount + 1 > slot.max_orders) {
      return res.status(409).json({ error: 'That slot just filled up. Please pick another time.' });
    }
    if (slot.max_items > 0 && itemCount + totalQty > slot.max_items) {
      return res.status(409).json({ error: 'Not enough remaining capacity in that slot for this many items.' });
    }

    const orderCode = generateOrderCode();

    const insertOrder = db.prepare(`
      INSERT INTO orders (order_code, customer_name, customer_phone, customer_email, slot_id, payment_method, total_amount, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, menu_item_id, name_snapshot, variant_summary, quantity, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const orderId = db.transaction(() => {
      const info = insertOrder.run(
        orderCode,
        customer_name.trim(),
        customer_phone.trim(),
        customer_email ? customer_email.trim() : null,
        slot.id,
        payment_method,
        total,
        notes ? String(notes).slice(0, 500) : ''
      );
      for (const li of lineItems) {
        insertItem.run(
          info.lastInsertRowid,
          li.menu_item_id,
          li.name_snapshot,
          li.variant_summary,
          li.quantity,
          li.unit_price,
          li.line_total
        );
      }
      return info.lastInsertRowid;
    })();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const savedItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

    let qrDataUrl = null;
    if (payment_method === 'paynow') {
      const payload = buildPayNowPayload({
        proxyType: process.env.PAYNOW_PROXY_TYPE === 'uen' ? 'uen' : 'mobile',
        proxyValue: process.env.PAYNOW_PROXY_VALUE,
        amount: total,
        reference: orderCode,
        merchantName: process.env.PAYNOW_MERCHANT_NAME || BUSINESS_NAME,
      });
      qrDataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 280 });
    }

    // Best-effort email — never block the order on email failure.
    sendOrderConfirmation(order, slot, savedItems).catch(() => {});

    res.status(201).json({
      order_code: order.order_code,
      total_amount: order.total_amount,
      payment_method: order.payment_method,
      slot: { date: slot.slot_date, start_time: slot.start_time, end_time: slot.end_time },
      items: savedItems,
      qr_data_url: qrDataUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong placing your order. Please try again.' });
  }
});

// ---------- Track an order (no account needed) ----------

router.get('/orders/lookup', (req, res) => {
  const { code, phone } = req.query;
  if (!code || !phone) {
    return res.status(400).json({ error: 'Order reference and phone number are required.' });
  }

  const order = db
    .prepare('SELECT * FROM orders WHERE order_code = ? AND customer_phone = ?')
    .get(String(code).trim(), String(phone).trim());

  if (!order) {
    return res.status(404).json({ error: "We couldn't find an order matching that reference and phone number." });
  }

  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(order.slot_id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

  res.json({
    order_code: order.order_code,
    status: order.status,
    total_amount: order.total_amount,
    payment_method: order.payment_method,
    created_at: order.created_at,
    slot: slot ? { date: slot.slot_date, start_time: slot.start_time, end_time: slot.end_time } : null,
    items,
  });
});

module.exports = router;
