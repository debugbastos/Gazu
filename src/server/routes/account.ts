import { z } from 'zod';
import { features } from '../config.ts';
import { getDb } from '../db.ts';
import { HttpError, intParam, requireUser, type Ctx, type Router } from '../http.ts';
import { rateLimit } from '../security.ts';
import { cancelOrder, createOrder, getOrder, listOrdersForUser, type AddressInput } from '../services/orders.ts';
import {
  applyPaymentUpdate, cancelPendingProviderPayments, installmentsInfo, startBoletoPayment, startCardPayment, startDemoPayment, startPixPayment, syncMercadoPagoPayment,
} from '../services/payments/index.ts';
import { addGuestGrant, claimGuestLink, guestOrderNumbers, guestUserFor, newGuestToken, orderAccess } from '../services/guest.ts';
import { createReturnRequest, getReturn, returnEligibility } from '../services/returns.ts';
import { notifyOrderCreated } from '../services/notifications.ts';
import { recordConsent } from '../services/privacy.ts';
import { addressSchema, boletoSchema, cardPaymentSchema, checkoutSchema, email as emailSchema, guestCheckoutSchema, returnRequestSchema } from '../validation.ts';
import type { AddressDTO, OrderDTO } from '../../shared/types.ts';

interface AddressRow { id: number; user_id: string; label: string; recipient: string; cep: string; street: string; number: string; complement: string | null; district: string; city: string; state: string; is_default: number }
const toAddress = (a: AddressRow): AddressDTO => ({ id: a.id, label: a.label, recipient: a.recipient, cep: a.cep, street: a.street, number: a.number, complement: a.complement, district: a.district, city: a.city, state: a.state, isDefault: Boolean(a.is_default) });

export function listAddresses(userId: string): AddressDTO[] {
  return getDb().all<AddressRow>('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', userId).map(toAddress);
}

function saveAddress(userId: string, a: z.infer<typeof addressSchema>, id?: number): number {
  const db = getDb();
  return db.tx(() => {
    const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?', userId)!.n;
    if (!id && count >= 10) throw new HttpError(400, 'Limite de 10 endereços atingido.', 'too_many_addresses');
    const makeDefault = a.isDefault || count === 0;
    if (makeDefault) db.run('UPDATE addresses SET is_default = 0 WHERE user_id = ?', userId);
    if (id) {
      const r = db.run(
        `UPDATE addresses SET label = ?, recipient = ?, cep = ?, street = ?, number = ?, complement = ?, district = ?, city = ?, state = ?, is_default = CASE WHEN ? THEN 1 ELSE is_default END
          WHERE id = ? AND user_id = ?`,
        a.label, a.recipient, a.cep, a.street, a.number, a.complement ?? null, a.district, a.city, a.state, makeDefault, id, userId,
      );
      if (!r.changes) throw new HttpError(404, 'Endereço não encontrado.', 'not_found');
      return id;
    }
    return db.run(
      'INSERT INTO addresses (user_id, label, recipient, cep, street, number, complement, district, city, state, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      userId, a.label, a.recipient, a.cep, a.street, a.number, a.complement ?? null, a.district, a.city, a.state, makeDefault,
    ).lastInsertRowid;
  });
}

/** Pedido visto pelo cliente (dono autenticado ou visitante com acesso). */
function customerOrder(ctx: Ctx, number: string): OrderDTO {
  const access = orderAccess(ctx, number);
  const o = getOrder(access.orderId)!;
  return { ...o, guest: access.guest };
}

/** Rastreio público: somente dados de entrega/status, sem endereço completo nem dados pessoais. */
function publicTracking(orderId: number) {
  const o = getOrder(orderId)!;
  return {
    number: o.number, status: o.status, createdAt: o.createdAt, shippingLabel: o.shippingLabel, shippingDaysText: o.shippingDaysText, isDemo: o.isDemo,
    destination: `${o.address.city}/${o.address.state}`, itemsCount: o.items.reduce((n, i) => n + i.quantity, 0),
    shipments: (o.shipments ?? []).map((s) => ({ status: s.status, carrier: s.carrier, trackingCode: s.trackingCode, trackingUrl: s.trackingUrl, shippedAt: s.shippedAt, deliveredAt: s.deliveredAt, events: s.events })),
    timeline: o.events.filter((e) => ['created', 'paid', 'expired', 'cancelled', 'refunded'].includes(e.type) || e.type.startsWith('status:')).map((e) => ({ type: e.type, message: e.message, createdAt: e.createdAt })),
  };
}

export function registerAccountRoutes(r: Router): void {
  r.get('/api/account/addresses', (ctx) => ({ addresses: listAddresses(requireUser(ctx).id) }));
  r.post('/api/account/addresses', async (ctx) => {
    const u = requireUser(ctx);
    const id = saveAddress(u.id, await ctx.body(addressSchema));
    return { id, addresses: listAddresses(u.id) };
  });
  r.put('/api/account/addresses/:id', async (ctx) => {
    const u = requireUser(ctx);
    saveAddress(u.id, await ctx.body(addressSchema), intParam(ctx.params.id));
    return { addresses: listAddresses(u.id) };
  });
  r.delete('/api/account/addresses/:id', (ctx) => {
    const u = requireUser(ctx);
    const id = intParam(ctx.params.id);
    const db = getDb();
    db.tx(() => {
      const row = db.get<AddressRow>('SELECT * FROM addresses WHERE id = ? AND user_id = ?', id, u.id);
      if (!row) throw new HttpError(404, 'Endereço não encontrado.', 'not_found');
      db.run('DELETE FROM addresses WHERE id = ?', id);
      if (row.is_default) db.run('UPDATE addresses SET is_default = 1 WHERE id = (SELECT id FROM addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1)', u.id);
    });
    return { addresses: listAddresses(u.id) };
  });

  r.get('/api/account/orders', (ctx) => ({ orders: listOrdersForUser(requireUser(ctx).id) }));
  r.get('/api/account/orders/:number', (ctx) => {
    requireUser(ctx);
    return customerOrder(ctx, ctx.params.number!);
  });
  r.get('/api/account/returns', (ctx) => {
    const u = requireUser(ctx);
    return { returns: getDb().all<{ id: number }>('SELECT id FROM return_requests WHERE user_id = ? ORDER BY id DESC', u.id).map((x) => getReturn(x.id, { admin: false })!) };
  });

  // ---- Pedidos (cliente autenticado ou visitante com acesso) ----
  r.get('/api/orders/guest', (ctx) => ({ orders: guestOrderNumbers(ctx).map((n) => customerOrder(ctx, n)) }));
  r.get('/api/orders/:number', (ctx) => customerOrder(ctx, ctx.params.number!));

  /** Link do e-mail de confirmação (visitante): valida o token e grava o acesso em cookie HttpOnly. */
  r.post('/api/orders/guest-access', async (ctx) => {
    rateLimit(`guest-access:${ctx.ip}`, 20, 15 * 60_000);
    const body = await ctx.body(z.object({ number: z.string().min(3).max(20), token: z.string().min(10).max(100) }));
    if (!claimGuestLink(ctx, body.number, body.token)) throw new HttpError(404, 'Link de acesso inválido.', 'not_found');
    return customerOrder(ctx, body.number);
  });

  /** Rastreio público por número do pedido + e-mail da compra (sem login). */
  r.post('/api/orders/track', async (ctx) => {
    rateLimit(`track:${ctx.ip}`, 15, 15 * 60_000);
    const body = await ctx.body(z.object({ number: z.string().trim().toUpperCase().min(3).max(20), email: emailSchema }));
    const row = getDb().get<{ id: number; email: string }>('SELECT o.id, COALESCE(o.customer_email, u.email) AS email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.number = ?', body.number);
    if (!row || row.email.toLowerCase() !== body.email) throw new HttpError(404, 'Não encontramos um pedido com esse número e e-mail.', 'not_found');
    return publicTracking(row.id);
  });

  r.post('/api/orders/:number/cancel', async (ctx) => {
    const access = orderAccess(ctx, ctx.params.number!);
    cancelOrder(access.orderId, 'Pedido cancelado pelo cliente.', access.guest ? `guest:${access.userId}` : `customer:${access.userId}`);
    await cancelPendingProviderPayments(access.orderId);
    return customerOrder(ctx, ctx.params.number!);
  });
  // Compatibilidade com a rota anterior.
  r.post('/api/account/orders/:number/cancel', async (ctx) => {
    requireUser(ctx);
    const access = orderAccess(ctx, ctx.params.number!);
    cancelOrder(access.orderId, 'Pedido cancelado pelo cliente.', `customer:${access.userId}`);
    await cancelPendingProviderPayments(access.orderId);
    return customerOrder(ctx, ctx.params.number!);
  });

  // ---- Trocas e devoluções ----
  r.get('/api/orders/:number/returns', (ctx) => {
    const access = orderAccess(ctx, ctx.params.number!);
    return {
      eligibility: returnEligibility(access.orderId),
      returns: getDb().all<{ id: number }>('SELECT id FROM return_requests WHERE order_id = ? ORDER BY id DESC', access.orderId).map((x) => getReturn(x.id, { admin: false })!),
    };
  });
  r.post('/api/orders/:number/returns', async (ctx) => {
    const access = orderAccess(ctx, ctx.params.number!);
    rateLimit(`return:${access.orderId}`, 5, 60 * 60_000);
    const body = await ctx.body(returnRequestSchema);
    return createReturnRequest({ orderId: access.orderId, userId: access.userId, type: body.type, reason: body.reason, items: body.items, actor: access.guest ? `guest:${access.userId}` : `customer:${access.userId}` });
  });

  // ---- Checkout ----
  r.post('/api/checkout/orders', async (ctx) => {
    const u = requireUser(ctx);
    rateLimit(`order:${u.id}`, 10, 10 * 60_000);
    const body = await ctx.body(checkoutSchema);
    let address: AddressInput;
    if (body.addressId) {
      const a = getDb().get<AddressRow>('SELECT * FROM addresses WHERE id = ? AND user_id = ?', body.addressId, u.id);
      if (!a) throw new HttpError(400, 'Endereço inválido.', 'invalid_address');
      address = a;
    } else if (body.address) {
      address = body.address;
      if (body.saveAddress) saveAddress(u.id, body.address);
    } else {
      throw new HttpError(400, 'Informe o endereço de entrega.', 'address_required');
    }
    return createOrder(u.id, { items: body.items, couponCode: body.couponCode, address, shippingOptionId: body.shippingOptionId, expectedTotalCents: body.expectedTotalCents, attribution: body.attribution });
  });

  /** Compra sem cadastro. O acesso ao pedido é dado por token exclusivo (cookie HttpOnly + link no e-mail). */
  r.post('/api/checkout/guest-orders', async (ctx) => {
    if (ctx.user) throw new HttpError(409, 'Você já está conectado — finalize pela sua conta.', 'already_logged_in');
    rateLimit(`guest-order:${ctx.ip}`, 6, 30 * 60_000);
    const body = await ctx.body(guestCheckoutSchema);
    rateLimit(`guest-order-email:${body.guest.email}`, 6, 60 * 60_000);
    const userId = guestUserFor(body.guest.email, body.guest.name);
    if (body.guest.phone) getDb().run('UPDATE profiles SET phone = COALESCE(phone, ?) WHERE user_id = ?', body.guest.phone, userId);
    const { token, hash } = newGuestToken();
    const order = await createOrder(userId, {
      items: body.items, couponCode: body.couponCode, address: body.address, shippingOptionId: body.shippingOptionId, expectedTotalCents: body.expectedTotalCents,
      attribution: body.attribution, customer: { name: body.guest.name, email: body.guest.email }, guestAccessHash: hash,
    });
    recordConsent({ subject: `email:${body.guest.email}`, purpose: 'terms', granted: true, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    recordConsent({ subject: `email:${body.guest.email}`, purpose: 'privacy', granted: true, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    addGuestGrant(ctx, order.number, token);
    await notifyOrderCreated(order.id, token);
    return { ...order, guest: true };
  });

  r.get('/api/checkout/installments', async (ctx) => {
    const amount = Number(ctx.url.searchParams.get('amount'));
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000) throw new HttpError(400, 'Valor inválido.', 'bad_amount');
    rateLimit(`installments:${ctx.ip}`, 60, 60_000);
    return installmentsInfo(amount);
  });

  r.post('/api/checkout/orders/:number/pay', async (ctx) => {
    const access = orderAccess(ctx, ctx.params.number!);
    rateLimit(`pay:${access.orderId}`, 10, 10 * 60_000);
    const body = await ctx.body(z.object({ method: z.enum(['pix', 'credit_card', 'boleto', 'demo']), card: cardPaymentSchema.optional(), boleto: boletoSchema.optional() }));
    let order: OrderDTO;
    if (body.method === 'pix') order = await startPixPayment(access);
    else if (body.method === 'boleto') {
      if (!body.boleto) throw new HttpError(400, 'Informe nome, sobrenome e CPF para emitir o boleto.', 'boleto_required');
      order = await startBoletoPayment(access, body.boleto);
    } else if (body.method === 'credit_card') {
      if (!body.card) throw new HttpError(400, 'Dados do cartão ausentes.', 'card_required');
      order = await startCardPayment(access, body.card);
    } else order = startDemoPayment(access);
    return { ...order, guest: access.guest };
  });

  // Consulta de status: para o Mercado Pago, sincroniza com a API do provedor (fonte confiável).
  r.get('/api/checkout/orders/:number/status', async (ctx) => {
    const access = orderAccess(ctx, ctx.params.number!);
    try {
      rateLimit(`status:${access.orderId}`, 12, 60_000);
      for (const p of getDb().all<{ id: number }>("SELECT id FROM payments WHERE order_id = ? AND provider = 'mercadopago' AND status IN ('pending','in_process')", access.orderId)) await syncMercadoPagoPayment(p.id);
    } catch {
      /* limite atingido ou provedor indisponível: devolve o status já conhecido */
    }
    return customerOrder(ctx, ctx.params.number!);
  });

  // Simulador de pagamento — SOMENTE em modo demonstração (bloqueado em produção pela configuração).
  r.post('/api/checkout/payments/:id/simulate', async (ctx) => {
    if (!features.demoPayments) throw new HttpError(404, 'Não encontrado.', 'not_found');
    const body = await ctx.body(z.object({ outcome: z.enum(['approved', 'rejected', 'cancelled', 'in_process']) }));
    const pay = getDb().get<{ id: number; order_id: number; provider: string; amount_cents: number; provider_payment_id: string }>('SELECT * FROM payments WHERE id = ?', intParam(ctx.params.id));
    if (!pay || pay.provider !== 'demo') throw new HttpError(404, 'Pagamento não encontrado.', 'not_found');
    const number = getDb().get<{ number: string }>('SELECT number FROM orders WHERE id = ?', pay.order_id)!.number;
    if (!(ctx.user?.role === 'admin')) orderAccess(ctx, number);
    const result = await applyPaymentUpdate(pay.id, body.outcome, `demo_${body.outcome}`, pay.amount_cents, 'demo');
    getDb().run(
      'INSERT OR IGNORE INTO payment_events (provider, event_key, provider_payment_id, payment_id, type, status, signature_valid, result, processed_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      'demo', `${pay.provider_payment_id}:${body.outcome}:${Date.now()}`, pay.provider_payment_id, pay.id, 'demo.simulation', body.outcome, result, new Date().toISOString(),
    );
    return customerOrder(ctx, number);
  });

  r.get('/api/checkout/orders/:number', (ctx) => customerOrder(ctx, ctx.params.number!));
}
