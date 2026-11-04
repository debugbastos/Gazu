import { env } from '../config.ts';
import { getDb, nowIso } from '../db.ts';
import { HttpError } from '../http.ts';
import { on } from '../events.ts';
import { randomToken, sha256 } from '../security.ts';
import type { AdminReviewDTO, ReviewDTO } from '../../shared/types.ts';
import { notify } from './notifications.ts';
import { getSettings } from './settings.ts';
import { recordConsent } from './privacy.ts';
import { audit } from './audit.ts';

const url = (p: string) => new URL(p, env.APP_URL).toString();

// =====================================================================================
// Avaliações verificadas: somente quem comprou e recebeu o produto pode avaliar.
// Nenhuma avaliação é criada pela loja; moderação opcional (configurações).
// =====================================================================================

export function reviewEligibility(userId: string, productId: number): { eligible: boolean; orderId: number | null; reason: string | null; existing: boolean } {
  const db = getDb();
  const existing = Boolean(db.get('SELECT 1 FROM reviews WHERE product_id = ? AND user_id = ?', productId, userId));
  const order = db.get<{ id: number }>(
    `SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.user_id = ? AND i.product_id = ? AND o.status = 'delivered' AND o.is_demo = 0 ORDER BY o.id DESC LIMIT 1`,
    userId, productId,
  );
  if (existing) return { eligible: false, orderId: order?.id ?? null, reason: 'Você já avaliou este produto.', existing };
  if (!order) return { eligible: false, orderId: null, reason: 'Avaliações são liberadas após a entrega de uma compra deste produto.', existing };
  return { eligible: true, orderId: order.id, reason: null, existing };
}

export function publicReviews(productId: number, limit = 20, offset = 0): ReviewDTO[] {
  return getDb().all<{ id: number; author_name: string; rating: number; title: string; body: string; created_at: string; verified_purchase: number }>(
    "SELECT id, author_name, rating, title, body, created_at, verified_purchase FROM reviews WHERE product_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ? OFFSET ?",
    productId, limit, offset,
  ).map((r) => ({ id: r.id, authorName: r.author_name, rating: r.rating, title: r.title, body: r.body, createdAt: r.created_at, verified: Boolean(r.verified_purchase) }));
}

export function createReview(userId: string, productId: number, input: { rating: number; title: string; body: string; authorName: string }): { status: 'pending' | 'approved' } {
  const s = getSettings().reviews;
  if (!s.enabled) throw new HttpError(403, 'Avaliações estão desativadas no momento.', 'reviews_disabled');
  const el = reviewEligibility(userId, productId);
  if (!el.eligible) throw new HttpError(403, el.reason ?? 'Avaliação não permitida.', 'not_eligible');
  const status = s.requireModeration ? 'pending' : 'approved';
  getDb().run('INSERT INTO reviews (product_id, user_id, order_id, author_name, rating, title, body, status, moderated_at, verified_purchase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    productId, userId, el.orderId, input.authorName, input.rating, input.title, input.body, status, status === 'approved' ? nowIso() : null);
  return { status };
}

export function adminReviews(status?: string): AdminReviewDTO[] {
  return getDb().all<Record<string, unknown>>(
    `SELECT r.*, p.name AS product_name, p.slug AS product_slug, u.email, o.number AS order_number FROM reviews r JOIN products p ON p.id = r.product_id
       LEFT JOIN users u ON u.id = r.user_id LEFT JOIN orders o ON o.id = r.order_id WHERE (? IS NULL OR r.status = ?) ORDER BY r.created_at DESC LIMIT 300`, status ?? null, status ?? null,
  ).map((r) => ({
    id: r.id as number, productId: r.product_id as number, productName: r.product_name as string, productSlug: r.product_slug as string, authorName: r.author_name as string,
    email: (r.email as string) ?? null, rating: r.rating as number, title: r.title as string, body: r.body as string, status: r.status as AdminReviewDTO['status'],
    orderNumber: (r.order_number as string) ?? null, createdAt: r.created_at as string, moderatedAt: (r.moderated_at as string) ?? null,
  }));
}

export function moderateReview(id: number, action: 'approved' | 'rejected' | 'pending', actor: string, note: string | null, ip?: string): void {
  const db = getDb();
  db.tx(() => {
    const r = db.run('UPDATE reviews SET status = ?, moderated_at = ? WHERE id = ?', action, nowIso(), id);
    if (!r.changes) throw new HttpError(404, 'Avaliação não encontrada.', 'not_found');
    db.run('INSERT INTO review_moderation (review_id, actor, action, note) VALUES (?, ?, ?, ?)', id, actor, action, note);
    audit({ actor, action: `review.${action}`, entity: 'review', entityId: id, data: { note }, ip });
  });
}

// =====================================================================================
// Lista de espera ("avise-me quando chegar"): e-mail único por variante, aviso uma única vez.
// =====================================================================================

export function subscribeStockAlert(variantId: number, email: string, userId: string | null): { ok: true; already: boolean } {
  const db = getDb();
  const v = db.get<{ stock: number; is_active: number; p_active: number }>('SELECT v.stock, v.is_active, p.is_active AS p_active FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?', variantId);
  if (!v || !v.p_active) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
  if (v.stock > 0 && v.is_active) throw new HttpError(409, 'Este tamanho está disponível agora.', 'in_stock');
  const existing = db.get<{ id: number; notified_at: string | null; cancelled_at: string | null }>('SELECT id, notified_at, cancelled_at FROM stock_alerts WHERE variant_id = ? AND email = ?', variantId, email);
  if (existing && !existing.notified_at && !existing.cancelled_at) return { ok: true, already: true };
  if (existing) db.run('UPDATE stock_alerts SET notified_at = NULL, cancelled_at = NULL, created_at = ?, user_id = COALESCE(?, user_id) WHERE id = ?', nowIso(), userId, existing.id);
  else db.run('INSERT INTO stock_alerts (variant_id, email, user_id) VALUES (?, ?, ?)', variantId, email, userId);
  return { ok: true, already: false };
}

export async function notifyRestock(variantId: number): Promise<number> {
  const db = getDb();
  const v = db.get<{ sku: string; color_name: string; size: string; stock: number; name: string; slug: string; is_active: number }>(
    'SELECT v.sku, v.color_name, v.size, v.stock, p.name, p.slug, p.is_active FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?', variantId,
  );
  if (!v || v.stock <= 0 || !v.is_active) return 0;
  const subs = db.all<{ id: number; email: string }>('SELECT id, email FROM stock_alerts WHERE variant_id = ? AND notified_at IS NULL AND cancelled_at IS NULL ORDER BY id LIMIT 500', variantId);
  let n = 0;
  for (const s of subs) {
    const res = await notify({
      event: 'stock.restored', recipient: s.email, dedupeKey: `stock:${s.id}:${variantId}:${db.get<{ c: string }>('SELECT created_at AS c FROM stock_alerts WHERE id = ?', s.id)!.c}`,
      content: {
        subject: `${v.name} voltou ao estoque`, preheader: `${v.color_name}, tamanho ${v.size} disponível agora.`, title: 'Voltou ao estoque',
        intro: `O produto que você pediu para acompanhar está disponível: ${v.name} — ${v.color_name}, tamanho ${v.size}.`,
        blocks: ['As unidades são limitadas e não ficam reservadas: a disponibilidade é confirmada no carrinho.'],
        cta: { label: 'Ver produto', href: url(`/produto/${v.slug}`) },
        outro: 'Você recebeu este aviso porque se cadastrou na lista de espera deste produto. O aviso é enviado uma única vez.',
      },
    });
    if (res !== 'failed') { db.run('UPDATE stock_alerts SET notified_at = ? WHERE id = ?', nowIso(), s.id); n++; }
  }
  return n;
}

// =====================================================================================
// Newsletter com confirmação dupla (double opt-in) e descadastro em 1 clique.
// =====================================================================================

export const NEWSLETTER_CONSENT_TEXT = 'Quero receber e-mails da GAZU com lançamentos, coleções e conteúdos. Posso cancelar a qualquer momento pelo link presente em cada e-mail.';

export async function subscribeNewsletter(input: { email: string; name?: string | null; userId?: string | null; source: string; ip?: string; userAgent?: string }): Promise<{ status: 'pending' | 'confirmed' }> {
  if (!getSettings().newsletter.enabled) throw new HttpError(403, 'Newsletter indisponível no momento.', 'newsletter_disabled');
  const db = getDb();
  const existing = db.get<{ id: number; status: string }>('SELECT id, status FROM newsletter_subscribers WHERE email = ?', input.email);
  if (existing?.status === 'confirmed') return { status: 'confirmed' };
  const confirm = randomToken(24);
  const unsub = randomToken(24);
  if (existing) {
    db.run("UPDATE newsletter_subscribers SET status = 'pending', confirm_token_hash = ?, unsubscribe_token_hash = ?, consent_text = ?, source = ?, ip = ?, name = COALESCE(?, name), user_id = COALESCE(?, user_id), unsubscribed_at = NULL WHERE id = ?",
      sha256(confirm), sha256(unsub), NEWSLETTER_CONSENT_TEXT, input.source, input.ip ?? null, input.name ?? null, input.userId ?? null, existing.id);
  } else {
    db.run('INSERT INTO newsletter_subscribers (email, name, user_id, status, confirm_token_hash, unsubscribe_token_hash, source, consent_text, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      input.email, input.name ?? null, input.userId ?? null, 'pending', sha256(confirm), sha256(unsub), input.source, NEWSLETTER_CONSENT_TEXT, input.ip ?? null);
  }
  recordConsent({ subject: `email:${input.email}`, purpose: 'newsletter', granted: true, ip: input.ip, userAgent: input.userAgent, version: 'pendente-confirmacao' });
  await notify({
    event: 'newsletter.confirm', recipient: input.email, dedupeKey: `newsletter:${input.email}:${sha256(confirm).slice(0, 16)}`,
    content: {
      subject: 'Confirme sua inscrição — GAZU', preheader: 'Falta um clique para receber as novidades.', title: 'Confirme sua inscrição',
      intro: 'Recebemos um pedido para inscrever este e-mail na newsletter da GAZU. Para confirmar, use o botão abaixo.',
      blocks: [NEWSLETTER_CONSENT_TEXT], cta: { label: 'Confirmar inscrição', href: url(`/newsletter/confirmar?token=${encodeURIComponent(confirm)}&sair=${encodeURIComponent(unsub)}`) },
      outro: 'Se não foi você, ignore este e-mail: sem a confirmação, nada será enviado.',
    },
  });
  return { status: 'pending' };
}

export function confirmNewsletter(token: string, ip?: string): { email: string } {
  const db = getDb();
  const s = db.get<{ id: number; email: string }>("SELECT id, email FROM newsletter_subscribers WHERE confirm_token_hash = ? AND status = 'pending'", sha256(token));
  if (!s) throw new HttpError(400, 'Link de confirmação inválido ou já utilizado.', 'invalid_token');
  db.run("UPDATE newsletter_subscribers SET status = 'confirmed', confirmed_at = ?, confirm_token_hash = NULL WHERE id = ?", nowIso(), s.id);
  db.run('UPDATE users SET marketing_opt_in = 1 WHERE email = ?', s.email);
  recordConsent({ subject: `email:${s.email}`, purpose: 'newsletter', granted: true, ip });
  return { email: s.email };
}

export function unsubscribeNewsletter(token: string, ip?: string): { email: string } {
  const db = getDb();
  const s = db.get<{ id: number; email: string }>('SELECT id, email FROM newsletter_subscribers WHERE unsubscribe_token_hash = ?', sha256(token));
  if (!s) throw new HttpError(400, 'Link de descadastro inválido.', 'invalid_token');
  db.run("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?", nowIso(), s.id);
  db.run('UPDATE users SET marketing_opt_in = 0 WHERE email = ?', s.email);
  recordConsent({ subject: `email:${s.email}`, purpose: 'newsletter', granted: false, ip });
  return { email: s.email };
}

// =====================================================================================
// Carrinho abandonado: um lembrete por carrinho, apenas para clientes com opt-in de marketing.
// =====================================================================================

export async function remindAbandonedCarts(): Promise<number> {
  const db = getDb();
  const hours = getSettings().operations.abandonedCartHours;
  const before = new Date(Date.now() - hours * 3600_000).toISOString();
  const after = new Date(Date.now() - 7 * 86400_000).toISOString();
  const carts = db.all<{ id: number; user_id: string; email: string; name: string | null; updated_at: string }>(
    `SELECT c.id, c.user_id, u.email, p.full_name AS name, c.updated_at FROM carts c JOIN users u ON u.id = c.user_id LEFT JOIN profiles p ON p.user_id = u.id
      WHERE c.reminder_sent_at IS NULL AND c.updated_at < ? AND c.updated_at > ? AND u.marketing_opt_in = 1 AND u.anonymized_at IS NULL AND u.is_guest = 0
        AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = c.user_id AND o.created_at > c.updated_at) LIMIT 50`, before, after,
  );
  let n = 0;
  for (const c of carts) {
    const items = db.all<{ name: string; color_name: string; size: string; quantity: number }>(
      'SELECT p.name, v.color_name, v.size, ci.quantity FROM cart_items ci JOIN product_variants v ON v.id = ci.variant_id JOIN products p ON p.id = v.product_id WHERE ci.cart_id = ? AND p.is_active = 1 AND v.is_active = 1', c.id,
    );
    db.run('UPDATE carts SET reminder_sent_at = ? WHERE id = ?', nowIso(), c.id);
    if (!items.length) continue;
    await notify({
      event: 'cart.abandoned', recipient: c.email, userId: c.user_id, dedupeKey: `cart:${c.id}:${c.updated_at}`,
      content: {
        subject: 'Seus itens continuam no carrinho — GAZU', preheader: 'Retome a compra quando quiser.', title: 'Ficou alguma coisa para trás?',
        intro: `${(c.name ?? '').split(' ')[0] || 'Olá'}, separamos o que você deixou no carrinho. Preço e disponibilidade são confirmados na finalização.`,
        rows: items.map((i) => [`${i.quantity}× ${i.name}`, `${i.color_name}, ${i.size}`]),
        cta: { label: 'Voltar ao carrinho', href: url('/carrinho') },
        outro: 'Você recebeu este e-mail porque autorizou comunicações da GAZU. Para não receber mais, use o link de descadastro da newsletter ou ajuste na sua conta.',
      },
    });
    n++;
  }
  return n;
}

// =====================================================================================
// Vistos recentemente (sincronizado para clientes com conta).
// =====================================================================================

export function trackViewed(userId: string, productId: number): void {
  const db = getDb();
  if (!db.get('SELECT 1 FROM products WHERE id = ? AND is_active = 1', productId)) return;
  db.run('INSERT INTO recently_viewed (user_id, product_id, viewed_at) VALUES (?, ?, ?) ON CONFLICT(user_id, product_id) DO UPDATE SET viewed_at = excluded.viewed_at', userId, productId, nowIso());
  db.run('DELETE FROM recently_viewed WHERE user_id = ? AND product_id NOT IN (SELECT product_id FROM recently_viewed WHERE user_id = ? ORDER BY viewed_at DESC LIMIT 30)', userId, userId);
}
export function recentlyViewedIds(userId: string): number[] {
  return getDb().all<{ product_id: number }>('SELECT product_id FROM recently_viewed WHERE user_id = ? ORDER BY viewed_at DESC LIMIT 30', userId).map((r) => r.product_id);
}

export function registerEngagementHandlers(): void {
  on('stock.restored', ({ variantId }) => notifyRestock(variantId).then(() => undefined));
}
