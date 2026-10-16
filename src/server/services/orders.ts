import { ORDER_STATUS_LABEL } from '../../shared/format.ts';
import { env } from '../config.ts';
import { getDb, nowIso } from '../db.ts';
import { HttpError } from '../http.ts';
import type { CartItemInput, OrderDTO, OrderStatus, PaymentDTO } from '../../shared/types.ts';
import { quoteCart, setUserCartItems } from './cart.ts';
import { moveStock } from './inventory.ts';
import { daysText } from './shipping.ts';
import { evaluateCoupon } from './coupons.ts';

export interface AddressInput {
  recipient: string; cep: string; street: string; number: string; complement?: string | null; district: string; city: string; state: string;
}

export interface CreateOrderInput {
  items: CartItemInput[];
  couponCode?: string | null;
  address: AddressInput;
  shippingOptionId: string;
  /** Total que o cliente viu na tela; se divergir do recalculado, o pedido não é criado. */
  expectedTotalCents?: number;
}

interface OrderRow {
  id: number; number: string; user_id: string; status: OrderStatus; subtotal_cents: number; discount_cents: number; shipping_cents: number; total_cents: number;
  coupon_id: number | null; coupon_code: string | null; shipping_option_id: string; shipping_label: string; shipping_days_text: string | null; shipping_is_demo: number;
  ship_recipient: string; ship_cep: string; ship_street: string; ship_number: string; ship_complement: string | null; ship_district: string; ship_city: string; ship_state: string;
  tracking_code: string | null; tracking_url: string | null; is_demo: number; stock_released: number; expires_at: string | null; created_at: string; updated_at: string;
}

export function addOrderEvent(orderId: number, type: string, message: string, actor: string): void {
  getDb().run('INSERT INTO order_events (order_id, type, message, actor) VALUES (?, ?, ?, ?)', orderId, type, message, actor);
}

/**
 * Cria o pedido revalidando tudo no servidor: produtos, variantes, estoque, preços, cupom e frete.
 * O estoque é reservado na mesma transação (UPDATE condicional), evitando venda acima do disponível.
 */
export function createOrder(userId: string, input: CreateOrderInput): OrderDTO {
  const db = getDb();
  return db.tx(() => {
    const quote = quoteCart({ items: input.items, couponCode: input.couponCode, userId, cep: input.address.cep, shippingOptionId: input.shippingOptionId });
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
    const { lastInsertRowid: orderId } = db.run(
      `INSERT INTO orders (number, user_id, status, subtotal_cents, discount_cents, shipping_cents, total_cents, coupon_id, coupon_code,
         shipping_option_id, shipping_label, shipping_days_text, shipping_is_demo, ship_recipient, ship_cep, ship_street, ship_number, ship_complement,
         ship_district, ship_city, ship_state, is_demo, expires_at)
       VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tmpNumber, userId, quote.subtotalCents, quote.discountCents, quote.shippingCents, quote.totalCents,
      couponEval?.valid ? couponEval.coupon!.id : null, couponEval?.valid ? couponEval.coupon!.code : null,
      quote.shipping.id, quote.shipping.label, daysText(quote.shipping), quote.shipping.isDemo,
      a.recipient, a.cep, a.street, a.number, a.complement ?? null, a.district, a.city, a.state, isDemo, expires,
    );
    const number = `GZ${String(100000 + orderId)}`;
    db.run('UPDATE orders SET number = ? WHERE id = ?', number, orderId);

    for (const l of quote.lines) {
      moveStock(l.variantId, -l.quantity, 'order_reserve', `customer:${userId}`, orderId);
      const sku = db.get<{ sku: string }>('SELECT sku FROM product_variants WHERE id = ?', l.variantId)!.sku;
      db.run(
        `INSERT INTO order_items (order_id, product_id, variant_id, sku, product_name, product_slug, color_name, size, image_url, unit_price_cents, quantity, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        orderId, l.productId, l.variantId, sku, l.name, l.productSlug, l.colorName, l.size, l.image?.url ?? null, l.unitPriceCents, l.quantity, l.lineTotalCents,
      );
    }
    if (couponEval?.valid) {
      db.run('INSERT INTO coupon_redemptions (coupon_id, order_id, user_id, discount_cents) VALUES (?, ?, ?, ?)', couponEval.coupon!.id, orderId, userId, quote.discountCents);
    }
    addOrderEvent(orderId, 'created', 'Pedido criado. Estoque reservado até a confirmação do pagamento.', `customer:${userId}`);
    setUserCartItems(userId, []);
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
    db.run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", nowIso(), orderId);
    releaseOrder(orderId, actor);
    addOrderEvent(orderId, 'cancelled', reason, actor);
  });
}

/** Transições operacionais permitidas ao administrador (pagamento NÃO pode ser marcado manualmente). */
const ADMIN_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  paid: ['processing'],
  processing: ['shipped'],
  shipped: ['delivered'],
};

export function adminUpdateOrder(orderId: number, adminId: string, patch: { status?: OrderStatus; trackingCode?: string | null; trackingUrl?: string | null; note?: string }): OrderDTO {
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
        if (!allowed.includes(patch.status)) throw new HttpError(409, `Transição não permitida: ${o.status} → ${patch.status}.`, 'invalid_transition');
        if (patch.status === 'shipped' && !(patch.trackingCode ?? o.tracking_code)) throw new HttpError(400, 'Informe o código de rastreamento para marcar como enviado.', 'tracking_required');
        db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', patch.status, nowIso(), orderId);
        addOrderEvent(orderId, `status:${patch.status}`, patch.note || `Status alterado para "${ORDER_STATUS_LABEL[patch.status] ?? patch.status}".`, actor);
      }
    }
    if (patch.trackingCode !== undefined || patch.trackingUrl !== undefined) {
      const code = patch.trackingCode === undefined ? o.tracking_code : patch.trackingCode || null;
      const url = patch.trackingUrl === undefined ? o.tracking_url : patch.trackingUrl || null;
      if (code !== o.tracking_code || url !== o.tracking_url) {
        db.run('UPDATE orders SET tracking_code = ?, tracking_url = ?, updated_at = ? WHERE id = ?', code, url, nowIso(), orderId);
        addOrderEvent(orderId, 'tracking', code ? `Código de rastreamento registrado: ${code}` : 'Rastreamento removido.', actor);
      }
    }
    db.run('INSERT INTO audit_log (actor, action, entity, entity_id, data) VALUES (?, ?, ?, ?, ?)', actor, 'order.update', 'order', String(orderId), JSON.stringify(patch));
    return getOrder(orderId)!;
  });
}

const toPayment = (p: Record<string, unknown>): PaymentDTO => ({
  id: p.id as number,
  provider: p.provider as PaymentDTO['provider'],
  method: p.method as PaymentDTO['method'],
  status: p.status as PaymentDTO['status'],
  statusDetail: (p.status_detail as string) ?? null,
  amountCents: p.amount_cents as number,
  pixQrCode: (p.pix_qr_code as string) ?? null,
  pixQrBase64: (p.pix_qr_base64 as string) ?? null,
  pixTicketUrl: (p.pix_ticket_url as string) ?? null,
  cardLastFour: (p.card_last_four as string) ?? null,
  installments: (p.installments as number) ?? null,
  expiresAt: (p.expires_at as string) ?? null,
  createdAt: p.created_at as string,
});

export function getOrder(orderId: number, opts: { withCustomer?: boolean } = {}): OrderDTO | null {
  const db = getDb();
  const o = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) return null;
  const items = db.all<Record<string, unknown>>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', orderId).map((i) => ({
    sku: i.sku as string, productName: i.product_name as string, productSlug: i.product_slug as string, colorName: i.color_name as string, size: i.size as string,
    imageUrl: (i.image_url as string) ?? null, unitPriceCents: i.unit_price_cents as number, quantity: i.quantity as number, lineTotalCents: i.line_total_cents as number,
  }));
  const payments = db.all<Record<string, unknown>>('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC', orderId).map(toPayment);
  const events = db.all<{ type: string; message: string; actor: string; created_at: string }>('SELECT * FROM order_events WHERE order_id = ? ORDER BY id', orderId)
    .map((e) => ({ type: e.type, message: e.message, actor: e.actor.startsWith('admin:') ? 'admin' : e.actor.startsWith('customer:') ? 'customer' : e.actor, createdAt: e.created_at }));
  const dto: OrderDTO = {
    id: o.id, number: o.number, status: o.status, subtotalCents: o.subtotal_cents, discountCents: o.discount_cents, shippingCents: o.shipping_cents, totalCents: o.total_cents,
    couponCode: o.coupon_code, shippingLabel: o.shipping_label, shippingDaysText: o.shipping_days_text, shippingIsDemo: Boolean(o.shipping_is_demo),
    address: { recipient: o.ship_recipient, cep: o.ship_cep, street: o.ship_street, number: o.ship_number, complement: o.ship_complement, district: o.ship_district, city: o.ship_city, state: o.ship_state },
    trackingCode: o.tracking_code, trackingUrl: o.tracking_url, isDemo: Boolean(o.is_demo), expiresAt: o.expires_at, createdAt: o.created_at, items, payments, events,
  };
  if (opts.withCustomer) {
    const c = db.get<{ id: string; email: string; full_name: string | null }>('SELECT u.id, u.email, p.full_name FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?', o.user_id);
    if (c) dto.customer = { id: c.id, email: c.email, name: c.full_name ?? '' };
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
