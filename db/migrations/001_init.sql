-- GAZU — esquema inicial (SQLite 3.45+). Valores monetários em centavos (INTEGER).
-- Datas em ISO-8601 UTC (TEXT). Chaves estrangeiras ativadas em tempo de conexão (PRAGMA foreign_keys = ON).

CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash    TEXT,
  role             TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  google_sub       TEXT UNIQUE,
  email_verified_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE profiles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL DEFAULT '',
  phone      TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,               -- SHA-256 do token (o token em si nunca é armazenado)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE auth_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verification')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id, purpose);

CREATE TABLE addresses (
  id          INTEGER PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT 'Endereço',
  recipient   TEXT NOT NULL,
  cep         TEXT NOT NULL CHECK (length(cep) = 8),
  street      TEXT NOT NULL,
  number      TEXT NOT NULL,
  complement  TEXT,
  district    TEXT NOT NULL,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (length(state) = 2),
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_addresses_user ON addresses(user_id);

CREATE TABLE categories (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  parent_id   INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  position    INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  image_url   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_categories_parent ON categories(parent_id, position);

CREATE TABLE products (
  id                     INTEGER PRIMARY KEY,
  slug                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  details                TEXT,                         -- composição e cuidados (quando informados)
  audience               TEXT NOT NULL CHECK (audience IN ('masculino', 'feminino', 'unissex', 'menino', 'menina')),
  product_type           TEXT NOT NULL,
  primary_category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  price_cents            INTEGER NOT NULL CHECK (price_cents > 0),
  promo_price_cents      INTEGER CHECK (promo_price_cents IS NULL OR promo_price_cents > 0),
  promo_starts_at        TEXT,
  promo_ends_at          TEXT,
  is_active              INTEGER NOT NULL DEFAULT 1,
  is_featured            INTEGER NOT NULL DEFAULT 0,
  is_demo                INTEGER NOT NULL DEFAULT 0,  -- produto de demonstração: preço/estoque ilustrativos
  color_confirmed        INTEGER NOT NULL DEFAULT 0,
  seo_title              TEXT,
  seo_description        TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (promo_price_cents IS NULL OR promo_price_cents < price_cents)
);
CREATE INDEX idx_products_active ON products(is_active, created_at);

CREATE TABLE product_categories (
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);
CREATE INDEX idx_product_categories_cat ON product_categories(category_id);

CREATE TABLE product_images (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  srcset      TEXT,
  width       INTEGER,
  height      INTEGER,
  alt         TEXT NOT NULL DEFAULT '',
  color_name  TEXT,                                 -- associação opcional a uma cor
  object_position TEXT NOT NULL DEFAULT 'center',
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_images_product ON product_images(product_id, position);

CREATE TABLE product_variants (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku         TEXT NOT NULL UNIQUE,
  color_name  TEXT NOT NULL,
  color_hex   TEXT,
  size        TEXT NOT NULL,
  size_order  INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents > 0),
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active   INTEGER NOT NULL DEFAULT 1,
  UNIQUE (product_id, color_name, size)
);
CREATE INDEX idx_variants_product ON product_variants(product_id);

CREATE TABLE carts (
  id          INTEGER PRIMARY KEY,
  user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE cart_items (
  cart_id     INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 20),
  added_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (cart_id, variant_id)
);

CREATE TABLE favorites (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE coupons (
  id                 INTEGER PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description        TEXT NOT NULL DEFAULT '',
  discount_type      TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  value              INTEGER NOT NULL CHECK (value > 0),   -- percentual (1–90) ou centavos
  min_order_cents    INTEGER NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  starts_at          TEXT,
  ends_at            TEXT,
  max_uses           INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  max_uses_per_user  INTEGER CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0),
  is_active          INTEGER NOT NULL DEFAULT 1,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (discount_type <> 'percent' OR value <= 90)
);

CREATE TABLE coupon_categories (
  coupon_id   INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, category_id)
);

CREATE TABLE coupon_products (
  coupon_id   INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, product_id)
);

CREATE TABLE shipping_rules (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  cep_start    TEXT NOT NULL CHECK (length(cep_start) = 8),
  cep_end      TEXT NOT NULL CHECK (length(cep_end) = 8),
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  min_days     INTEGER NOT NULL CHECK (min_days >= 0),
  max_days     INTEGER NOT NULL CHECK (max_days >= min_days),
  free_above_cents INTEGER CHECK (free_above_cents IS NULL OR free_above_cents > 0),
  is_active    INTEGER NOT NULL DEFAULT 1,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id                 INTEGER PRIMARY KEY,
  number             TEXT NOT NULL UNIQUE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL CHECK (status IN ('pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')),
  subtotal_cents     INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents     INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  shipping_cents     INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  total_cents        INTEGER NOT NULL CHECK (total_cents >= 0),
  coupon_id          INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
  coupon_code        TEXT,
  shipping_option_id TEXT NOT NULL,
  shipping_label     TEXT NOT NULL,
  shipping_days_text TEXT,
  shipping_is_demo   INTEGER NOT NULL DEFAULT 0,
  ship_recipient     TEXT NOT NULL,
  ship_cep           TEXT NOT NULL,
  ship_street        TEXT NOT NULL,
  ship_number        TEXT NOT NULL,
  ship_complement    TEXT,
  ship_district      TEXT NOT NULL,
  ship_city          TEXT NOT NULL,
  ship_state         TEXT NOT NULL,
  tracking_code      TEXT,
  tracking_url       TEXT,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  stock_released     INTEGER NOT NULL DEFAULT 0,
  expires_at         TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (total_cents = subtotal_cents - discount_cents + shipping_cents)
);
CREATE INDEX idx_orders_user ON orders(user_id, created_at);
CREATE INDEX idx_orders_status ON orders(status, created_at);

CREATE TABLE order_items (
  id                INTEGER PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
  variant_id        INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  -- snapshot comercial no momento da compra
  sku               TEXT NOT NULL,
  product_name      TEXT NOT NULL,
  product_slug      TEXT NOT NULL,
  color_name        TEXT NOT NULL,
  size              TEXT NOT NULL,
  image_url         TEXT,
  unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents > 0),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents  INTEGER NOT NULL,
  CHECK (line_total_cents = unit_price_cents * quantity)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_events (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  actor       TEXT NOT NULL,                        -- system | customer:<id> | admin:<id> | provider:<nome>
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_order_events_order ON order_events(order_id, created_at);

CREATE TABLE coupon_redemptions (
  id             INTEGER PRIMARY KEY,
  coupon_id      INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id       INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  status         TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'confirmed', 'released')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id, status);

CREATE TABLE payments (
  id                   INTEGER PRIMARY KEY,
  order_id             INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL CHECK (provider IN ('mercadopago', 'demo')),
  method               TEXT NOT NULL CHECK (method IN ('pix', 'credit_card', 'debit_card', 'demo')),
  provider_payment_id  TEXT,
  status               TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'partially_refunded')),
  status_detail        TEXT,
  amount_cents         INTEGER NOT NULL CHECK (amount_cents > 0),
  idempotency_key      TEXT NOT NULL UNIQUE,
  pix_qr_code          TEXT,
  pix_qr_base64        TEXT,
  pix_ticket_url       TEXT,
  card_last_four       TEXT,
  installments         INTEGER,
  expires_at           TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_payment_id)
);
CREATE INDEX idx_payments_order ON payments(order_id);

CREATE TABLE payment_events (
  id                   INTEGER PRIMARY KEY,
  provider             TEXT NOT NULL,
  event_key            TEXT NOT NULL,              -- chave de idempotência do evento
  provider_payment_id  TEXT,
  payment_id           INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  type                 TEXT NOT NULL,
  status               TEXT,
  signature_valid      INTEGER NOT NULL,
  result               TEXT NOT NULL,               -- processed | ignored | rejected | error
  detail               TEXT,
  received_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, event_key)
);

CREATE TABLE inventory_movements (
  id             INTEGER PRIMARY KEY,
  variant_id     INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  delta          INTEGER NOT NULL CHECK (delta <> 0),
  reason         TEXT NOT NULL CHECK (reason IN ('initial', 'adjustment', 'order_reserve', 'order_release', 'restock')),
  order_id       INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  actor          TEXT NOT NULL,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_inventory_variant ON inventory_movements(variant_id, created_at);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,                        -- JSON
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  data        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE email_outbox (
  id          INTEGER PRIMARY KEY,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body_text   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'logged', 'failed')),
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
