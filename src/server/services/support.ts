import crypto from 'node:crypto';
import { env, features } from '../config.ts';
import { getDb, nowIso } from '../db.ts';
import { HttpError } from '../http.ts';
import { emit } from '../events.ts';
import { randomToken, safeEqual, sha256 } from '../security.ts';
import { TICKET_STATUS_LABEL } from '../../shared/format.ts';
import type { TicketCategory, TicketDTO, TicketMessageDTO, TicketStatus } from '../../shared/types.ts';
import { notify } from './notifications.ts';
import { audit } from './audit.ts';
import { logError } from './monitoring.ts';

// Central de atendimento.
// - Canais: formulário do site, e-mail (respostas da equipe), WhatsApp (link wa.me sempre; API oficial da Meta quando configurada).
// - Observações internas (is_internal = 1) NUNCA são retornadas ao cliente nem enviadas por e-mail/WhatsApp.
// - Cliente sem conta acessa o chamado por token exclusivo (hash no banco), enviado no e-mail de confirmação.
// - Nenhuma conversa é criada pela loja: só existem mensagens enviadas por clientes ou pela equipe.

const url = (p: string) => new URL(p, env.APP_URL).toString();

export interface NewTicket {
  name: string; email: string; phone?: string | null; category: TicketCategory; subject: string; message: string;
  orderNumber?: string | null; productId?: number | null; userId?: string | null; channel?: 'site' | 'whatsapp' | 'email' | 'telefone'; whatsappWaId?: string | null; externalId?: string | null;
}

export function createTicket(t: NewTicket): { id: number; number: string; token: string } {
  const db = getDb();
  return db.tx(() => {
    let orderId: number | null = null;
    if (t.orderNumber) {
      const o = db.get<{ id: number; user_id: string; email: string }>('SELECT o.id, o.user_id, COALESCE(o.customer_email, u.email) AS email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.number = ?', t.orderNumber.trim().toUpperCase());
      // Só vincula o pedido se pertencer a quem abriu o chamado (conta ou e-mail da compra).
      if (o && (o.user_id === t.userId || o.email.toLowerCase() === t.email.toLowerCase())) orderId = o.id;
    }
    const token = randomToken(24);
    const tmp = `TMP-${crypto.randomUUID()}`;
    const priority = ['defeito', 'reembolso', 'pagamento'].includes(t.category) ? 'high' : 'normal';
    const id = db.run(
      `INSERT INTO support_tickets (number, user_id, email, name, phone, order_id, product_id, category, subject, priority, channel, access_hash, whatsapp_wa_id, last_customer_message_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tmp, t.userId ?? null, t.email, t.name, t.phone ?? null, orderId, t.productId ?? null, t.category, t.subject, priority, t.channel ?? 'site', sha256(token), t.whatsappWaId ?? null, nowIso(),
    ).lastInsertRowid;
    const number = `AT${String(10000 + id)}`;
    db.run('UPDATE support_tickets SET number = ? WHERE id = ?', number, id);
    db.run("INSERT INTO support_messages (ticket_id, author_type, author_id, body, channel, external_id) VALUES (?, 'customer', ?, ?, ?, ?)", id, t.userId ?? null, t.message, t.channel ?? 'site', t.externalId ?? null);
    return { id, number, token };
  });
}

export async function sendTicketConfirmation(ticketId: number, token: string): Promise<void> {
  const t = getDb().get<{ number: string; email: string; name: string; subject: string }>('SELECT number, email, name, subject FROM support_tickets WHERE id = ?', ticketId);
  if (!t || t.email.endsWith('.invalid')) return;
  await notify({
    event: 'ticket.created', recipient: t.email, dedupeKey: `ticket:${ticketId}:created`,
    content: {
      subject: `Recebemos sua mensagem — atendimento ${t.number}`, preheader: 'Nossa equipe vai responder por aqui e por e-mail.', title: `Atendimento ${t.number}`,
      intro: `${t.name.split(' ')[0]}, recebemos sua mensagem sobre "${t.subject}". Responderemos assim que possível.`,
      blocks: ['Use o botão abaixo para acompanhar e responder ao atendimento. Guarde este e-mail: o link é o seu acesso.'],
      cta: { label: 'Acompanhar atendimento', href: url(`/atendimento/${t.number}?acesso=${encodeURIComponent(token)}`) },
    },
  });
}

interface TicketRow {
  id: number; number: string; user_id: string | null; email: string; name: string; phone: string | null; order_id: number | null; product_id: number | null; category: TicketCategory;
  subject: string; status: TicketStatus; priority: TicketDTO['priority']; assignee_id: string | null; channel: string; access_hash: string | null; whatsapp_wa_id: string | null;
  created_at: string; updated_at: string; closed_at: string | null; last_customer_message_at: string | null;
}

export function getTicket(id: number, opts: { admin: boolean }): TicketDTO | null {
  const db = getDb();
  const t = db.get<TicketRow>('SELECT * FROM support_tickets WHERE id = ?', id);
  if (!t) return null;
  const assignee = t.assignee_id ? db.get<{ id: string; name: string }>("SELECT u.id, COALESCE(NULLIF(p.full_name, ''), u.email) AS name FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", t.assignee_id) : null;
  const messages = db.all<{ id: number; author_type: TicketMessageDTO['authorType']; author_id: string | null; body: string; is_internal: number; channel: string; created_at: string; author_name: string | null }>(
    `SELECT m.*, COALESCE(NULLIF(p.full_name, ''), 'Equipe GAZU') AS author_name FROM support_messages m LEFT JOIN profiles p ON p.user_id = m.author_id
      WHERE m.ticket_id = ? ${opts.admin ? '' : 'AND m.is_internal = 0'} ORDER BY m.id`, id,
  ).map((m) => ({
    id: m.id, authorType: m.author_type, authorName: m.author_type === 'customer' ? t.name : m.author_type === 'staff' ? (opts.admin ? m.author_name : 'Equipe GAZU') : 'Sistema',
    body: m.body, internal: Boolean(m.is_internal), channel: m.channel, createdAt: m.created_at,
  }));
  return {
    id: t.id, number: t.number, subject: t.subject, category: t.category, status: t.status, priority: t.priority, channel: t.channel, name: t.name, email: t.email, phone: t.phone,
    orderNumber: t.order_id ? db.get<{ number: string }>('SELECT number FROM orders WHERE id = ?', t.order_id)?.number ?? null : null,
    productName: t.product_id ? db.get<{ name: string }>('SELECT name FROM products WHERE id = ?', t.product_id)?.name ?? null : null,
    assignee: opts.admin ? assignee ?? null : null, createdAt: t.created_at, updatedAt: t.updated_at, closedAt: t.closed_at, lastCustomerMessageAt: t.last_customer_message_at, messages,
  };
}

/** Acesso do cliente: dono autenticado ou token do link enviado por e-mail. */
export function customerTicketId(number: string, userId: string | null, token: string | null): number {
  const t = getDb().get<{ id: number; user_id: string | null; access_hash: string | null }>('SELECT id, user_id, access_hash FROM support_tickets WHERE number = ?', number);
  if (t && userId && t.user_id === userId) return t.id;
  if (t && token && t.access_hash && safeEqual(sha256(token), t.access_hash)) return t.id;
  throw new HttpError(404, 'Atendimento não encontrado.', 'not_found');
}

export function customerReply(ticketId: number, body: string, userId: string | null): void {
  const db = getDb();
  db.tx(() => {
    const t = db.get<{ status: TicketStatus }>('SELECT status FROM support_tickets WHERE id = ?', ticketId)!;
    if (t.status === 'closed') throw new HttpError(409, 'Este atendimento foi encerrado. Abra um novo, se precisar.', 'ticket_closed');
    db.run("INSERT INTO support_messages (ticket_id, author_type, author_id, body, channel) VALUES (?, 'customer', ?, ?, 'site')", ticketId, userId, body);
    db.run("UPDATE support_tickets SET status = CASE WHEN status IN ('waiting_customer','resolved') THEN 'open' ELSE status END, last_customer_message_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), ticketId);
  });
}

/** Resposta da equipe. Mensagens internas ficam só no painel. Externas vão por e-mail e, se for o canal, por WhatsApp. */
export async function staffReply(ticketId: number, staffId: string, body: string, internal: boolean, ip?: string): Promise<{ delivery: string }> {
  const db = getDb();
  const t = db.get<TicketRow>('SELECT * FROM support_tickets WHERE id = ?', ticketId);
  if (!t) throw new HttpError(404, 'Atendimento não encontrado.', 'not_found');
  const messageId = db.tx(() => {
    const id = db.run("INSERT INTO support_messages (ticket_id, author_type, author_id, body, is_internal, channel) VALUES (?, 'staff', ?, ?, ?, ?)", ticketId, staffId, body, internal ? 1 : 0, internal ? 'interno' : t.channel).lastInsertRowid;
    if (!internal) db.run("UPDATE support_tickets SET status = CASE WHEN status IN ('open','in_progress') THEN 'waiting_customer' ELSE status END, assignee_id = COALESCE(assignee_id, ?), updated_at = ? WHERE id = ?", staffId, nowIso(), ticketId);
    return id;
  });
  audit({ actor: `admin:${staffId}`, action: internal ? 'ticket.internal_note' : 'ticket.reply', entity: 'ticket', entityId: ticketId, ip });
  if (internal) return { delivery: 'internal' };
  emit('ticket.replied', { ticketId, messageId });
  let delivery = 'email';
  if (t.channel === 'whatsapp' && t.whatsapp_wa_id) {
    const windowOpen = t.last_customer_message_at && Date.now() - Date.parse(t.last_customer_message_at) < 24 * 3600_000;
    if (features.whatsappApi && windowOpen) {
      try {
        const wamid = await sendWhatsAppText(t.whatsapp_wa_id, body);
        db.run('UPDATE support_messages SET external_id = ? WHERE id = ?', wamid, messageId);
        delivery = 'whatsapp';
      } catch (e) {
        logError('error', 'whatsapp:send', e, { ticketId });
        delivery = 'whatsapp_failed';
      }
    } else {
      delivery = features.whatsappApi ? 'whatsapp_window_closed' : 'whatsapp_not_configured';
    }
  }
  if (!t.email.endsWith('.invalid')) {
    await notify({
      event: 'ticket.reply', recipient: t.email, dedupeKey: `ticket:${ticketId}:msg:${messageId}`,
      content: {
        subject: `Resposta do atendimento ${t.number} — GAZU`, preheader: body.slice(0, 90), title: `Atendimento ${t.number}`,
        intro: `${t.name.split(' ')[0]}, respondemos sua mensagem sobre "${t.subject}":`, blocks: [body],
        cta: { label: 'Responder', href: t.user_id ? url(`/conta/atendimento/${t.number}`) : url('/atendimento') },
        outro: t.user_id ? undefined : 'Para responder, use o link do primeiro e-mail deste atendimento.',
      },
    });
  }
  return { delivery };
}

export function updateTicket(ticketId: number, actor: string, patch: { status?: TicketStatus; priority?: TicketDTO['priority']; assigneeId?: string | null; category?: TicketCategory }, ip?: string): void {
  const db = getDb();
  const t = db.get<{ status: TicketStatus }>('SELECT status FROM support_tickets WHERE id = ?', ticketId);
  if (!t) throw new HttpError(404, 'Atendimento não encontrado.', 'not_found');
  if (patch.assigneeId) {
    const staff = db.get("SELECT 1 FROM users WHERE id = ? AND role = 'admin'", patch.assigneeId);
    if (!staff) throw new HttpError(400, 'Responsável inválido.', 'bad_assignee');
  }
  db.run(
    `UPDATE support_tickets SET status = COALESCE(?, status), priority = COALESCE(?, priority), category = COALESCE(?, category),
       assignee_id = CASE WHEN ? THEN ? ELSE assignee_id END, closed_at = CASE WHEN ? = 'closed' THEN ? ELSE closed_at END, updated_at = ? WHERE id = ?`,
    patch.status ?? null, patch.priority ?? null, patch.category ?? null, patch.assigneeId !== undefined ? 1 : 0, patch.assigneeId ?? null, patch.status ?? null, nowIso(), nowIso(), ticketId,
  );
  if (patch.status && patch.status !== t.status) {
    db.run("INSERT INTO support_messages (ticket_id, author_type, body, is_internal, channel) VALUES (?, 'system', ?, 1, 'interno')", ticketId, `Status alterado para "${TICKET_STATUS_LABEL[patch.status]}".`);
  }
  audit({ actor, action: 'ticket.update', entity: 'ticket', entityId: ticketId, data: patch, ip });
}

export function listTickets(f: { status?: string | null; q?: string | null; mine?: string | null; channel?: string | null }) {
  const where: string[] = ['1=1'];
  const params: string[] = [];
  if (f.status === 'active') where.push("t.status IN ('open','in_progress','waiting_customer')");
  else if (f.status) { where.push('t.status = ?'); params.push(f.status); }
  if (f.channel) { where.push('t.channel = ?'); params.push(f.channel); }
  if (f.mine) { where.push('t.assignee_id = ?'); params.push(f.mine); }
  if (f.q) { where.push('(t.number LIKE ? OR t.email LIKE ? OR t.name LIKE ? OR t.subject LIKE ?)'); const q = `%${f.q}%`; params.push(q, q, q, q); }
  return getDb().all(
    `SELECT t.id, t.number, t.subject, t.category, t.status, t.priority, t.channel, t.name, t.email, t.created_at AS createdAt, t.updated_at AS updatedAt,
            t.last_customer_message_at AS lastCustomerMessageAt, o.number AS orderNumber, COALESCE(NULLIF(p.full_name, ''), u.email) AS assignee,
            (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id AND m.is_internal = 0) AS messages
       FROM support_tickets t LEFT JOIN orders o ON o.id = t.order_id LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN profiles p ON p.user_id = u.id
      WHERE ${where.join(' AND ')} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT 200`, ...params,
  );
}

// =====================================================================================
// WhatsApp Business — API oficial (Cloud API da Meta). Requer conta Business verificada,
// número registrado, token permanente e App Secret (configurados pelo responsável da loja).
// =====================================================================================

export type FetchLike = typeof fetch;
let waFetch: FetchLike = (...a) => fetch(...a);
export function setWhatsAppFetch(f: FetchLike | null): void { waFetch = f ?? ((...a) => fetch(...a)); }

/** Valida X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o App Secret). */
export function verifyWhatsAppSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, header);
}

export async function sendWhatsAppText(to: string, body: string): Promise<string> {
  if (!features.whatsappApi) throw new HttpError(503, 'WhatsApp Business API não configurada.', 'whatsapp_not_configured');
  const resp = await waFetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: body.slice(0, 4096) } }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await resp.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!resp.ok || !json.messages?.[0]?.id) throw new Error(`WhatsApp API HTTP ${resp.status}${json.error?.code ? ` (código ${json.error.code})` : ''}`);
  return json.messages[0].id;
}

interface WaPayload {
  entry?: { changes?: { field?: string; value?: { contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: { from: string; id: string; timestamp?: string; type: string; text?: { body?: string } }[] } }[] }[];
}

/** Processa mensagens recebidas (webhook já autenticado). Idempotente pelo id da mensagem (wamid). */
export function processWhatsAppInbound(payload: WaPayload): { received: number; duplicates: number } {
  const db = getDb();
  let received = 0, duplicates = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      for (const m of v?.messages ?? []) {
        if (db.get('SELECT 1 FROM support_messages WHERE external_id = ?', m.id)) { duplicates++; continue; }
        const name = v?.contacts?.find((c) => c.wa_id === m.from)?.profile?.name?.slice(0, 120) || `WhatsApp ${m.from.slice(-4)}`;
        const text = m.type === 'text' ? (m.text?.body ?? '').slice(0, 4000) : `[Mensagem do tipo "${m.type}" recebida — visualize no aplicativo do WhatsApp Business]`;
        const open = db.get<{ id: number }>("SELECT id FROM support_tickets WHERE whatsapp_wa_id = ? AND status <> 'closed' ORDER BY id DESC LIMIT 1", m.from);
        if (open) {
          db.tx(() => {
            db.run("INSERT INTO support_messages (ticket_id, author_type, body, channel, external_id) VALUES (?, 'customer', ?, 'whatsapp', ?)", open.id, text, m.id);
            db.run("UPDATE support_tickets SET status = CASE WHEN status IN ('waiting_customer','resolved') THEN 'open' ELSE status END, last_customer_message_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), open.id);
          });
        } else {
          createTicket({
            name, email: `whatsapp-${m.from}@sem-email.invalid`, phone: `+${m.from}`, category: 'contato', subject: text.slice(0, 80) || 'Mensagem via WhatsApp',
            message: text, channel: 'whatsapp', whatsappWaId: m.from, externalId: m.id,
          });
        }
        received++;
      }
    }
  }
  return { received, duplicates };
}
