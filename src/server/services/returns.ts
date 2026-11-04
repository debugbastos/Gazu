import { getDb, nowIso } from '../db.ts';
import { HttpError } from '../http.ts';
import { emit, on } from '../events.ts';
import { RETURN_STATUS_LABEL } from '../../shared/format.ts';
import type { ReturnDTO, ReturnStatus, ReturnType } from '../../shared/types.ts';
import { addOrderEvent } from './orders.ts';
import { moveStock } from './inventory.ts';
import { getSettings } from './settings.ts';
import { audit } from './audit.ts';

// Trocas e devoluções.
// Prazos legais (Código de Defesa do Consumidor) contados a partir da entrega:
// - desistência/arrependimento em compras fora do estabelecimento: 7 dias (art. 49);
// - vício aparente em produto durável: 90 dias (art. 26, II).
// Troca por tamanho/cor é política comercial da loja: prazo em configurações (sem prazo = análise caso a caso).

export const WITHDRAWAL_DAYS = 7;
export const DEFECT_DAYS = 90;

const DAY = 86400_000;

export interface Eligibility { deliveredAt: string | null; options: { type: ReturnType; allowed: boolean; deadline: string | null; reason: string | null }[] }

function deliveredAt(orderId: number): string | null {
  const db = getDb();
  const s = db.get<{ delivered_at: string | null }>("SELECT delivered_at FROM shipments WHERE order_id = ? AND status = 'delivered' ORDER BY delivered_at DESC LIMIT 1", orderId);
  if (s?.delivered_at) return s.delivered_at;
  const o = db.get<{ status: string; updated_at: string }>('SELECT status, updated_at FROM orders WHERE id = ?', orderId);
  return o?.status === 'delivered' ? o.updated_at : null;
}

export function returnEligibility(orderId: number, now = Date.now()): Eligibility {
  const at = deliveredAt(orderId);
  const exchangeDays = getSettings().operations.exchangeDays;
  if (!at) {
    return { deliveredAt: null, options: (['withdrawal', 'exchange', 'defect', 'other'] as ReturnType[]).map((type) => ({ type, allowed: false, deadline: null, reason: 'Disponível após a confirmação da entrega.' })) };
  }
  const base = Date.parse(at);
  const window = (days: number | null) => (days === null ? null : new Date(base + days * DAY).toISOString());
  const opt = (type: ReturnType, days: number | null) => {
    const deadline = window(days);
    const allowed = deadline === null || now <= Date.parse(deadline);
    return { type, allowed, deadline, reason: allowed ? null : `Prazo encerrado em ${new Date(deadline!).toLocaleDateString('pt-BR')}.` };
  };
  return { deliveredAt: at, options: [opt('withdrawal', WITHDRAWAL_DAYS), opt('exchange', exchangeDays), opt('defect', DEFECT_DAYS), { type: 'other', allowed: true, deadline: null, reason: null }] };
}

function addReturnEvent(returnId: number, status: string, message: string, actor: string, internal = false): void {
  getDb().run('INSERT INTO return_events (return_id, status, message, actor, is_internal) VALUES (?, ?, ?, ?, ?)', returnId, status, message, actor, internal ? 1 : 0);
}

export function createReturnRequest(input: { orderId: number; userId: string; type: ReturnType; reason: string; items: { orderItemId: number; quantity: number }[]; actor: string }): ReturnDTO {
  const db = getDb();
  return db.tx(() => {
    const order = db.get<{ id: number; status: string; number: string }>('SELECT id, status, number FROM orders WHERE id = ?', input.orderId);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
    const elig = returnEligibility(order.id).options.find((o) => o.type === input.type);
    if (!elig?.allowed) throw new HttpError(409, elig?.reason ?? 'Solicitação não disponível para este pedido.', 'return_not_allowed');
    if (!input.items.length) throw new HttpError(400, 'Selecione ao menos um item.', 'items_required');
    for (const it of input.items) {
      const oi = db.get<{ quantity: number }>('SELECT quantity FROM order_items WHERE id = ? AND order_id = ?', it.orderItemId, order.id);
      if (!oi) throw new HttpError(400, 'Item não pertence a este pedido.', 'invalid_item');
      const already = db.get<{ n: number }>(
        "SELECT COALESCE(SUM(ri.quantity), 0) AS n FROM return_items ri JOIN return_requests rr ON rr.id = ri.return_id WHERE ri.order_item_id = ? AND rr.status <> 'rejected'", it.orderItemId,
      )!.n;
      if (it.quantity > oi.quantity - already) throw new HttpError(409, 'Quantidade maior que a disponível para troca/devolução neste item.', 'quantity_exceeded');
    }
    const tmp = `TMP-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const id = db.run('INSERT INTO return_requests (number, order_id, user_id, type, reason) VALUES (?, ?, ?, ?, ?)', tmp, order.id, input.userId, input.type, input.reason).lastInsertRowid;
    db.run('UPDATE return_requests SET number = ? WHERE id = ?', `TR${String(10000 + id)}`, id);
    for (const it of input.items) db.run('INSERT INTO return_items (return_id, order_item_id, quantity) VALUES (?, ?, ?)', id, it.orderItemId, it.quantity);
    addReturnEvent(id, 'requested', 'Solicitação registrada. Nossa equipe vai analisar e responder por e-mail.', input.actor);
    addOrderEvent(order.id, 'return_requested', `Solicitação de ${input.type === 'exchange' ? 'troca' : 'devolução'} TR${10000 + id} aberta.`, input.actor);
    emit('return.updated', { returnId: id, status: 'requested' });
    return getReturn(id, { admin: false })!;
  });
}

/** Transições do fluxo de trocas/devoluções no painel. */
const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['awaiting_item', 'received', 'closed'],
  awaiting_item: ['received', 'closed'],
  received: ['exchanged', 'closed'],     // "refunded" só é aplicado quando o provedor confirma o estorno
  refunded: ['closed'],
  exchanged: ['closed'],
  rejected: [],
  closed: [],
};

export function adminUpdateReturn(returnId: number, actor: string, patch: { status?: ReturnStatus; message?: string; internal?: boolean; restock?: boolean; resolution?: string | null }, ip?: string): ReturnDTO {
  const db = getDb();
  return db.tx(() => {
    const r = db.get<{ id: number; status: ReturnStatus; order_id: number; number: string }>('SELECT id, status, order_id, number FROM return_requests WHERE id = ?', returnId);
    if (!r) throw new HttpError(404, 'Solicitação não encontrada.', 'not_found');
    if (patch.status && patch.status !== r.status) {
      if (!RETURN_TRANSITIONS[r.status].includes(patch.status)) throw new HttpError(409, `Transição não permitida: ${RETURN_STATUS_LABEL[r.status]} → ${RETURN_STATUS_LABEL[patch.status]}.`, 'invalid_transition');
      db.run('UPDATE return_requests SET status = ?, resolution = COALESCE(?, resolution), updated_at = ? WHERE id = ?', patch.status, patch.resolution ?? null, nowIso(), r.id);
      addReturnEvent(r.id, patch.status, patch.message?.trim() || `Status atualizado: ${RETURN_STATUS_LABEL[patch.status]}.`, actor, false);
      addOrderEvent(r.order_id, `return_${patch.status}`, `Troca/devolução ${r.number}: ${RETURN_STATUS_LABEL[patch.status]}.`, actor);
      if (patch.status === 'received' && patch.restock) restockReturn(r.id, r.order_id, actor);
      emit('return.updated', { returnId: r.id, status: patch.status });
    } else if (patch.message?.trim()) {
      addReturnEvent(r.id, r.status, patch.message.trim(), actor, Boolean(patch.internal));
      if (!patch.internal) emit('return.updated', { returnId: r.id, status: r.status });
    }
    audit({ actor, action: 'return.update', entity: 'return', entityId: r.id, data: patch, ip });
    return getReturn(r.id, { admin: true })!;
  });
}

/** Devolve ao estoque os itens recebidos (uma única vez por item). */
export function restockReturn(returnId: number, orderId: number, actor: string): number {
  const db = getDb();
  let n = 0;
  for (const it of db.all<{ id: number; quantity: number; variant_id: number | null }>(
    'SELECT ri.id, ri.quantity, oi.variant_id FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_id = ? AND ri.restocked = 0', returnId,
  )) {
    if (it.variant_id) moveStock(it.variant_id, it.quantity, 'restock', actor, orderId, `Retorno ${returnId}`);
    db.run('UPDATE return_items SET restocked = 1 WHERE id = ?', it.id);
    n += it.quantity;
  }
  if (n) addReturnEvent(returnId, 'received', `${n} item(ns) devolvido(s) ao estoque.`, actor, true);
  return n;
}

export function getReturn(id: number, opts: { admin: boolean }): ReturnDTO | null {
  const db = getDb();
  const r = db.get<{ id: number; number: string; order_id: number; type: ReturnType; reason: string; status: ReturnStatus; resolution: string | null; refund_amount_cents: number | null; created_at: string; updated_at: string }>(
    'SELECT * FROM return_requests WHERE id = ?', id,
  );
  if (!r) return null;
  const order = db.get<{ number: string; customer_email: string | null; customer_name: string | null }>('SELECT number, customer_email, customer_name FROM orders WHERE id = ?', r.order_id)!;
  return {
    id: r.id, number: r.number, orderNumber: order.number, type: r.type, reason: r.reason, status: r.status, resolution: r.resolution, refundAmountCents: r.refund_amount_cents,
    createdAt: r.created_at, updatedAt: r.updated_at,
    items: db.all<{ order_item_id: number; quantity: number; product_name: string; color_name: string; size: string; sku: string; restocked: number }>(
      'SELECT ri.order_item_id, ri.quantity, ri.restocked, oi.product_name, oi.color_name, oi.size, oi.sku FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_id = ?', r.id,
    ).map((i) => ({ orderItemId: i.order_item_id, quantity: i.quantity, productName: i.product_name, colorName: i.color_name, size: i.size, sku: i.sku, restocked: Boolean(i.restocked) })),
    events: db.all<{ status: string; message: string; actor: string; is_internal: number; created_at: string }>(
      `SELECT * FROM return_events WHERE return_id = ? ${opts.admin ? '' : 'AND is_internal = 0'} ORDER BY id`, r.id,
    ).map((e) => ({ status: e.status, message: e.message, actor: e.actor.startsWith('admin:') ? 'equipe' : e.actor.startsWith('customer:') ? 'cliente' : 'sistema', internal: Boolean(e.is_internal), createdAt: e.created_at })),
    ...(opts.admin ? { customerEmail: order.customer_email, customerName: order.customer_name } : {}),
  };
}

export function listReturns(filter: { status?: string; orderId?: number; userId?: string } = {}): ReturnDTO[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.status) { where.push('status = ?'); params.push(filter.status); }
  if (filter.orderId) { where.push('order_id = ?'); params.push(filter.orderId); }
  if (filter.userId) { where.push('user_id = ?'); params.push(filter.userId); }
  return getDb().all<{ id: number }>(`SELECT id FROM return_requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 200`, ...params)
    .map((r) => getReturn(r.id, { admin: !filter.userId })!);
}

/** Quando o provedor confirma um estorno ligado a uma devolução, a devolução passa a "reembolsada". */
export function registerReturnHandlers(): void {
  on('refund.confirmed', ({ refundId }) => {
    const db = getDb();
    const ref = db.get<{ return_id: number | null; amount_cents: number }>('SELECT return_id, amount_cents FROM refunds WHERE id = ?', refundId);
    if (!ref?.return_id) return;
    db.tx(() => {
      const r = db.get<{ status: string }>('SELECT status FROM return_requests WHERE id = ?', ref.return_id);
      if (!r || r.status === 'refunded' || r.status === 'closed') return;
      db.run("UPDATE return_requests SET status = 'refunded', refund_amount_cents = COALESCE(refund_amount_cents, 0) + ?, updated_at = ? WHERE id = ?", ref.amount_cents, nowIso(), ref.return_id);
      addReturnEvent(ref.return_id!, 'refunded', 'Estorno confirmado pelo provedor de pagamento.', 'provider:mercadopago');
      emit('return.updated', { returnId: ref.return_id!, status: 'refunded' });
    });
  });
}
