import { getDb, nowIso } from '../db.ts';
import { HttpError } from '../http.ts';
import { destroyAllSessions } from '../auth/sessions.ts';
import { audit } from './audit.ts';

// LGPD (Lei 13.709/2018): registro de consentimentos, direitos do titular (acesso/portabilidade, correção,
// eliminação/anonimização) e retenção. Pedidos e pagamentos são MANTIDOS após a anonimização da conta
// pelo prazo legal de guarda de documentos fiscais e contábeis (base legal: cumprimento de obrigação legal,
// art. 7º, II e art. 16, I da LGPD) — o vínculo com a conta é desfeito e os dados de contato são removidos da conta.

export const CONSENT_VERSION = '2026-10';
export type ConsentPurpose = 'terms' | 'privacy' | 'newsletter' | 'marketing_email' | 'analytics' | 'whatsapp';

export function recordConsent(c: { subject: string; purpose: ConsentPurpose; granted: boolean; ip?: string; userAgent?: string; version?: string }): void {
  getDb().run('INSERT INTO consents (subject, purpose, granted, version, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    c.subject.slice(0, 200), c.purpose, c.granted ? 1 : 0, c.version ?? CONSENT_VERSION, c.ip ?? null, (c.userAgent ?? '').slice(0, 200) || null);
}

export function latestConsent(subject: string, purpose: ConsentPurpose): { granted: boolean; at: string; version: string } | null {
  const r = getDb().get<{ granted: number; created_at: string; version: string }>('SELECT granted, created_at, version FROM consents WHERE subject = ? AND purpose = ? ORDER BY id DESC LIMIT 1', subject, purpose);
  return r ? { granted: Boolean(r.granted), at: r.created_at, version: r.version } : null;
}

/** Exporta os dados pessoais do titular em formato estruturado (portabilidade/acesso). */
export function exportUserData(userId: string): Record<string, unknown> {
  const db = getDb();
  const user = db.get<{ id: string; email: string; created_at: string; email_verified_at: string | null; is_guest: number }>('SELECT id, email, created_at, email_verified_at, is_guest FROM users WHERE id = ?', userId);
  if (!user) throw new HttpError(404, 'Titular não encontrado.', 'not_found');
  const email = user.email;
  return {
    generatedAt: nowIso(),
    notice: 'Exportação dos dados pessoais mantidos pela GAZU (LGPD, art. 18). Dados de pagamento sensíveis (número do cartão, CVV) nunca são armazenados pela loja.',
    account: { email: user.email, createdAt: user.created_at, emailVerifiedAt: user.email_verified_at, guestCheckoutOnly: Boolean(user.is_guest) },
    profile: db.get('SELECT full_name AS name, phone, updated_at AS updatedAt FROM profiles WHERE user_id = ?', userId) ?? null,
    addresses: db.all('SELECT label, recipient, cep, street, number, complement, district, city, state FROM addresses WHERE user_id = ?', userId),
    orders: db.all<Record<string, unknown>>(
      `SELECT number, status, total_cents AS totalCents, created_at AS createdAt, ship_recipient AS recipient, ship_cep AS cep, ship_street AS street, ship_number AS number2,
              ship_city AS city, ship_state AS state, utm_source AS utmSource, utm_campaign AS utmCampaign FROM orders WHERE user_id = ? ORDER BY id`, userId,
    ).map((o) => ({ ...o, items: db.all('SELECT product_name AS product, color_name AS color, size, quantity, line_total_cents AS totalCents FROM order_items WHERE order_id = (SELECT id FROM orders WHERE number = ?)', o.number as string) })),
    favorites: db.all('SELECT p.name, f.created_at AS createdAt FROM favorites f JOIN products p ON p.id = f.product_id WHERE f.user_id = ?', userId),
    reviews: db.all('SELECT r.rating, r.title, r.body, r.status, r.created_at AS createdAt, p.name AS product FROM reviews r JOIN products p ON p.id = r.product_id WHERE r.user_id = ?', userId),
    supportTickets: db.all<{ id: number; number: string; subject: string; status: string; created_at: string }>('SELECT id, number, subject, status, created_at FROM support_tickets WHERE user_id = ? OR email = ?', userId, email)
      .map((t) => ({ number: t.number, subject: t.subject, status: t.status, createdAt: t.created_at, messages: db.all("SELECT author_type AS author, body, created_at AS createdAt FROM support_messages WHERE ticket_id = ? AND is_internal = 0 ORDER BY id", t.id) })),
    newsletter: db.get('SELECT status, source, consent_text AS consentText, created_at AS createdAt, confirmed_at AS confirmedAt, unsubscribed_at AS unsubscribedAt FROM newsletter_subscribers WHERE email = ?', email) ?? null,
    stockAlerts: db.all('SELECT v.sku, s.created_at AS createdAt, s.notified_at AS notifiedAt FROM stock_alerts s JOIN product_variants v ON v.id = s.variant_id WHERE s.email = ? OR s.user_id = ?', email, userId),
    consents: db.all('SELECT purpose, granted, version, created_at AS createdAt FROM consents WHERE subject IN (?, ?) ORDER BY id', `user:${userId}`, `email:${email}`),
    dataRequests: db.all('SELECT type, status, created_at AS createdAt, completed_at AS completedAt FROM data_requests WHERE user_id = ? OR email = ?', userId, email),
  };
}

export function createDataRequest(input: { userId: string | null; email: string; type: 'export' | 'deletion' | 'correction'; note?: string | null }): number {
  const db = getDb();
  const open = db.get<{ id: number }>("SELECT id FROM data_requests WHERE email = ? AND type = ? AND status IN ('requested','in_review')", input.email, input.type);
  if (open) return open.id;
  return db.run('INSERT INTO data_requests (user_id, email, type, note) VALUES (?, ?, ?, ?)', input.userId, input.email, input.type, input.note?.slice(0, 1000) ?? null).lastInsertRowid;
}

/**
 * Anonimiza a conta do titular. Mantém pedidos/pagamentos (obrigação legal) sem vínculo de contato,
 * remove endereços salvos, favoritos, carrinho, sessões, inscrições e alertas.
 */
export function anonymizeUser(userId: string, actor: string, ip?: string): void {
  const db = getDb();
  db.tx(() => {
    const u = db.get<{ email: string; role: string; anonymized_at: string | null }>('SELECT email, role, anonymized_at FROM users WHERE id = ?', userId);
    if (!u) throw new HttpError(404, 'Titular não encontrado.', 'not_found');
    if (u.role === 'admin') throw new HttpError(409, 'Contas da equipe não podem ser anonimizadas por aqui. Remova o acesso primeiro.', 'staff_account');
    if (u.anonymized_at) return;
    const placeholder = `anonimizado-${userId.slice(0, 8)}@anonimizado.invalid`;
    const oldEmail = u.email;
    db.run('UPDATE users SET email = ?, password_hash = NULL, google_sub = NULL, staff_role = NULL, anonymized_at = ?, updated_at = ? WHERE id = ?', placeholder, nowIso(), nowIso(), userId);
    db.run("UPDATE profiles SET full_name = 'Titular anonimizado', phone = NULL, updated_at = ? WHERE user_id = ?", nowIso(), userId);
    db.run('DELETE FROM addresses WHERE user_id = ?', userId);
    db.run('DELETE FROM favorites WHERE user_id = ?', userId);
    db.run('DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = ?)', userId);
    db.run("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = COALESCE(unsubscribed_at, ?), name = NULL, email = ?, user_id = NULL WHERE email = ? OR user_id = ?", nowIso(), `${placeholder}.nl`, oldEmail, userId);
    db.run('UPDATE stock_alerts SET cancelled_at = COALESCE(cancelled_at, ?), email = ? || id, user_id = NULL WHERE email = ? OR user_id = ?', nowIso(), 'anon-', oldEmail, userId);
    db.run("UPDATE reviews SET author_name = 'Cliente GAZU', user_id = NULL WHERE user_id = ?", userId);
    db.run("UPDATE support_tickets SET email = ?, name = 'Titular anonimizado', phone = NULL, whatsapp_wa_id = NULL, access_hash = NULL WHERE user_id = ? OR email = ?", placeholder, userId, oldEmail);
    // Pedidos: os dados de contato da compra deixam de apontar para o titular; endereço e itens ficam para fins fiscais.
    db.run('UPDATE orders SET customer_email = ?, customer_name = ?, guest_access_hash = NULL WHERE user_id = ?', placeholder, 'Titular anonimizado', userId);
    db.run('UPDATE analytics_events SET user_id = NULL WHERE user_id = ?', userId);
    db.run("UPDATE data_requests SET status = 'completed', completed_at = ?, handled_by = ? WHERE (user_id = ? OR email = ?) AND type = 'deletion' AND status IN ('requested','in_review')", nowIso(), actor, userId, oldEmail);
    destroyAllSessions(userId);
    audit({ actor, action: 'privacy.anonymize', entity: 'user', entityId: userId, data: { reason: 'LGPD — eliminação a pedido do titular' }, ip });
  });
}
