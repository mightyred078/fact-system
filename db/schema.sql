-- FACT Ordering System schema

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Coffee',
  base_price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS variant_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS variant_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_group_id INTEGER NOT NULL REFERENCES variant_groups(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  price_delta REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_date TEXT NOT NULL,   -- YYYY-MM-DD
  start_time TEXT NOT NULL,  -- HH:MM (24h)
  end_time TEXT NOT NULL,    -- HH:MM (24h)
  max_orders INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited
  max_items INTEGER NOT NULL DEFAULT 0,  -- 0 = unlimited
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  slot_id INTEGER NOT NULL REFERENCES slots(id),
  payment_method TEXT NOT NULL,        -- 'pickup' or 'paynow'
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | fulfilled | cancelled
  total_amount REAL NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER,
  name_snapshot TEXT NOT NULL,
  variant_summary TEXT DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_slot ON orders(slot_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_slots_date ON slots(slot_date);
