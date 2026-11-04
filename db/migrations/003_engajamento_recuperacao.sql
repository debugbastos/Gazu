-- GAZU — migration 003: histórico de visualizados sincronizado, carrinho abandonado e opt-in de marketing.

-- Produtos vistos recentemente (clientes com conta). Visitantes mantêm a lista apenas no navegador (conveniência,
-- não é dado comercial). Mantemos no máximo 30 itens por cliente (aplicado pela aplicação).
CREATE TABLE recently_viewed (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  viewed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, product_id)
);
CREATE INDEX idx_recently_viewed_user ON recently_viewed(user_id, viewed_at);

-- Carrinho abandonado: lembrete único por carrinho, somente para quem autorizou e-mails de marketing.
ALTER TABLE carts ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE users ADD COLUMN marketing_opt_in INTEGER NOT NULL DEFAULT 0;

-- Avaliações: e-mail do autor não é exibido; guardamos a origem (compra verificada).
ALTER TABLE reviews ADD COLUMN verified_purchase INTEGER NOT NULL DEFAULT 1;
