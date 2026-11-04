-- gazu:foreign-keys-off
-- GAZU — migration 002: operação comercial, conteúdo editorial, gestão e confiabilidade.
-- Reconstrói `payments` (novos métodos/status) seguindo o procedimento oficial do SQLite
-- (chaves estrangeiras desligadas fora da transação + PRAGMA foreign_key_check antes do COMMIT).

-- =========================================================================================
-- Equipe, permissões e auditoria
-- =========================================================================================
ALTER TABLE users ADD COLUMN staff_role TEXT CHECK (staff_role IS NULL OR staff_role IN ('owner', 'manager', 'catalog', 'finance', 'support', 'marketing'));
ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN anonymized_at TEXT;
UPDATE users SET staff_role = 'owner' WHERE role = 'admin' AND staff_role IS NULL;

ALTER TABLE audit_log ADD COLUMN result TEXT NOT NULL DEFAULT 'success';
ALTER TABLE audit_log ADD COLUMN ip TEXT;
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

-- =========================================================================================
-- Catálogo: ciclo de vida, atributos, custos e guias de medidas
-- =========================================================================================
CREATE TABLE size_guides (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  table_json  TEXT NOT NULL,                       -- {"head": [...], "rows": [[...]]}
  note        TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

ALTER TABLE products ADD COLUMN published_at TEXT;
ALTER TABLE products ADD COLUMN archived_at TEXT;
ALTER TABLE products ADD COLUMN deleted_at TEXT;               -- exclusão lógica (lixeira)
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN composition TEXT;
ALTER TABLE products ADD COLUMN care_instructions TEXT;
ALTER TABLE products ADD COLUMN fit_notes TEXT;                -- medidas e caimento informados pelo fornecedor
ALTER TABLE products ADD COLUMN cost_cents INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0);
ALTER TABLE products ADD COLUMN weight_grams INTEGER CHECK (weight_grams IS NULL OR weight_grams > 0);
ALTER TABLE products ADD COLUMN length_cm INTEGER CHECK (length_cm IS NULL OR length_cm > 0);
ALTER TABLE products ADD COLUMN width_cm INTEGER CHECK (width_cm IS NULL OR width_cm > 0);
ALTER TABLE products ADD COLUMN height_cm INTEGER CHECK (height_cm IS NULL OR height_cm > 0);
ALTER TABLE products ADD COLUMN size_guide_id INTEGER REFERENCES size_guides(id) ON DELETE SET NULL;
UPDATE products SET published_at = created_at WHERE is_active = 1;
CREATE INDEX idx_products_deleted ON products(deleted_at);

ALTER TABLE product_variants ADD COLUMN cost_cents INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0);

-- =========================================================================================
-- Marketing (criada antes porque banners e pedidos a referenciam)
-- =========================================================================================
CREATE TABLE campaigns (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  channel       TEXT NOT NULL DEFAULT 'outro',     -- instagram, email, influenciador, anúncio...
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT NOT NULL UNIQUE,
  coupon_id     INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
  landing_path  TEXT NOT NULL DEFAULT '/',
  starts_at     TEXT,
  ends_at       TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- =========================================================================================
-- Coleções, Archive, Lookbooks e Journal
-- =========================================================================================
CREATE TABLE collections (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  season          TEXT,
  cover_url       TEXT,
  cover_alt       TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  is_featured     INTEGER NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0,
  seo_title       TEXT,
  seo_description TEXT,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  archived_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE collection_products (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);
CREATE INDEX idx_collection_products_product ON collection_products(product_id);

CREATE TABLE lookbooks (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  cover_url       TEXT,
  collection_id   INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at    TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  seo_title       TEXT,
  seo_description TEXT,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE lookbook_images (
  id          INTEGER PRIMARY KEY,
  lookbook_id INTEGER NOT NULL REFERENCES lookbooks(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  alt         TEXT NOT NULL DEFAULT '',
  width       INTEGER,
  height      INTEGER,
  position    INTEGER NOT NULL DEFAULT 0
);
-- Pontos interativos (hotspots): cada ponto liga uma área da foto a um produto.
CREATE TABLE lookbook_products (
  id          INTEGER PRIMARY KEY,
  lookbook_id INTEGER NOT NULL REFERENCES lookbooks(id) ON DELETE CASCADE,
  image_id    INTEGER REFERENCES lookbook_images(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  x_pct       REAL CHECK (x_pct IS NULL OR (x_pct >= 0 AND x_pct <= 100)),
  y_pct       REAL CHECK (y_pct IS NULL OR (y_pct >= 0 AND y_pct <= 100)),
  label       TEXT,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_lookbook_products_product ON lookbook_products(product_id);

CREATE TABLE journal_articles (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  excerpt         TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',          -- Markdown restrito (renderizado com escape)
  cover_url       TEXT,
  cover_alt       TEXT,
  category        TEXT NOT NULL DEFAULT 'estilo',
  author          TEXT NOT NULL DEFAULT 'Equipe GAZU',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at    TEXT,
  seo_title       TEXT,
  seo_description TEXT,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE journal_article_products (
  article_id  INTEGER NOT NULL REFERENCES journal_articles(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, product_id)
);

-- =========================================================================================
-- Conteúdo administrável: anúncios, banners, páginas institucionais e perguntas frequentes
-- =========================================================================================
CREATE TABLE announcements (
  id          INTEGER PRIMARY KEY,
  message     TEXT NOT NULL,
  link_url    TEXT,
  starts_at   TEXT,
  ends_at     TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Migra as mensagens que estavam nas configurações (JSON) para a nova tabela.
INSERT INTO announcements (message, position)
  SELECT j.value, CAST(j.key AS INTEGER) FROM settings s, json_each(json_extract(s.value, '$.announcements')) j WHERE s.key = 'store';

CREATE TABLE banners (
  id          INTEGER PRIMARY KEY,
  placement   TEXT NOT NULL CHECK (placement IN ('home_editorial', 'home_secondary', 'catalog_top')),
  eyebrow     TEXT,
  title       TEXT NOT NULL,
  subtitle    TEXT,
  image_url   TEXT,
  image_alt   TEXT,
  link_url    TEXT NOT NULL DEFAULT '/',
  cta_label   TEXT NOT NULL DEFAULT 'Explorar',
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  starts_at   TEXT,
  ends_at     TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE pages (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  seo_description TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE faq_items (
  id          INTEGER PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT 'geral' CHECK (category IN ('geral', 'pedidos', 'pagamento', 'entrega', 'trocas', 'produtos', 'conta', 'privacidade')),
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,  -- pergunta específica de um produto
  position    INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- =========================================================================================
-- Avaliações verificadas e lista de espera
-- =========================================================================================
CREATE TABLE reviews (
  id           INTEGER PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  order_id     INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  author_name  TEXT NOT NULL,
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  moderated_at TEXT,
  UNIQUE (product_id, user_id)
);
CREATE INDEX idx_reviews_product ON reviews(product_id, status);
CREATE TABLE review_moderation (
  id         INTEGER PRIMARY KEY,
  review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'pending')),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE stock_alerts (
  id           INTEGER PRIMARY KEY,
  variant_id   INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL COLLATE NOCASE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  notified_at  TEXT,
  cancelled_at TEXT,
  UNIQUE (variant_id, email)
);

-- =========================================================================================
-- Pagamentos (reconstrução: boleto, "em processamento", "expirado", taxas e estornos)
-- =========================================================================================
CREATE TABLE payments_new (
  id                   INTEGER PRIMARY KEY,
  order_id             INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL CHECK (provider IN ('mercadopago', 'demo')),
  method               TEXT NOT NULL CHECK (method IN ('pix', 'credit_card', 'debit_card', 'boleto', 'demo')),
  provider_payment_id  TEXT,
  status               TEXT NOT NULL CHECK (status IN ('pending', 'in_process', 'approved', 'rejected', 'cancelled', 'expired', 'refunded', 'partially_refunded')),
  status_detail        TEXT,
  provider_status      TEXT,                        -- status bruto do provedor (auditoria)
  amount_cents         INTEGER NOT NULL CHECK (amount_cents > 0),
  fee_cents            INTEGER CHECK (fee_cents IS NULL OR fee_cents >= 0),        -- taxa informada pelo provedor
  net_received_cents   INTEGER,                                                     -- valor líquido informado pelo provedor
  refunded_cents       INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  idempotency_key      TEXT NOT NULL UNIQUE,
  pix_qr_code          TEXT,
  pix_qr_base64        TEXT,
  pix_ticket_url       TEXT,
  boleto_url           TEXT,
  boleto_barcode       TEXT,
  card_last_four       TEXT,
  installments         INTEGER,
  expires_at           TEXT,
  approved_at          TEXT,
  last_synced_at       TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_payment_id)
);
INSERT INTO payments_new (id, order_id, provider, method, provider_payment_id, status, status_detail, amount_cents, idempotency_key, pix_qr_code, pix_qr_base64,
                          pix_ticket_url, card_last_four, installments, expires_at, approved_at, created_at, updated_at)
  SELECT id, order_id, provider, method, provider_payment_id, status, status_detail, amount_cents, idempotency_key, pix_qr_code, pix_qr_base64,
         pix_ticket_url, card_last_four, installments, expires_at, CASE WHEN status = 'approved' THEN updated_at END, created_at, updated_at FROM payments;
DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status, provider);

ALTER TABLE payment_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payment_events ADD COLUMN processed_at TEXT;
CREATE INDEX idx_payment_events_result ON payment_events(result, received_at);

-- =========================================================================================
-- Pedidos: visitante, atribuição de campanha, custos e observações internas
-- =========================================================================================
ALTER TABLE orders ADD COLUMN guest_access_hash TEXT;            -- acesso de visitante (token só existe em hash)
ALTER TABLE orders ADD COLUMN customer_name TEXT;
ALTER TABLE orders ADD COLUMN customer_email TEXT;
ALTER TABLE orders ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN utm_source TEXT;
ALTER TABLE orders ADD COLUMN utm_medium TEXT;
ALTER TABLE orders ADD COLUMN utm_campaign TEXT;
ALTER TABLE orders ADD COLUMN packaging_cost_cents INTEGER CHECK (packaging_cost_cents IS NULL OR packaging_cost_cents >= 0);
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
UPDATE orders SET customer_email = (SELECT email FROM users u WHERE u.id = orders.user_id),
                  customer_name = (SELECT full_name FROM profiles p WHERE p.user_id = orders.user_id);
UPDATE orders SET paid_at = updated_at WHERE status IN ('paid', 'processing', 'shipped', 'delivered');

ALTER TABLE order_items ADD COLUMN unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);  -- custo no momento da venda

CREATE TABLE order_notes (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- =========================================================================================
-- Entregas e rastreamento
-- =========================================================================================
CREATE TABLE shipments (
  id                   INTEGER PRIMARY KEY,
  order_id             INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'label_purchased', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returned', 'cancelled')),
  provider             TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual', 'melhorenvio')),
  carrier              TEXT,
  service              TEXT,
  tracking_code        TEXT,
  tracking_url         TEXT,
  label_url            TEXT,
  provider_shipment_id TEXT,
  cost_cents           INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0),   -- custo do frete pago pela loja
  shipped_at           TEXT,
  delivered_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_shipments_order ON shipments(order_id);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE TABLE shipment_events (
  id          INTEGER PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  description TEXT NOT NULL,
  location    TEXT,
  source      TEXT NOT NULL CHECK (source IN ('admin', 'provider', 'system')),
  occurred_at TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_shipment_events_shipment ON shipment_events(shipment_id, occurred_at);
-- Pedidos já enviados antes desta versão ganham um registro de envio equivalente.
INSERT INTO shipments (order_id, status, provider, tracking_code, tracking_url, shipped_at, delivered_at, created_at, updated_at)
  SELECT id, CASE status WHEN 'delivered' THEN 'delivered' ELSE 'shipped' END, 'manual', tracking_code, tracking_url, updated_at,
         CASE status WHEN 'delivered' THEN updated_at END, updated_at, updated_at
    FROM orders WHERE tracking_code IS NOT NULL OR status IN ('shipped', 'delivered');

-- =========================================================================================
-- Trocas, devoluções e estornos
-- =========================================================================================
CREATE TABLE return_requests (
  id                  INTEGER PRIMARY KEY,
  number              TEXT NOT NULL UNIQUE,
  order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  type                TEXT NOT NULL CHECK (type IN ('withdrawal', 'exchange', 'defect', 'other')),
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'awaiting_item', 'received', 'refunded', 'exchanged', 'closed')),
  resolution          TEXT,
  refund_amount_cents INTEGER CHECK (refund_amount_cents IS NULL OR refund_amount_cents >= 0),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_returns_order ON return_requests(order_id);
CREATE TABLE return_items (
  id            INTEGER PRIMARY KEY,
  return_id     INTEGER NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  restocked     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE return_events (
  id         INTEGER PRIMARY KEY,
  return_id  INTEGER NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  message    TEXT NOT NULL,
  actor      TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE refunds (
  id                 INTEGER PRIMARY KEY,
  payment_id         INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id           INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  return_id          INTEGER REFERENCES return_requests(id) ON DELETE SET NULL,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  status             TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'failed')),
  provider_refund_id TEXT,
  reason             TEXT NOT NULL,
  idempotency_key    TEXT NOT NULL UNIQUE,
  requested_by       TEXT NOT NULL,
  detail             TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  confirmed_at       TEXT
);
CREATE INDEX idx_refunds_payment ON refunds(payment_id);

-- =========================================================================================
-- Financeiro: despesas operacionais (custos de produto ficam em products/variants/order_items)
-- =========================================================================================
CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY,
  category     TEXT NOT NULL CHECK (category IN ('marketing', 'embalagem', 'frete', 'plataforma', 'taxas', 'pessoal', 'aluguel', 'impostos', 'fornecedores', 'outros')),
  description  TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  incurred_on  TEXT NOT NULL CHECK (incurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  campaign_id  INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  order_id     INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at   TEXT
);
CREATE INDEX idx_expenses_date ON expenses(incurred_on);

-- =========================================================================================
-- Central de atendimento (inclui canal WhatsApp quando a API oficial estiver configurada)
-- =========================================================================================
CREATE TABLE support_tickets (
  id                       INTEGER PRIMARY KEY,
  number                   TEXT NOT NULL UNIQUE,
  user_id                  TEXT REFERENCES users(id) ON DELETE SET NULL,
  email                    TEXT NOT NULL,
  name                     TEXT NOT NULL,
  phone                    TEXT,
  order_id                 INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  product_id               INTEGER REFERENCES products(id) ON DELETE SET NULL,
  category                 TEXT NOT NULL CHECK (category IN ('produto', 'pedido', 'pagamento', 'entrega', 'troca', 'reembolso', 'defeito', 'contato', 'outro')),
  subject                  TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  priority                 TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assignee_id              TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel                  TEXT NOT NULL DEFAULT 'site' CHECK (channel IN ('site', 'email', 'whatsapp', 'telefone')),
  access_hash              TEXT,                          -- acesso do cliente sem login (link enviado por e-mail)
  whatsapp_wa_id           TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at                TEXT,
  last_customer_message_at TEXT
);
CREATE INDEX idx_tickets_status ON support_tickets(status, priority);
CREATE INDEX idx_tickets_user ON support_tickets(user_id);
CREATE TABLE support_messages (
  id          INTEGER PRIMARY KEY,
  ticket_id   INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('customer', 'staff', 'system')),
  author_id   TEXT,
  body        TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,                 -- observação interna: nunca enviada ao cliente
  channel     TEXT NOT NULL DEFAULT 'site',
  external_id TEXT UNIQUE,                                -- id da mensagem no WhatsApp (idempotência)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_support_messages_ticket ON support_messages(ticket_id, created_at);

-- =========================================================================================
-- Comunicações transacionais, newsletter e consentimentos
-- =========================================================================================
ALTER TABLE email_outbox ADD COLUMN body_html TEXT;
ALTER TABLE email_outbox ADD COLUMN event TEXT;
ALTER TABLE email_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE notifications (
  id              INTEGER PRIMARY KEY,
  event           TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp')),
  recipient       TEXT NOT NULL,
  order_id        INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL CHECK (status IN ('sent', 'logged', 'failed', 'skipped')),
  dedupe_key      TEXT NOT NULL UNIQUE,                   -- impede notificações duplicadas
  email_outbox_id INTEGER REFERENCES email_outbox(id) ON DELETE SET NULL,
  detail          TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_notifications_order ON notifications(order_id);

CREATE TABLE newsletter_subscribers (
  id                      INTEGER PRIMARY KEY,
  email                   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                    TEXT,
  user_id                 TEXT REFERENCES users(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  confirm_token_hash      TEXT,
  unsubscribe_token_hash  TEXT NOT NULL,
  source                  TEXT NOT NULL DEFAULT 'site',
  consent_text            TEXT NOT NULL,
  ip                      TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  confirmed_at            TEXT,
  unsubscribed_at         TEXT
);

CREATE TABLE consents (
  id         INTEGER PRIMARY KEY,
  subject    TEXT NOT NULL,                               -- user:<id> | email:<e-mail> | anon:<id do navegador>
  purpose    TEXT NOT NULL CHECK (purpose IN ('terms', 'privacy', 'newsletter', 'marketing_email', 'analytics', 'whatsapp')),
  granted    INTEGER NOT NULL,
  version    TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_consents_subject ON consents(subject, purpose, created_at);

CREATE TABLE data_requests (
  id           INTEGER PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  email        TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('export', 'deletion', 'correction')),
  status       TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'in_review', 'completed', 'rejected')),
  note         TEXT,
  handled_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

-- =========================================================================================
-- Analytics próprio (somente com consentimento; sem dados pessoais diretos)
-- =========================================================================================
CREATE TABLE analytics_events (
  id            INTEGER PRIMARY KEY,
  session_id    TEXT NOT NULL,
  user_id       TEXT,
  event         TEXT NOT NULL,
  path          TEXT,
  product_id    INTEGER,
  category_slug TEXT,
  search_term   TEXT,
  results_count INTEGER,
  value_cents   INTEGER,
  props         TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  referrer_host TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_analytics_event ON analytics_events(event, created_at);
CREATE INDEX idx_analytics_session ON analytics_events(session_id);

-- =========================================================================================
-- Confiabilidade: erros, rotinas, backups
-- =========================================================================================
CREATE TABLE error_log (
  id            INTEGER PRIMARY KEY,
  level         TEXT NOT NULL CHECK (level IN ('warn', 'error', 'critical')),
  source        TEXT NOT NULL,
  message       TEXT NOT NULL,
  context       TEXT,
  fingerprint   TEXT NOT NULL,
  occurrences   INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  alerted_at    TEXT,
  resolved_at   TEXT
);
CREATE UNIQUE INDEX idx_error_open_fingerprint ON error_log(fingerprint) WHERE resolved_at IS NULL;

CREATE TABLE job_runs (
  id          INTEGER PRIMARY KEY,
  job         TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  detail      TEXT,
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT
);
CREATE INDEX idx_job_runs_job ON job_runs(job, started_at);

CREATE TABLE backups (
  id          INTEGER PRIMARY KEY,
  file        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('auto', 'manual')),
  status      TEXT NOT NULL CHECK (status IN ('ok', 'verified', 'failed', 'removed')),
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verified_at TEXT
);
