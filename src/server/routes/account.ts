import { z } from 'zod';
import { features } from '../config.ts';
import { getDb } from '../db.ts';
import { HttpError, intParam, requireUser, type Router } from '../http.ts';
import { rateLimit } from '../security.ts';
import { cancelOrder, createOrder, getOrder, getOrderForUser, listOrdersForUser, orderIdByNumber, type AddressInput } from '../services/orders.ts';
import { applyPaymentUpdate, startCardPayment, startDemoPayment, startPixPayment, syncMercadoPagoPayment } from '../services/payments/index.ts';
import { addressSchema, cardPaymentSchema, checkoutSchema } from '../validation.ts';
import type { AddressDTO } from '../../shared/types.ts';

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

/** Garante que o pedido pertence ao usuário (ou que é administrador) antes de qualquer operação. */
function ownedOrderId(number: string, userId: string, isAdmin = false): number {
  const row = getDb().get<{ id: number; user_id: string }>('SELECT id, user_id FROM orders WHERE number = ?', number);
  if (!row || (row.user_id !== userId && !isAdmin)) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
  return row.id;
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
  r.get('/api/account/orders/:number', (ctx) => getOrderForUser(ctx.params.number!, requireUser(ctx).id));

  r.post('/api/account/orders/:number/cancel', (ctx) => {
    const u = requireUser(ctx);
    const id = ownedOrderId(ctx.params.number!, u.id);
    cancelOrder(id, 'Pedido cancelado pelo cliente.', `customer:${u.id}`);
    return getOrder(id);
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
    return createOrder(u.id, { items: body.items, couponCode: body.couponCode, address, shippingOptionId: body.shippingOptionId, expectedTotalCents: body.expectedTotalCents });
  });

  r.post('/api/checkout/orders/:number/pay', async (ctx) => {
    const u = requireUser(ctx);
    rateLimit(`pay:${u.id}`, 10, 10 * 60_000);
    const id = ownedOrderId(ctx.params.number!, u.id);
    const body = await ctx.body(z.object({ method: z.enum(['pix', 'credit_card', 'demo']), card: cardPaymentSchema.optional() }));
    if (body.method === 'pix') return startPixPayment(id, u);
    if (body.method === 'credit_card') {
      if (!body.card) throw new HttpError(400, 'Dados do cartão ausentes.', 'card_required');
      return startCardPayment(id, u, body.card);
    }
    return startDemoPayment(id, u);
  });

  // Consulta de status: para o Mercado Pago, sincroniza com a API do provedor (fonte confiável).
  r.get('/api/checkout/orders/:number/status', async (ctx) => {
    const u = requireUser(ctx);
    const id = ownedOrderId(ctx.params.number!, u.id);
    try {
      rateLimit(`status:${id}`, 12, 60_000);
      for (const p of getDb().all<{ id: number }>("SELECT id FROM payments WHERE order_id = ? AND provider = 'mercadopago' AND status = 'pending'", id)) await syncMercadoPagoPayment(p.id);
    } catch {
      /* limite atingido ou provedor indisponível: devolve o status já conhecido */
    }
    return getOrder(id);
  });

  // Simulador de pagamento — SOMENTE em modo demonstração (bloqueado em produção pela configuração).
  r.post('/api/checkout/payments/:id/simulate', async (ctx) => {
    const u = requireUser(ctx);
    if (!features.demoPayments) throw new HttpError(404, 'Não encontrado.', 'not_found');
    const body = await ctx.body(z.object({ outcome: z.enum(['approved', 'rejected', 'cancelled']) }));
    const pay = getDb().get<{ id: number; order_id: number; provider: string; amount_cents: number; provider_payment_id: string }>('SELECT * FROM payments WHERE id = ?', intParam(ctx.params.id));
    if (!pay || pay.provider !== 'demo') throw new HttpError(404, 'Pagamento não encontrado.', 'not_found');
    const owner = getDb().get<{ user_id: string; number: string }>('SELECT user_id, number FROM orders WHERE id = ?', pay.order_id)!;
    if (owner.user_id !== u.id && u.role !== 'admin') throw new HttpError(404, 'Pagamento não encontrado.', 'not_found');
    const result = await applyPaymentUpdate(pay.id, body.outcome, `demo_${body.outcome}`, pay.amount_cents, 'demo');
    getDb().run(
      'INSERT OR IGNORE INTO payment_events (provider, event_key, provider_payment_id, payment_id, type, status, signature_valid, result) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      'demo', `${pay.provider_payment_id}:${body.outcome}:${Date.now()}`, pay.provider_payment_id, pay.id, 'demo.simulation', body.outcome, result,
    );
    return getOrder(pay.order_id);
  });

  r.get('/api/checkout/orders/:number', (ctx) => {
    const u = requireUser(ctx);
    const id = orderIdByNumber(ctx.params.number!);
    if (!id) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
    return getOrderForUser(ctx.params.number!, u.id);
  });
}
