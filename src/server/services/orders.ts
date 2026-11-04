import { ORDER_STATUS_LABEL } from '../../shared/format.ts';
import { env } from '../config.ts';
import { getDb, nowIso } from '../db.ts';
import { HttpError } from '../http.ts';
import { emit } from '../events.ts';
import type { CartItemInput, OrderDTO, OrderStatus, PaymentDTO, RefundDTO, ShipmentDTO } from '../../shared/types.ts';
import { quoteCart, setUserCartItems } from './cart.ts';
import { moveStock } from './inventory.ts';
import { daysText } from './shipping.ts';
import { evaluateCoupon } from './coupons.ts';
import { getSettings } from './settings.ts';
import { audit } from './audit.ts';

export interface AddressInput {
  recipient: string; cep: string; street: string; number: string; complement?: string | null; district: string; city: string; state: string;
}

export interface Attribution { utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null }

export interface CreateOrderInput {
  items: CartItemInput[];
  couponCode?: string | null;
  address: AddressInput;
  shippingOptionId: string;
  /** Total que o cliente viu na tela; se divergir do recalculado, o pedido não é criado. */
  expectedTotalCents?: number;
  attribution?: Attribution;
  customer?: { name: string; email: string };
  guestAccessHash?: string | null;
}

interface OrderRow {
  id: number; number: string; user_id: string; status: OrderStatus; subtotal_cents: number; discount_cents: number; shipping_cents: number; total_cents: number;
  coupon_id: number | null; coupon_code: string | null; shipping_option_id: string; shipping_label: string; shipping_days_text: string | null; shipping_is_demo: number;
  ship_recipient: string; ship_cep: string; ship_street: string; ship_number: string; ship_complement: string | null; ship_district: string; ship_city: string; ship_state: string;
  tracking_code: string | null; tracking_url: string | null; is_demo: number; stock_released: number; expires_at: string | null; created_at: string; updated_at: string;
  customer_email: string | null; customer_name: string | null; campaign_id: number | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  paid_at: string | null; cancelled_at: string | null; guest_access_hash: string | null;
}

export function addOrderEvent(orderId: number, type: string, message: string, actor: string): void {
  getDb().run('INSERT INTO order_events (order_id, type, message, actor) VALUES (?, ?, ?, ?)', orderId, type, message, actor);
}

const clean = (v: string | null | undefined, max = 80) => (v ? v.trim().slice(0, max).replace(/[^\w.\-+ ]/g, '') || null : null);

/**
 * Cria o pedido revalidando tudo no servidor: produtos, variantes, estoque, preços, cupom e frete.
 * O estoque é reservado na mesma transação (UPDATE condicional), evitando venda acima do disponível.
 */
export async function createOrder(userId: string, input: CreateOrderInput): Promise<OrderDTO> {
  const db = getDb();
  // A cotação de frete pode consultar a transportadora (assíncrono) — feita antes da transação.
  const quote = await quoteCart({ items: input.items, couponCode: input.couponCode, userId, cep: input.address.cep, shippingOptionId: input.shippingOptionId });
  return db.tx(() => {
    if (!quote.lines.length) throw new HttpError(400, 'Seu carrinho está vazio.', 'empty_cart');
    const problem = quote.lines.find((l) => l.issue);
    if (problem) {
      throw new HttpError(409, problem.issue === 'insufficient_stock' ? `Estoque insuficiente para ${problem.name} (${problem.colorName}, ${problem.size}). Disponível: ${problem.stock}.` : `${problem.name} (${problem.colorName}, ${problem.size}) está indisponível.`, 'stock_problem', { variantId: problem.variantId, issue: problem.issue, available: problem.stock });
    }
    if (input.couponCode && quote.coupon && !quote.coupon.valid) throw new HttpError(409, quote.coupon.message ?? 'Cupom inválido.', 'invalid_coupon');
    if (!quote.shippingConfigured) throw new HttpError(409, 'O frete ainda não foi configurado pela loja.', 'shipping_not_configured');
    if (!quote.shipping) throw new HttpError(409, quote.shippingMessage ?? 'Selecione uma opção de entrega válida para o CEP informado.', 'invalid_shipping');
    if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== quote.totalCents) {
      throw new HttpError(409, 'Os valores do pedido foram atualizados. Revise o resumo antes de continuar.', 'total_changed', { totalCents: quote.totalCents });
    }

    const isDemo = quote.lines.some((l) => l.isDemo) || quote.shipping.isDemo;
    const expires = new Date(Date.now() + env.ORDER_PAYMENT_WINDOW_MINUTES * 60_000).toISOString();
    const couponEval = input.couponCode ? evaluateCoupon(input.couponCode, quote.lines, quote.subtotalCents, userId) : null;
    const tmpNumber = `TMP-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const a = input.address;
    const customer = input.customer ?? db.get<{ email: string; name: string | null }>('SELECT u.email, p.full_name AS name FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?', userId);
    const utm = { source: clean(input.attribution?.utmSource), medium: clean(input.attribution?.utmMedium), campaign: clean(input.attribution?.utmCampaign)?.toLowerCase() ?? null };
    const campaign = utm.campaign ? db.get<{ id: number }>('SELECT id FROM campaigns WHERE utm_campaign = ?', utm.campaign) : null;
    const packaging = getSettings().operations.packagingCostCents;
    const { lastInsertRowid: orderId } = db.run(
      `INSERT INTO orders (number, user_id, status, subtotal_cents, discount_cents, shipping_cents, total_cents, coupon_id, coupon_code,
         shipping_option_id, shipping_label, shipping_days_text, shipping_is_demo, ship_recipient, ship_cep, ship_street, ship_number, ship_complement,
         ship_district, ship_city, ship_state, is_demo, expires_at, customer_email, customer_name, campaign_id, utm_source, utm_medium, utm_campaign, packaging_cost_cents, guest_access_hash)
       VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tmpNumber, userId, quote.subtotalCents, quote.discountCents, quote.shippingCents, quote.totalCents,
      couponEval?.valid ? couponEval.coupon!.id : null, couponEval?.valid ? couponEval.coupon!.code : null,
      quote.shipping.id, quote.shipping.label, daysText(quote.shipping), quote.shipping.isDemo,
      a.recipient, a.cep, a.street, a.number, a.complement ?? null, a.district, a.city, a.state, isDemo, expires,
      customer?.email ?? null, customer?.name ?? null, campaign?.id ?? null, utm.source, utm.medium, utm.campaign, packaging, input.guestAccessHash ?? null,
    );
    const number = `GZ${String(100000 + orderId)}`;
    db.run('UPDATE orders SET number = ? WHERE id = ?', number, orderId);

    for (const l of quote.lines) {
      moveStock(l.variantId, -l.quantity, 'order_reserve', `customer:${userId}`, orderId);
      const v = db.get<{ sku: string; cost: number | null }>('SELECT v.sku, COALESCE(v.cost_cents, p.cost_cents) AS cost FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?', l.variantId)!;
      db.run(
        `INSERT INTO order_items (order_id, product_id, variant_id, sku, product_name, product_slug, color_name, size, image_url, unit_price_cents, quantity, line_total_cents, unit_cost_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        orderId, l.productId, l.variantId, v.sku, l.name, l.productSlug, l.colorName, l.size, l.image?.url ?? null, l.unitPriceCents, l.quantity, l.lineTotalCents, v.cost,
      );
    }
    if (couponEval?.valid) {
      db.run('INSERT INTO coupon_redemptions (coupon_id, order_id, user_id, discount_cents) VALUES (?, ?, ?, ?)', couponEval.coupon!.id, orderId, userId, quote.discountCents);
    }
    addOrderEvent(orderId, 'created', 'Pedido criado. Estoque reservado até a confirmação do pagamento.', `customer:${userId}`);
    setUserCartItems(userId, []);
    emit('order.created', { orderId });
    return getOrder(orderId)!;
  });
}

/** Devolve o estoque e libera o cupom de um pedido (idempotente). */
export function releaseOrder(orderId: number, actor: string): void {
  const db = getDb();
  db.tx(() => {
    const o = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o || o.stock_released) return;
    for (const it of db.all<{ variant_id: number | null; quantity: number }>('SELECT variant_id, quantity FROM order_items WHERE order_id = ?', orderId)) {
      if (it.variant_id) moveStock(it.variant_id, it.quantity, 'order_release', actor, orderId);
    }
    db.run("UPDATE coupon_redemptions SET status = 'released' WHERE order_id = ?", orderId);
    db.run('UPDATE orders SET stock_released = 1, updated_at = ? WHERE id = ?', nowIso(), orderId);
  });
}

export function cancelOrder(orderId: number, reason: string, actor: string): void {
  const db = getDb();
  db.tx(() => {
    const o = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
    if (o.status !== 'pending_payment') throw new HttpError(409, 'Somente pedidos aguardando pagamento podem ser cancelados diretamente. Pedidos pagos exigem estorno pelo provedor.', 'invalid_transition');
    const approved = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND status = 'approved'", orderId)!.n;
    if (approved) throw new HttpError(409, 'Há um pagamento aprovado neste pedido.', 'invalid_transition');
    db.run("UPDATE orders SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), orderId);
    releaseOrder(orderId, actor);
    addOrderEvent(orderId, 'cancelled', reason, actor);
    emit('order.cancelled', { orderId, reason });
  });
}

/** Transições operacionais permitidas ao administrador (pagamento NÃO pode ser marcado manualmente). */
export const ADMIN_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  paid: ['processing'],
  processing: ['shipped'],
  shipped: ['delivered'],
};

export function adminUpdateOrder(orderId: number, adminId: string, patch: { status?: OrderStatus; trackingCode?: string | null; trackingUrl?: string | null; carrier?: string | null; note?: string }): OrderDTO {
  const db = getDb();
  return db.tx(() => {
    const o = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
    const actor = `admin:${adminId}`;
    if (patch.status && patch.status !== o.status) {
      if (patch.status === 'cancelled') {
        cancelOrder(orderId, patch.note || 'Pedido cancelado pelo administrador.', actor);
      } else {
        const allowed = ADMIN_TRANSITIONS[o.status] ?? [];
        if (!allowed.includes(patch.status)) throw new HttpError(409, `Transição não permitida: ${ORDER_STATUS_LABEL[o.status]} → ${ORDER_STATUS_LABEL[patch.status] ?? patch.status}.`, 'invalid_transition');
        if (patch.status === 'shipped' && !(patch.trackingCode ?? o.tracking_code)) throw new HttpError(400, 'Informe o código de rastreamento para marcar como enviado.', 'tracking_required');
        db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', patch.status, nowIso(), orderId);
        addOrderEvent(orderId, `status:${patch.status}`, patch.note || `Status alterado para "${ORDER_STATUS_LABEL[patch.status] ?? patch.status}".`, actor);
        // Mantém o registro de envio coerente com a etapa operacional.
        const shipStatus = patch.status === 'processing' ? 'preparing' : patch.status === 'shipped' ? 'shipped' : 'delivered';
        upsertShipmentForOrder(orderId, shipStatus, actor, { trackingCode: patch.trackingCode ?? o.tracking_code, trackingUrl: patch.trackingUrl ?? o.tracking_url, carrier: patch.carrier ?? null });
        emit('order.status', { orderId, status: patch.status });
      }
    }
    if (patch.trackingCode !== undefined || patch.trackingUrl !== undefined) {
      const code = patch.trackingCode === undefined ? o.tracking_code : patch.trackingCode || null;
      const url = patch.trackingUrl === undefined ? o.tracking_url : patch.trackingUrl || null;
      if (code !== o.tracking_code || url !== o.tracking_url) {
        db.run('UPDATE orders SET tracking_code = ?, tracking_url = ?, updated_at = ? WHERE id = ?', code, url, nowIso(), orderId);
        const s = db.get<{ id: number }>('SELECT id FROM shipments WHERE order_id = ? ORDER BY id DESC LIMIT 1', orderId);
        if (s) db.run('UPDATE shipments SET tracking_code = ?, tracking_url = ?, carrier = COALESCE(?, carrier), updated_at = ? WHERE id = ?', code, url, patch.carrier ?? null, nowIso(), s.id);
        addOrderEvent(orderId, 'tracking', code ? `Código de rastreamento registrado: ${code}` : 'Rastreamento removido.', actor);
        if (code && s) emit('shipment.updated', { orderId, shipmentId: s.id, status: 'tracking' });
      }
    }
    audit({ actor, action: 'order.update', entity: 'order', entityId: orderId, data: patch });
    return getOrder(orderId, { withCustomer: true, admin: true })!;
  });
}

const SHIP_EVENT_TEXT: Record<string, string> = {
  preparing: 'Pedido em preparação para envio.', shipped: 'Pedido enviado.', delivered: 'Entrega confirmada.',
};

/** Cria/atualiza o envio do pedido a partir da etapa operacional (fluxo manual). */
export function upsertShipmentForOrder(orderId: number, status: 'preparing' | 'shipped' | 'delivered', actor: string, data: { trackingCode?: string | null; trackingUrl?: string | null; carrier?: string | null }): number {
  const db = getDb();
  let s = db.get<{ id: number; status: string }>("SELECT id, status FROM shipments WHERE order_id = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1", orderId);
  const now = nowIso();
  if (!s) {
    const id = db.run('INSERT INTO shipments (order_id, status, provider, carrier, tracking_code, tracking_url) VALUES (?, ?, ?, ?, ?, ?)', orderId, 'pending', 'manual', data.carrier ?? null, data.trackingCode ?? null, data.trackingUrl ?? null).lastInsertRowid;
    s = { id, status: 'pending' };
  }
  db.run(
    `UPDATE shipments SET status = ?, tracking_code = COALESCE(?, tracking_code), tracking_url = COALESCE(?, tracking_url), carrier = COALESCE(?, carrier),
       shipped_at = CASE WHEN ? IN ('shipped','delivered') THEN COALESCE(shipped_at, ?) ELSE shipped_at END,
       delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, ?) ELSE delivered_at END, updated_at = ? WHERE id = ?`,
    status, data.trackingCode ?? null, data.trackingUrl ?? null, data.carrier ?? null, status, now, status, now, now, s.id,
  );
  db.run("INSERT INTO shipment_events (shipment_id, status, description, source, occurred_at) VALUES (?, ?, ?, 'admin', ?)", s.id, status, SHIP_EVENT_TEXT[status] ?? status, now);
  emit('shipment.updated', { orderId, shipmentId: s.id, status });
  void actor;
  return s.id;
}

export const toPayment = (p: Record<string, unknown>): PaymentDTO => ({
  id: p.id as number,
  provider: p.provider as PaymentDTO['provider'],
  method: p.method as PaymentDTO['method'],
  status: p.status as PaymentDTO['status'],
  statusDetail: (p.status_detail as string) ?? null,
  amountCents: p.amount_cents as number,
  refundedCents: (p.refunded_cents as number) ?? 0,
  feeCents: (p.fee_cents as number) ?? null,
  pixQrCode: (p.pix_qr_code as string) ?? null,
  pixQrBase64: (p.pix_qr_base64 as string) ?? null,
  pixTicketUrl: (p.pix_ticket_url as string) ?? null,
  boletoUrl: (p.boleto_url as string) ?? null,
  boletoBarcode: (p.boleto_barcode as string) ?? null,
  cardLastFour: (p.card_last_four as string) ?? null,
  installments: (p.installments as number) ?? null,
  expiresAt: (p.expires_at as string) ?? null,
  createdAt: p.created_at as string,
});

export function shipmentsFor(orderId: number, admin = false): ShipmentDTO[] {
  const db = getDb();
  return db.all<Record<string, unknown>>('SELECT * FROM shipments WHERE order_id = ? ORDER BY id', orderId).map((s) => ({
    id: s.id as number, status: s.status as ShipmentDTO['status'], provider: s.provider as ShipmentDTO['provider'], carrier: (s.carrier as string) ?? null, service: (s.service as string) ?? null,
    trackingCode: (s.tracking_code as string) ?? null, trackingUrl: (s.tracking_url as string) ?? null, shippedAt: (s.shipped_at as string) ?? null, deliveredAt: (s.delivered_at as string) ?? null,
    createdAt: s.created_at as string, ...(admin ? { labelUrl: (s.label_url as string) ?? null, costCents: (s.cost_cents as number) ?? null } : {}),
    events: db.all<{ status: string; description: string; location: string | null; occurred_at: string; source: string }>('SELECT * FROM shipment_events WHERE shipment_id = ? ORDER BY occurred_at, id', s.id as number)
      .map((e) => ({ status: e.status, description: e.description, location: e.location, occurredAt: e.occurred_at, source: e.source })),
  }));
}

export function getOrder(orderId: number, opts: { withCustomer?: boolean; admin?: boolean } = {}): OrderDTO | null {
  const db = getDb();
  const o = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) return null;
  const items = db.all<Record<string, unknown>>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', orderId).map((i) => ({
    sku: i.sku as string, productName: i.product_name as string, productSlug: i.product_slug as string, colorName: i.color_name as string, size: i.size as string,
    imageUrl: (i.image_url as string) ?? null, unitPriceCents: i.unit_price_cents as number, quantity: i.quantity as number, lineTotalCents: i.line_total_cents as number,
    ...(opts.admin ? { id: i.id as number, unitCostCents: (i.unit_cost_cents as number) ?? null } : { id: i.id as number }),
  }));
  const payments = db.all<Record<string, unknown>>('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC', orderId).map(toPayment);
  const events = db.all<{ type: string; message: string; actor: string; created_at: string }>('SELECT * FROM order_events WHERE order_id = ? ORDER BY id', orderId)
    .map((e) => ({ type: e.type, message: e.message, actor: e.actor.startsWith('admin:') ? 'admin' : e.actor.startsWith('customer:') ? 'customer' : e.actor, createdAt: e.created_at }));
  const shipments = shipmentsFor(orderId, opts.admin);
  const refunds = db.all<{ id: number; amount_cents: number; status: RefundDTO['status']; reason: string; created_at: string; confirmed_at: string | null }>('SELECT * FROM refunds WHERE order_id = ? ORDER BY id', orderId)
    .map((r) => ({ id: r.id, amountCents: r.amount_cents, status: r.status, reason: r.reason, createdAt: r.created_at, confirmedAt: r.confirmed_at }));
  const returns = db.all<{ id: number; number: string; type: string; status: string; created_at: string }>('SELECT * FROM return_requests WHERE order_id = ? ORDER BY id', orderId)
    .map((r) => ({ id: r.id, number: r.number, type: r.type, status: r.status, createdAt: r.created_at }));
  const delivered = shipments.find((s) => s.status === 'delivered')?.deliveredAt ?? null;
  const dto: OrderDTO = {
    id: o.id, number: o.number, status: o.status, subtotalCents: o.subtotal_cents, discountCents: o.discount_cents, shippingCents: o.shipping_cents, totalCents: o.total_cents,
    couponCode: o.coupon_code, shippingLabel: o.shipping_label, shippingDaysText: o.shipping_days_text, shippingIsDemo: Boolean(o.shipping_is_demo),
    address: { recipient: o.ship_recipient, cep: o.ship_cep, street: o.ship_street, number: o.ship_number, complement: o.ship_complement, district: o.ship_district, city: o.ship_city, state: o.ship_state },
    trackingCode: o.tracking_code, trackingUrl: o.tracking_url, isDemo: Boolean(o.is_demo), expiresAt: o.expires_at, createdAt: o.created_at, items, payments, events,
    shipments, refunds, returns,
    canRequestReturn: o.status === 'delivered' || Boolean(delivered),
    canReview: o.status === 'delivered',
  };
  if (opts.withCustomer) {
    const c = db.get<{ id: string; email: string; full_name: string | null; is_guest: number }>('SELECT u.id, u.email, p.full_name, u.is_guest FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?', o.user_id);
    if (c) dto.customer = { id: c.id, email: o.customer_email ?? c.email, name: o.customer_name ?? c.full_name ?? '', isGuest: Boolean(c.is_guest) };
  }
  if (opts.admin) {
    dto.notes = db.all<{ id: number; body: string; author: string | null; created_at: string }>(
      'SELECT n.id, n.body, COALESCE(p.full_name, u.email) AS author, n.created_at FROM order_notes n LEFT JOIN users u ON u.id = n.author_id LEFT JOIN profiles p ON p.user_id = u.id WHERE n.order_id = ? ORDER BY n.id', orderId,
    ).map((n) => ({ id: n.id, body: n.body, author: n.author ?? 'equipe', createdAt: n.created_at }));
    const camp = o.campaign_id ? db.get<{ name: string }>('SELECT name FROM campaigns WHERE id = ?', o.campaign_id) : null;
    dto.attribution = { campaign: camp?.name ?? null, utmSource: o.utm_source, utmMedium: o.utm_medium, utmCampaign: o.utm_campaign };
  }
  return dto;
}

/** Busca um pedido garantindo que pertence ao usuário (autorização no servidor). */
export function getOrderForUser(number: string, userId: string): OrderDTO {
  const row = getDb().get<{ id: number; user_id: string }>('SELECT id, user_id FROM orders WHERE number = ?', number);
  if (!row || row.user_id !== userId) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
  return getOrder(row.id)!;
}

export function listOrdersForUser(userId: string): OrderDTO[] {
  return getDb().all<{ id: number }>('SELECT id FROM orders WHERE user_id = ? ORDER BY created_at DESC', userId).map((r) => getOrder(r.id)!);
}

export function orderIdByNumber(number: string): number | null {
  return getDb().get<{ id: number }>('SELECT id FROM orders WHERE number = ?', number)?.id ?? null;
}
