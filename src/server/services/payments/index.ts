import crypto from 'node:crypto';
import { env, features } from '../../config.ts';
import { getDb, nowIso } from '../../db.ts';
import { HttpError } from '../../http.ts';
import { emit } from '../../events.ts';
import type { OrderDTO, PaymentStatus } from '../../../shared/types.ts';
import { onlyDigits } from '../../../shared/format.ts';
import { addOrderEvent, getOrder, releaseOrder } from '../orders.ts';
import { audit } from '../audit.ts';
import { logError } from '../monitoring.ts';
import {
  cancelPayment, createBoletoPayment, createCardPayment, createPixPayment, createRefund, getInstallments, getPayment, mapMpStatus, mpFinancials, type MpPayment,
} from './mercadopago.ts';

interface PaymentRow {
  id: number; order_id: number; provider: 'mercadopago' | 'demo'; method: string; provider_payment_id: string | null; status: PaymentStatus;
  status_detail: string | null; amount_cents: number; refunded_cents: number; idempotency_key: string; expires_at: string | null; updated_at: string;
}

const PROVIDER_ACTOR = { mercadopago: 'provider:mercadopago', demo: 'provider:demo' } as const;

/**
 * Transições de status aceitas a partir do status atual. Eventos fora de ordem (ex.: "pendente"
 * chegando depois de "aprovado") são ignorados e registrados — o pagamento nunca regride.
 */
const ALLOWED: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ['pending', 'in_process', 'approved', 'rejected', 'cancelled', 'expired', 'refunded', 'partially_refunded'],
  in_process: ['in_process', 'approved', 'rejected', 'cancelled', 'expired', 'refunded', 'partially_refunded'],
  approved: ['approved', 'partially_refunded', 'refunded'],
  partially_refunded: ['partially_refunded', 'refunded'],
  refunded: ['refunded'],
  rejected: ['rejected', 'approved'],       // aprovação tardia é tratada como "pagamento após cancelamento"
  cancelled: ['cancelled', 'approved'],
  expired: ['expired', 'approved'],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export interface OrderAccess { orderId: number; email: string; userId: string }

function loadPayableOrder(access: OrderAccess): OrderDTO {
  const order = getOrder(access.orderId);
  if (!order) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
  if (order.status !== 'pending_payment') throw new HttpError(409, 'Este pedido não está aguardando pagamento.', 'not_payable');
  if (order.expiresAt && order.expiresAt < nowIso()) throw new HttpError(409, 'O prazo para pagamento deste pedido expirou.', 'order_expired');
  if (order.payments.some((p) => p.status === 'approved')) throw new HttpError(409, 'Este pedido já possui pagamento aprovado.', 'already_paid');
  if (order.isDemo && env.NODE_ENV === 'production' && !features.demoPayments) {
    throw new HttpError(409, 'Pedidos com produtos de demonstração não podem ser pagos em produção.', 'demo_order');
  }
  return order;
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
  const fin = mpFinancials(mp);
  getDb().run(
    `UPDATE payments SET provider_payment_id = ?, status_detail = ?, provider_status = ?, pix_qr_code = COALESCE(?, pix_qr_code), pix_qr_base64 = COALESCE(?, pix_qr_base64),
       pix_ticket_url = COALESCE(?, pix_ticket_url), boleto_url = COALESCE(?, boleto_url), boleto_barcode = COALESCE(?, boleto_barcode),
       card_last_four = COALESCE(?, card_last_four), installments = COALESCE(?, installments), fee_cents = COALESCE(?, fee_cents),
       net_received_cents = COALESCE(?, net_received_cents), last_synced_at = ?, updated_at = ? WHERE id = ?`,
    String(mp.id), mp.status_detail ?? null, mp.status, tx?.qr_code ?? null, tx?.qr_code_base64 ?? null, tx?.ticket_url ?? null,
    mp.transaction_details?.external_resource_url ?? null, mp.barcode?.content ?? null,
    mp.card?.last_four_digits ?? null, mp.installments ?? null, fin.feeCents, fin.netCents, nowIso(), nowIso(), paymentId,
  );
}

async function applyMp(paymentId: number, mp: MpPayment): Promise<UpdateResult> {
  storeMpResult(paymentId, mp);
  const fin = mpFinancials(mp);
  return applyPaymentUpdate(paymentId, mapMpStatus(mp), mp.status_detail ?? null, Math.round(mp.transaction_amount * 100), 'mercadopago', { refundedCents: fin.refundedCents });
}

export async function startPixPayment(access: OrderAccess): Promise<OrderDTO> {
  if (!features.mercadoPagoPix) throw new HttpError(503, 'Pix ainda não está habilitado nesta loja.', 'pix_disabled');
  const order = loadPayableOrder(access);
  const expires = new Date(Math.min(Date.now() + env.PIX_EXPIRATION_MINUTES * 60_000, order.expiresAt ? Date.parse(order.expiresAt) : Infinity));
  const pay = insertPayment(order.id, 'mercadopago', 'pix', order.totalCents, expires.toISOString());
  try {
    const mp = await createPixPayment({ amountCents: order.totalCents, description: `Pedido ${order.number} — GAZU`, payerEmail: access.email, externalReference: order.number, expiresAt: expires, idempotencyKey: pay.idempotency_key });
    await applyMp(pay.id, mp);
    addOrderEvent(order.id, 'payment_created', 'Cobrança Pix criada no provedor.', PROVIDER_ACTOR.mercadopago);
    emit('order.payment_pending', { orderId: order.id, paymentId: pay.id });
  } catch (e) {
    getDb().run("UPDATE payments SET status = 'cancelled', status_detail = 'creation_failed', updated_at = ? WHERE id = ?", nowIso(), pay.id);
    throw e;
  }
  return getOrder(order.id)!;
}

export interface BoletoInput { firstName: string; lastName: string; cpf: string }

export async function startBoletoPayment(access: OrderAccess, input: BoletoInput): Promise<OrderDTO> {
  if (!features.mercadoPagoBoleto) throw new HttpError(503, 'Boleto ainda não está habilitado nesta loja.', 'boleto_disabled');
  const cpf = onlyDigits(input.cpf);
  if (!validCpf(cpf)) throw new HttpError(400, 'CPF inválido.', 'invalid_cpf', { fieldErrors: { cpf: ['CPF inválido.'] } });
  const order = loadPayableOrder(access);
  const expires = new Date(Date.now() + env.BOLETO_DAYS * 86400_000);
  // O boleto pode ser pago em até BOLETO_DAYS dias: o pedido fica reservado até o vencimento.
  getDb().run('UPDATE orders SET expires_at = ? WHERE id = ? AND status = ?', new Date(expires.getTime() + 86400_000).toISOString(), order.id, 'pending_payment');
  const pay = insertPayment(order.id, 'mercadopago', 'boleto', order.totalCents, expires.toISOString());
  try {
    const mp = await createBoletoPayment({
      amountCents: order.totalCents, description: `Pedido ${order.number} — GAZU`, externalReference: order.number, idempotencyKey: pay.idempotency_key, expiresAt: expires,
      payer: { email: access.email, firstName: input.firstName, lastName: input.lastName, cpf, address: { zipCode: order.address.cep, streetName: order.address.street, streetNumber: order.address.number || 'S/N', neighborhood: order.address.district, city: order.address.city, federalUnit: order.address.state } },
    });
    await applyMp(pay.id, mp);
    addOrderEvent(order.id, 'payment_created', 'Boleto emitido pelo provedor.', PROVIDER_ACTOR.mercadopago);
    emit('order.payment_pending', { orderId: order.id, paymentId: pay.id });
  } catch (e) {
    getDb().run("UPDATE payments SET status = 'cancelled', status_detail = 'creation_failed', updated_at = ? WHERE id = ?", nowIso(), pay.id);
    throw e;
  }
  return getOrder(order.id)!;
}

export interface CardInput { token: string; installments: number; paymentMethodId: string; issuerId?: string | null; identificationType?: string | null; identificationNumber?: string | null }

export async function startCardPayment(access: OrderAccess, card: CardInput): Promise<OrderDTO> {
  if (!features.mercadoPagoCard) throw new HttpError(503, 'Pagamento com cartão ainda não está habilitado nesta loja.', 'card_disabled');
  if (card.installments < 1 || card.installments > env.MP_MAX_INSTALLMENTS) throw new HttpError(400, 'Número de parcelas não permitido.', 'bad_installments');
  const order = loadPayableOrder(access);
  const pay = insertPayment(order.id, 'mercadopago', 'credit_card', order.totalCents, null);
  try {
    const mp = await createCardPayment({ ...card, amountCents: order.totalCents, description: `Pedido ${order.number} — GAZU`, payerEmail: access.email, externalReference: order.number, idempotencyKey: pay.idempotency_key });
    await applyMp(pay.id, mp);
  } catch (e) {
    getDb().run("UPDATE payments SET status = 'cancelled', status_detail = 'creation_failed', updated_at = ? WHERE id = ? AND status = 'pending'", nowIso(), pay.id);
    throw e;
  }
  return getOrder(order.id)!;
}

export function startDemoPayment(access: OrderAccess): OrderDTO {
  if (!features.demoPayments) throw new HttpError(503, 'Pagamento simulado indisponível.', 'demo_disabled');
  const order = loadPayableOrder(access);
  const pending = order.payments.find((p) => p.provider === 'demo' && p.status === 'pending');
  if (!pending) {
    const pay = insertPayment(order.id, 'demo', 'demo', order.totalCents, order.expiresAt);
    getDb().run('UPDATE payments SET provider_payment_id = ? WHERE id = ?', `demo_${crypto.randomBytes(6).toString('hex')}`, pay.id);
    addOrderEvent(order.id, 'payment_created', 'Pagamento SIMULADO criado (modo demonstração — nenhum valor é cobrado).', PROVIDER_ACTOR.demo);
  }
  return getOrder(order.id)!;
}

export type UpdateResult = 'processed' | 'ignored' | 'out_of_order' | 'amount_mismatch' | 'not_found';

/**
 * Aplica uma atualização de status vinda do PROVEDOR (webhook verificado, consulta à API ou simulador de demonstração).
 * Idempotente: repetir o mesmo status não gera efeitos. Transições inválidas (eventos fora de ordem) são ignoradas.
 */
export async function applyPaymentUpdate(paymentId: number, status: PaymentStatus, statusDetail: string | null, providerAmountCents: number, provider: 'mercadopago' | 'demo', extra: { refundedCents?: number } = {}): Promise<UpdateResult> {
  const db = getDb();
  return db.tx(() => {
    const pay = db.get<PaymentRow>('SELECT * FROM payments WHERE id = ?', paymentId);
    if (!pay) return 'not_found';
    const order = db.get<{ id: number; status: string; total_cents: number; stock_released: number }>('SELECT id, status, total_cents, stock_released FROM orders WHERE id = ?', pay.order_id)!;
    const actor = PROVIDER_ACTOR[provider];

    const impliesApproval = status === 'approved' || status === 'partially_refunded' || status === 'refunded';
    const firstApproval = impliesApproval && !['approved', 'partially_refunded', 'refunded'].includes(pay.status);
    if (firstApproval && (providerAmountCents !== order.total_cents || pay.amount_cents !== order.total_cents)) {
      db.run("UPDATE payments SET status_detail = 'amount_mismatch', updated_at = ? WHERE id = ?", nowIso(), pay.id);
      addOrderEvent(order.id, 'amount_mismatch', `Valor informado pelo provedor (${providerAmountCents}) difere do total do pedido (${order.total_cents}). Pagamento NÃO confirmado — revisar.`, actor);
      logError('critical', 'payments:amount_mismatch', `Pedido #${order.id}: valor do provedor ${providerAmountCents} ≠ total ${order.total_cents}`, { orderId: order.id, paymentId });
      return 'amount_mismatch';
    }
    const refunded = extra.refundedCents ?? pay.refunded_cents;
    if (pay.status === status && (pay.status_detail ?? null) === (statusDetail ?? null) && refunded === pay.refunded_cents) return 'ignored';
    if (!canTransition(pay.status, status)) {
      addOrderEvent(order.id, 'payment_out_of_order', `Atualização ignorada: ${pay.status} → ${status} (evento fora de ordem).`, actor);
      return 'out_of_order';
    }

    const now = nowIso();
    db.run(
      `UPDATE payments SET status = ?, status_detail = ?, refunded_cents = ?, approved_at = CASE WHEN ? = 1 THEN COALESCE(approved_at, ?) ELSE approved_at END, updated_at = ? WHERE id = ?`,
      status, statusDetail, refunded, impliesApproval ? 1 : 0, now, now, pay.id,
    );

    // Aprovação (inclusive implícita, quando a primeira notificação recebida já é de estorno).
    if (firstApproval) {
      if (order.status === 'pending_payment') {
        db.run("UPDATE orders SET status = 'paid', paid_at = ?, expires_at = NULL, updated_at = ? WHERE id = ?", now, now, order.id);
        db.run("UPDATE coupon_redemptions SET status = 'confirmed' WHERE order_id = ?", order.id);
        addOrderEvent(order.id, 'paid', 'Pagamento aprovado e confirmado pelo provedor.', actor);
        order.status = 'paid';
        emit('order.paid', { orderId: order.id });
      } else if (order.status === 'cancelled') {
        addOrderEvent(order.id, 'payment_after_cancel', 'ATENÇÃO: pagamento aprovado após o cancelamento do pedido. Avaliar estorno ou reativação manual.', actor);
        logError('critical', 'payments:after_cancel', `Pagamento aprovado após cancelamento (pedido #${order.id})`, { orderId: order.id, paymentId });
      }
    }

    if (status === 'approved') {
      // já tratado acima
    } else if (status === 'refunded') {
      if (['paid', 'processing'].includes(order.status)) {
        db.run("UPDATE orders SET status = 'refunded', updated_at = ? WHERE id = ?", now, order.id);
        releaseOrder(order.id, actor);
        addOrderEvent(order.id, 'refunded', 'Pagamento estornado pelo provedor. Estoque devolvido.', actor);
      } else if (['shipped', 'delivered'].includes(order.status)) {
        db.run("UPDATE orders SET status = 'refunded', updated_at = ? WHERE id = ?", now, order.id);
        addOrderEvent(order.id, 'refunded', 'Pagamento estornado pelo provedor após o envio. Verificar devolução da mercadoria.', actor);
      }
      confirmRefunds(pay.id, pay.amount_cents);
    } else if (status === 'partially_refunded') {
      addOrderEvent(order.id, 'partial_refund', 'Estorno parcial registrado pelo provedor.', actor);
      confirmRefunds(pay.id, refunded);
    } else if (['rejected', 'cancelled', 'expired'].includes(status)) {
      const text = status === 'rejected' ? 'Pagamento recusado. O cliente pode tentar novamente.' : status === 'expired' ? 'Cobrança expirada no provedor.' : 'Pagamento cancelado no provedor.';
      addOrderEvent(order.id, `payment_${status}`, text, actor);
    } else if (status === 'in_process') {
      addOrderEvent(order.id, 'payment_in_process', 'Pagamento em análise pelo provedor.', actor);
    }
    return 'processed';
  });
}

/** Marca como aprovados os estornos solicitados cobertos pelo valor já estornado no provedor. */
function confirmRefunds(paymentId: number, refundedCents: number): void {
  const db = getDb();
  const done = db.get<{ n: number }>("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM refunds WHERE payment_id = ? AND status = 'approved'", paymentId)!.n;
  let available = refundedCents - done;
  for (const r of db.all<{ id: number; order_id: number; amount_cents: number }>("SELECT id, order_id, amount_cents FROM refunds WHERE payment_id = ? AND status = 'requested' ORDER BY id", paymentId)) {
    if (r.amount_cents > available) break;
    available -= r.amount_cents;
    db.run("UPDATE refunds SET status = 'approved', confirmed_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), r.id);
    emit('refund.confirmed', { orderId: r.order_id, refundId: r.id, amountCents: r.amount_cents });
  }
}

/** Consulta o provedor para sincronizar um pagamento (tela do Pix/boleto, expiração e reconciliação). */
export async function syncMercadoPagoPayment(paymentId: number): Promise<UpdateResult | null> {
  const pay = getDb().get<PaymentRow>('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!pay || pay.provider !== 'mercadopago' || !pay.provider_payment_id || !features.mercadoPago) return null;
  const mp = await getPayment(pay.provider_payment_id);
  const order = getDb().get<{ number: string }>('SELECT number FROM orders WHERE id = ?', pay.order_id)!;
  if (mp.external_reference !== order.number) return 'not_found';
  return applyMp(pay.id, mp);
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
  const result = await applyMp(pay.id, mp);
  return { result, paymentId: pay.id, status: mp.status };
}

/** Cancela pedidos cujo prazo de pagamento expirou e devolve o estoque reservado. */
export async function expireStaleOrders(): Promise<number> {
  const db = getDb();
  const stale = db.all<{ id: number }>("SELECT id FROM orders WHERE status = 'pending_payment' AND expires_at IS NOT NULL AND expires_at < ?", nowIso());
  let n = 0;
  for (const o of stale) {
    for (const p of db.all<{ id: number }>("SELECT id FROM payments WHERE order_id = ? AND provider = 'mercadopago' AND status IN ('pending','in_process')", o.id)) {
      try { await syncMercadoPagoPayment(p.id); } catch { /* sem conexão: tenta na próxima execução */ continue; }
    }
    const current = db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', o.id)!;
    if (current.status !== 'pending_payment') continue;
    const pendingRemote = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND provider = 'mercadopago' AND status IN ('pending','in_process') AND provider_payment_id IS NOT NULL AND (expires_at IS NULL OR expires_at > ?)", o.id, nowIso())!.n;
    if (pendingRemote) continue; // ainda há cobrança válida no provedor
    db.tx(() => {
      db.run("UPDATE orders SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_payment'", nowIso(), nowIso(), o.id);
      db.run("UPDATE payments SET status = 'expired', status_detail = 'expired', updated_at = ? WHERE order_id = ? AND status IN ('pending','in_process')", nowIso(), o.id);
      releaseOrder(o.id, 'system');
      addOrderEvent(o.id, 'expired', 'Prazo de pagamento expirado. Pedido cancelado e estoque devolvido.', 'system');
      emit('order.cancelled', { orderId: o.id, reason: 'expired' });
    });
    n++;
  }
  return n;
}

/**
 * Reconciliação: sincroniza pagamentos pendentes/em processamento com o provedor e reprocessa
 * notificações que falharam (ex.: provedor indisponível no momento do webhook).
 */
export async function reconcilePayments(): Promise<{ synced: number; reprocessed: number; failures: number }> {
  if (!features.mercadoPago) return { synced: 0, reprocessed: 0, failures: 0 };
  const db = getDb();
  let synced = 0, reprocessed = 0, failures = 0;
  const pending = db.all<{ id: number }>(
    "SELECT id FROM payments WHERE provider = 'mercadopago' AND provider_payment_id IS NOT NULL AND status IN ('pending','in_process','approved','partially_refunded') AND (last_synced_at IS NULL OR last_synced_at < ?) ORDER BY last_synced_at LIMIT 25",
    new Date(Date.now() - 10 * 60_000).toISOString(),
  );
  for (const p of pending) {
    try { await syncMercadoPagoPayment(p.id); synced++; } catch (e) { failures++; logError('warn', 'payments:reconcile', e, { paymentId: p.id }); }
  }
  for (const ev of db.all<{ id: number; provider_payment_id: string | null; attempts: number }>("SELECT id, provider_payment_id, attempts FROM payment_events WHERE provider = 'mercadopago' AND result = 'error' AND attempts < 6 ORDER BY id LIMIT 20")) {
    db.run('UPDATE payment_events SET attempts = attempts + 1 WHERE id = ?', ev.id);
    if (!ev.provider_payment_id) continue;
    try {
      const out = await processMercadoPagoNotification(ev.provider_payment_id);
      db.run('UPDATE payment_events SET result = ?, detail = ?, processed_at = ?, payment_id = ?, status = ? WHERE id = ?', out.result === 'unknown_order' ? 'ignored' : 'processed', `reprocessado: ${out.result}`, nowIso(), out.paymentId, out.status, ev.id);
      reprocessed++;
    } catch (e) {
      failures++;
      db.run('UPDATE payment_events SET detail = ? WHERE id = ?', String((e as Error).message).slice(0, 200), ev.id);
    }
  }
  return { synced, reprocessed, failures };
}

/** Cancela no provedor as cobranças pendentes de um pedido cancelado (melhor esforço; o status real vem do provedor). */
export async function cancelPendingProviderPayments(orderId: number): Promise<void> {
  if (!features.mercadoPago) return;
  for (const p of getDb().all<{ id: number; provider_payment_id: string }>("SELECT id, provider_payment_id FROM payments WHERE order_id = ? AND provider = 'mercadopago' AND status IN ('pending','in_process') AND provider_payment_id IS NOT NULL", orderId)) {
    try {
      const mp = await cancelPayment(p.provider_payment_id);
      await applyMp(p.id, mp);
    } catch (e) {
      logError('warn', 'payments:cancel', e, { paymentId: p.id });
    }
  }
}

/**
 * Estorno pelo provedor. O pedido só passa a "reembolsado" quando o provedor confirma
 * (resposta da API com estorno aprovado, webhook ou reconciliação).
 */
export async function requestRefund(input: { orderId: number; amountCents: number | null; reason: string; actor: string; returnId?: number | null; ip?: string }): Promise<OrderDTO> {
  const db = getDb();
  const pay = db.get<PaymentRow & { provider_payment_id: string | null }>("SELECT * FROM payments WHERE order_id = ? AND status IN ('approved','partially_refunded') ORDER BY id DESC LIMIT 1", input.orderId);
  if (!pay) throw new HttpError(409, 'Não há pagamento aprovado para estornar neste pedido.', 'no_refundable_payment');
  const pendingRefunds = db.get<{ n: number }>("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM refunds WHERE payment_id = ? AND status = 'requested'", pay.id)!.n;
  const refundable = pay.amount_cents - pay.refunded_cents - pendingRefunds;
  const amount = input.amountCents ?? refundable;
  if (amount <= 0 || amount > refundable) throw new HttpError(400, `Valor de estorno inválido. Disponível para estorno: R$ ${(refundable / 100).toFixed(2).replace('.', ',')}.`, 'bad_refund_amount');
  const key = crypto.randomUUID();
  const refundId = db.run('INSERT INTO refunds (payment_id, order_id, return_id, amount_cents, reason, idempotency_key, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    pay.id, input.orderId, input.returnId ?? null, amount, input.reason, key, input.actor).lastInsertRowid;
  addOrderEvent(input.orderId, 'refund_requested', `Estorno de R$ ${(amount / 100).toFixed(2).replace('.', ',')} solicitado ao provedor. Motivo: ${input.reason}`, input.actor);
  audit({ actor: input.actor, action: 'refund.request', entity: 'order', entityId: input.orderId, data: { amountCents: amount, paymentId: pay.id, reason: input.reason }, ip: input.ip });

  if (pay.provider === 'demo') {
    // Demonstração: o "provedor" simulado confirma o estorno imediatamente.
    const total = pay.refunded_cents + amount;
    await applyPaymentUpdate(pay.id, total >= pay.amount_cents ? 'refunded' : 'partially_refunded', 'demo_refund', pay.amount_cents, 'demo', { refundedCents: total });
    return getOrder(input.orderId, { withCustomer: true, admin: true })!;
  }
  if (!pay.provider_payment_id) throw new HttpError(409, 'Pagamento sem identificador do provedor.', 'missing_provider_id');
  try {
    const isFull = amount === pay.amount_cents - pay.refunded_cents;
    const refund = await createRefund(pay.provider_payment_id, isFull ? null : amount, key);
    db.run('UPDATE refunds SET provider_refund_id = ?, detail = ?, updated_at = ? WHERE id = ?', String(refund.id), refund.status, nowIso(), refundId);
    await syncMercadoPagoPayment(pay.id); // confirma pelo status real do pagamento no provedor
  } catch (e) {
    db.run("UPDATE refunds SET status = 'failed', detail = ?, updated_at = ? WHERE id = ?", String((e as Error).message).slice(0, 200), nowIso(), refundId);
    addOrderEvent(input.orderId, 'refund_failed', 'O provedor não concluiu o estorno. Verifique e tente novamente.', input.actor);
    audit({ actor: input.actor, action: 'refund.request', entity: 'order', entityId: input.orderId, data: { refundId }, result: 'failed', ip: input.ip });
    throw e;
  }
  return getOrder(input.orderId, { withCustomer: true, admin: true })!;
}

let installmentsCache: { key: string; at: number; data: { maxNoInterest: number; maxInstallments: number } } | null = null;
/** Parcelamento informado pelo provedor (sem juros e máximo), limitado por MP_MAX_INSTALLMENTS. */
export async function installmentsInfo(amountCents: number): Promise<{ available: boolean; maxNoInterest: number; maxInstallments: number; source: 'provider' | 'none' }> {
  if (!features.mercadoPagoCard || env.MP_MAX_INSTALLMENTS <= 1) return { available: false, maxNoInterest: 1, maxInstallments: 1, source: 'none' };
  const bucket = Math.round(amountCents / 1000); // agrupa valores próximos para reaproveitar a consulta
  const key = String(bucket);
  if (installmentsCache && installmentsCache.key === key && Date.now() - installmentsCache.at < 3600_000) return { available: true, ...installmentsCache.data, source: 'provider' };
  try {
    const costs = await getInstallments(amountCents);
    const allowed = costs.filter((c) => c.installments <= env.MP_MAX_INSTALLMENTS);
    const data = { maxNoInterest: Math.max(1, ...allowed.filter((c) => c.installment_rate === 0).map((c) => c.installments)), maxInstallments: Math.max(1, ...allowed.map((c) => c.installments)) };
    installmentsCache = { key, at: Date.now(), data };
    return { available: true, ...data, source: 'provider' };
  } catch {
    return { available: false, maxNoInterest: 1, maxInstallments: 1, source: 'none' };
  }
}

/** Validação de CPF (dígitos verificadores). */
export function validCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}
