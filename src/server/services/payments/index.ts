import crypto from 'node:crypto';
import { env, features } from '../../config.ts';
import { getDb, nowIso } from '../../db.ts';
import { HttpError } from '../../http.ts';
import type { OrderDTO, PaymentStatus } from '../../../shared/types.ts';
import { addOrderEvent, getOrder, releaseOrder } from '../orders.ts';
import { createCardPayment, createPixPayment, getPayment, mapMpStatus, type MpPayment } from './mercadopago.ts';

interface PaymentRow {
  id: number; order_id: number; provider: 'mercadopago' | 'demo'; method: string; provider_payment_id: string | null; status: PaymentStatus;
  status_detail: string | null; amount_cents: number; idempotency_key: string; expires_at: string | null; updated_at: string;
}

const PROVIDER_ACTOR = { mercadopago: 'provider:mercadopago', demo: 'provider:demo' } as const;

function loadPayableOrder(orderId: number, userId: string): OrderDTO & { userId: string } {
  const row = getDb().get<{ user_id: string }>('SELECT user_id FROM orders WHERE id = ?', orderId);
  const order = getOrder(orderId);
  if (!row || !order || row.user_id !== userId) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
  if (order.status !== 'pending_payment') throw new HttpError(409, 'Este pedido não está aguardando pagamento.', 'not_payable');
  if (order.expiresAt && order.expiresAt < nowIso()) throw new HttpError(409, 'O prazo para pagamento deste pedido expirou.', 'order_expired');
  if (order.payments.some((p) => p.status === 'approved')) throw new HttpError(409, 'Este pedido já possui pagamento aprovado.', 'already_paid');
  if (order.isDemo && env.NODE_ENV === 'production' && !features.demoPayments) {
    throw new HttpError(409, 'Pedidos com produtos de demonstração não podem ser pagos em produção.', 'demo_order');
  }
  return { ...order, userId };
}

function insertPayment(orderId: number, provider: 'mercadopago' | 'demo', method: string, amountCents: number, expiresAt: string | null): PaymentRow {
  const key = crypto.randomUUID();
  const { lastInsertRowid } = getDb().run(
    "INSERT INTO payments (order_id, provider, method, status, amount_cents, idempotency_key, expires_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
    orderId, provider, method, amountCents, key, expiresAt,
  );
  return getDb().get<PaymentRow>('SELECT * FROM payments WHERE id = ?', lastInsertRowid)!;
}

function storeMpResult(paymentId: number, mp: MpPayment): void {
  const tx = mp.point_of_interaction?.transaction_data;
  getDb().run(
    `UPDATE payments SET provider_payment_id = ?, status = ?, status_detail = ?, pix_qr_code = COALESCE(?, pix_qr_code), pix_qr_base64 = COALESCE(?, pix_qr_base64),
       pix_ticket_url = COALESCE(?, pix_ticket_url), card_last_four = COALESCE(?, card_last_four), installments = COALESCE(?, installments), updated_at = ? WHERE id = ?`,
    String(mp.id), 'pending', mp.status_detail ?? null, tx?.qr_code ?? null, tx?.qr_code_base64 ?? null, tx?.ticket_url ?? null,
    mp.card?.last_four_digits ?? null, mp.installments ?? null, nowIso(), paymentId,
  );
}

export async function startPixPayment(orderId: number, user: { id: string; email: string }): Promise<OrderDTO> {
  if (!features.mercadoPagoPix) throw new HttpError(503, 'Pix ainda não está habilitado nesta loja.', 'pix_disabled');
  const order = loadPayableOrder(orderId, user.id);
  const expires = new Date(Math.min(Date.now() + env.PIX_EXPIRATION_MINUTES * 60_000, order.expiresAt ? Date.parse(order.expiresAt) : Infinity));
  const pay = insertPayment(orderId, 'mercadopago', 'pix', order.totalCents, expires.toISOString());
  try {
    const mp = await createPixPayment({ amountCents: order.totalCents, description: `Pedido ${order.number} — GAZU`, payerEmail: user.email, externalReference: order.number, expiresAt: expires, idempotencyKey: pay.idempotency_key });
    storeMpResult(pay.id, mp);
    await applyPaymentUpdate(pay.id, mapMpStatus(mp), mp.status_detail ?? null, Math.round(mp.transaction_amount * 100), 'mercadopago');
    addOrderEvent(orderId, 'payment_created', 'Cobrança Pix criada no provedor.', PROVIDER_ACTOR.mercadopago);
  } catch (e) {
    getDb().run("UPDATE payments SET status = 'cancelled', status_detail = 'creation_failed', updated_at = ? WHERE id = ?", nowIso(), pay.id);
    throw e;
  }
  return getOrder(orderId)!;
}

export interface CardInput { token: string; installments: number; paymentMethodId: string; issuerId?: string | null; identificationType?: string | null; identificationNumber?: string | null }

export async function startCardPayment(orderId: number, user: { id: string; email: string }, card: CardInput): Promise<OrderDTO> {
  if (!features.mercadoPagoCard) throw new HttpError(503, 'Pagamento com cartão ainda não está habilitado nesta loja.', 'card_disabled');
  if (card.installments < 1 || card.installments > env.MP_MAX_INSTALLMENTS) throw new HttpError(400, 'Número de parcelas não permitido.', 'bad_installments');
  const order = loadPayableOrder(orderId, user.id);
  const pay = insertPayment(orderId, 'mercadopago', 'credit_card', order.totalCents, null);
  try {
    const mp = await createCardPayment({ ...card, amountCents: order.totalCents, description: `Pedido ${order.number} — GAZU`, payerEmail: user.email, externalReference: order.number, idempotencyKey: pay.idempotency_key });
    storeMpResult(pay.id, mp);
    await applyPaymentUpdate(pay.id, mapMpStatus(mp), mp.status_detail ?? null, Math.round(mp.transaction_amount * 100), 'mercadopago');
  } catch (e) {
    getDb().run("UPDATE payments SET status = 'cancelled', status_detail = 'creation_failed', updated_at = ? WHERE id = ? AND status = 'pending'", nowIso(), pay.id);
    throw e;
  }
  return getOrder(orderId)!;
}

export function startDemoPayment(orderId: number, user: { id: string }): OrderDTO {
  if (!features.demoPayments) throw new HttpError(503, 'Pagamento simulado indisponível.', 'demo_disabled');
  const order = loadPayableOrder(orderId, user.id);
  const pending = order.payments.find((p) => p.provider === 'demo' && p.status === 'pending');
  if (!pending) {
    const pay = insertPayment(orderId, 'demo', 'demo', order.totalCents, order.expiresAt);
    getDb().run('UPDATE payments SET provider_payment_id = ? WHERE id = ?', `demo_${crypto.randomBytes(6).toString('hex')}`, pay.id);
    addOrderEvent(orderId, 'payment_created', 'Pagamento SIMULADO criado (modo demonstração — nenhum valor é cobrado).', PROVIDER_ACTOR.demo);
  }
  return getOrder(orderId)!;
}

export type UpdateResult = 'processed' | 'ignored' | 'amount_mismatch' | 'not_found';

/**
 * Aplica uma atualização de status vinda do PROVEDOR (webhook, consulta à API ou simulador de demonstração).
 * Idempotente: repetir o mesmo status não gera efeitos duplicados.
 */
export async function applyPaymentUpdate(paymentId: number, status: PaymentStatus, statusDetail: string | null, providerAmountCents: number, provider: 'mercadopago' | 'demo'): Promise<UpdateResult> {
  const db = getDb();
  return db.tx(() => {
    const pay = db.get<PaymentRow>('SELECT * FROM payments WHERE id = ?', paymentId);
    if (!pay) return 'not_found';
    const order = db.get<{ id: number; status: string; total_cents: number; stock_released: number }>('SELECT id, status, total_cents, stock_released FROM orders WHERE id = ?', pay.order_id)!;
    const actor = PROVIDER_ACTOR[provider];

    if (status === 'approved' && (providerAmountCents !== order.total_cents || pay.amount_cents !== order.total_cents)) {
      db.run("UPDATE payments SET status_detail = 'amount_mismatch', updated_at = ? WHERE id = ?", nowIso(), pay.id);
      addOrderEvent(order.id, 'amount_mismatch', `Valor informado pelo provedor (${providerAmountCents}) difere do total do pedido (${order.total_cents}). Pagamento NÃO confirmado — revisar.`, actor);
      return 'amount_mismatch';
    }
    if (pay.status === status && (pay.status_detail ?? null) === (statusDetail ?? null)) return 'ignored';

    db.run('UPDATE payments SET status = ?, status_detail = ?, updated_at = ? WHERE id = ?', status, statusDetail, nowIso(), pay.id);

    if (status === 'approved') {
      if (order.status === 'pending_payment') {
        db.run("UPDATE orders SET status = 'paid', expires_at = NULL, updated_at = ? WHERE id = ?", nowIso(), order.id);
        db.run("UPDATE coupon_redemptions SET status = 'confirmed' WHERE order_id = ?", order.id);
        addOrderEvent(order.id, 'paid', 'Pagamento aprovado e confirmado pelo provedor.', actor);
      } else if (order.status === 'cancelled') {
        addOrderEvent(order.id, 'payment_after_cancel', 'ATENÇÃO: pagamento aprovado após o cancelamento do pedido. Avaliar estorno ou reativação manual.', actor);
      }
    } else if (status === 'refunded') {
      if (['paid', 'processing'].includes(order.status)) {
        db.run("UPDATE orders SET status = 'refunded', updated_at = ? WHERE id = ?", nowIso(), order.id);
        releaseOrder(order.id, actor);
        addOrderEvent(order.id, 'refunded', 'Pagamento estornado pelo provedor. Estoque devolvido.', actor);
      } else if (['shipped', 'delivered'].includes(order.status)) {
        db.run("UPDATE orders SET status = 'refunded', updated_at = ? WHERE id = ?", nowIso(), order.id);
        addOrderEvent(order.id, 'refunded', 'Pagamento estornado pelo provedor após o envio. Verificar devolução da mercadoria.', actor);
      }
    } else if (status === 'partially_refunded') {
      addOrderEvent(order.id, 'partial_refund', 'Estorno parcial registrado pelo provedor.', actor);
    } else if (status === 'rejected' || status === 'cancelled') {
      addOrderEvent(order.id, `payment_${status}`, status === 'rejected' ? 'Pagamento recusado. O cliente pode tentar novamente.' : 'Pagamento cancelado/expirado no provedor.', actor);
    }
    return 'processed';
  });
}

/** Consulta o provedor para sincronizar um pagamento pendente (usado pela tela do Pix e pela expiração). */
export async function syncMercadoPagoPayment(paymentId: number): Promise<void> {
  const pay = getDb().get<PaymentRow>('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!pay || pay.provider !== 'mercadopago' || !pay.provider_payment_id || !features.mercadoPago) return;
  const mp = await getPayment(pay.provider_payment_id);
  const order = getDb().get<{ number: string }>('SELECT number FROM orders WHERE id = ?', pay.order_id)!;
  if (mp.external_reference !== order.number) return;
  await applyPaymentUpdate(pay.id, mapMpStatus(mp), mp.status_detail ?? null, Math.round(mp.transaction_amount * 100), 'mercadopago');
}

/** Processa uma notificação do Mercado Pago já autenticada: busca o pagamento NA API e aplica o status real. */
export async function processMercadoPagoNotification(providerPaymentId: string): Promise<{ result: UpdateResult | 'unknown_order'; paymentId: number | null; status: string | null }> {
  const mp = await getPayment(providerPaymentId);
  const db = getDb();
  let pay = db.get<PaymentRow>("SELECT * FROM payments WHERE provider = 'mercadopago' AND provider_payment_id = ?", String(mp.id));
  if (!pay && mp.external_reference) {
    // Notificação chegou antes de gravarmos o id do provedor: associa pelo número do pedido.
    const order = db.get<{ id: number }>('SELECT id FROM orders WHERE number = ?', mp.external_reference);
    if (!order) return { result: 'unknown_order', paymentId: null, status: mp.status };
    pay = db.get<PaymentRow>("SELECT * FROM payments WHERE order_id = ? AND provider = 'mercadopago' AND provider_payment_id IS NULL ORDER BY id DESC LIMIT 1", order.id);
    if (pay) db.run('UPDATE payments SET provider_payment_id = ? WHERE id = ?', String(mp.id), pay.id);
  }
  if (!pay) return { result: 'unknown_order', paymentId: null, status: mp.status };
  const order = db.get<{ number: string }>('SELECT number FROM orders WHERE id = ?', pay.order_id)!;
  if (mp.external_reference !== order.number) return { result: 'unknown_order', paymentId: pay.id, status: mp.status };
  const result = await applyPaymentUpdate(pay.id, mapMpStatus(mp), mp.status_detail ?? null, Math.round(mp.transaction_amount * 100), 'mercadopago');
  return { result, paymentId: pay.id, status: mp.status };
}

/** Cancela pedidos cujo prazo de pagamento expirou e devolve o estoque reservado. */
export async function expireStaleOrders(): Promise<number> {
  const db = getDb();
  const stale = db.all<{ id: number }>("SELECT id FROM orders WHERE status = 'pending_payment' AND expires_at IS NOT NULL AND expires_at < ?", nowIso());
  let n = 0;
  for (const o of stale) {
    for (const p of db.all<{ id: number }>("SELECT id FROM payments WHERE order_id = ? AND provider = 'mercadopago' AND status = 'pending'", o.id)) {
      try { await syncMercadoPagoPayment(p.id); } catch { /* sem conexão: tenta na próxima execução */ continue; }
    }
    const current = db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', o.id)!;
    if (current.status !== 'pending_payment') continue;
    const pendingRemote = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND provider = 'mercadopago' AND status = 'pending' AND provider_payment_id IS NOT NULL AND (expires_at IS NULL OR expires_at > ?)", o.id, nowIso())!.n;
    if (pendingRemote) continue; // ainda há cobrança válida no provedor
    db.tx(() => {
      db.run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending_payment'", nowIso(), o.id);
      db.run("UPDATE payments SET status = 'cancelled', status_detail = 'expired', updated_at = ? WHERE order_id = ? AND status = 'pending'", nowIso(), o.id);
      releaseOrder(o.id, 'system');
      addOrderEvent(o.id, 'expired', 'Prazo de pagamento expirado. Pedido cancelado e estoque devolvido.', 'system');
    });
    n++;
  }
  return n;
}
