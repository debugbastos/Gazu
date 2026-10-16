import './_setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getDb } from '../../src/server/db.ts';
import { mapMpStatus, setMercadoPagoFetch, verifyMpSignature } from '../../src/server/services/payments/mercadopago.ts';
import { admin, client, customer, inStockVariant, placeOrder } from './_harness.ts';

// ---- Mercado Pago simulado (nenhuma chamada real ao provedor) ----
const mpPayments = new Map<string, any>();
let nextMpId = 9_000_000;
setMercadoPagoFetch(async (url, init) => {
  const u = String(url);
  if (init?.method === 'POST' && u.endsWith('/v1/payments')) {
    const body = JSON.parse(String(init.body));
    const id = String(++nextMpId);
    const p = { id, status: body.payment_method_id === 'pix' ? 'pending' : 'approved', status_detail: 'pending_waiting_transfer', transaction_amount: body.transaction_amount, external_reference: body.external_reference, payment_method_id: body.payment_method_id, point_of_interaction: { transaction_data: { qr_code: '00020126-PIX-TESTE', qr_code_base64: 'iVBORw0KGgo=' } } };
    mpPayments.set(id, p);
    return new Response(JSON.stringify(p), { status: 201 });
  }
  const m = /\/v1\/payments\/(\d+)$/.exec(u);
  if (m) { const p = mpPayments.get(m[1]!); return new Response(JSON.stringify(p ?? { message: 'not found' }), { status: p ? 200 : 404 }); }
  return new Response('{}', { status: 404 });
});

const sign = (dataId: string, requestId = 'req-1', ts = String(Math.floor(Date.now() / 1000)), secret = 'test-webhook-secret') => {
  const v1 = crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
};
const webhook = async (c: Awaited<ReturnType<typeof client>>, dataId: string, headers: Record<string, string>) =>
  c.req('POST', `/api/webhooks/mercadopago?data.id=${dataId}&type=payment`, { action: 'payment.updated', data: { id: dataId }, type: 'payment' }, headers);

test('assinatura do webhook: válida, adulterada, segredo errado e expirada', () => {
  const h = sign('123');
  assert.equal(verifyMpSignature({ signatureHeader: h['x-signature'], requestId: 'req-1', dataId: '123', secret: 'test-webhook-secret' }), true);
  assert.equal(verifyMpSignature({ signatureHeader: h['x-signature'], requestId: 'req-1', dataId: '124', secret: 'test-webhook-secret' }), false);
  assert.equal(verifyMpSignature({ signatureHeader: sign('123', 'req-1', undefined, 'outro')['x-signature'], requestId: 'req-1', dataId: '123', secret: 'test-webhook-secret' }), false);
  const old = sign('123', 'req-1', String(Math.floor(Date.now() / 1000) - 3600));
  assert.equal(verifyMpSignature({ signatureHeader: old['x-signature'], requestId: 'req-1', dataId: '123', secret: 'test-webhook-secret' }), false);
  assert.equal(verifyMpSignature({ signatureHeader: undefined, requestId: 'req-1', dataId: '123', secret: 'x' }), false);
});

test('mapeamento de status do Mercado Pago', () => {
  assert.equal(mapMpStatus({ status: 'approved', transaction_amount: 10 }), 'approved');
  assert.equal(mapMpStatus({ status: 'pending', transaction_amount: 10 }), 'pending');
  assert.equal(mapMpStatus({ status: 'in_process', transaction_amount: 10 }), 'pending');
  assert.equal(mapMpStatus({ status: 'rejected', transaction_amount: 10 }), 'rejected');
  assert.equal(mapMpStatus({ status: 'cancelled', transaction_amount: 10 }), 'cancelled');
  assert.equal(mapMpStatus({ status: 'refunded', transaction_amount: 10 }), 'refunded');
});

test('checkout exige login', async () => {
  const c = await client();
  const r = await c.req('POST', '/api/checkout/orders', { items: [{ variantId: 1, quantity: 1 }], shippingOptionId: 'x' });
  assert.equal(r.status, 401);
});

test('pedido: total divergente do servidor é recusado (sem alterar preço)', async () => {
  const c = await customer();
  const v = inStockVariant(1);
  const q = await c.req('POST', '/api/cart/quote', { items: [{ variantId: v.id, quantity: 1 }], cep: '01310100' });
  const ship = q.body.shippingOptions[0].id;
  const r = await c.req('POST', '/api/checkout/orders', { items: [{ variantId: v.id, quantity: 1 }], shippingOptionId: ship, expectedTotalCents: 100, address: { recipient: 'Cliente', cep: '01310100', street: 'Rua A', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'total_changed');
});

test('pedido: estoque insuficiente é recusado no servidor', async () => {
  const c = await customer();
  const v = inStockVariant(1);
  getDb().run('UPDATE product_variants SET stock = 1 WHERE id = ?', v.id);
  const items = [{ variantId: v.id, quantity: 2 }];
  const q = await c.req('POST', '/api/cart/quote', { items, cep: '01310100' });
  const r = await c.req('POST', '/api/checkout/orders', { items, shippingOptionId: q.body.shippingOptions[0].id, address: { recipient: 'Cliente', cep: '01310100', street: 'Rua A', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'stock_problem');
});

test('fluxo completo Pix: reserva estoque, webhook assinado aprova, evento repetido é idempotente', async () => {
  const c = await customer();
  const v = inStockVariant(2);
  const before = getDb().get<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', v.id)!.stock;
  const { res } = await placeOrder(c, [{ variantId: v.id, quantity: 2 }]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const order = res.body;
  assert.equal(order.status, 'pending_payment');
  assert.equal(getDb().get<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', v.id)!.stock, before - 2, 'estoque reservado');
  assert.equal(order.items[0].unitPriceCents, v.priceCents, 'snapshot do preço no item');

  // Navegador tentando marcar como pago: não existe rota para isso; simulação só no provedor "demo".
  const fake = await c.req('POST', `/api/checkout/payments/1/simulate`, { outcome: 'approved' });
  assert.notEqual(fake.status, 200);

  const pay = await c.req('POST', `/api/checkout/orders/${order.number}/pay`, { method: 'pix' });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  const pix = pay.body.payments[0];
  assert.equal(pix.status, 'pending');
  assert.ok(pix.pixQrCode);
  const mpId = [...mpPayments.values()].find((p) => p.external_reference === order.number).id;

  // Webhook sem assinatura válida: ignorado.
  const anon = await client();
  const bad = await webhook(anon, mpId, { 'x-signature': 'ts=1,v1=' + '0'.repeat(64), 'x-request-id': 'r' });
  assert.equal(bad.status, 401);
  assert.equal((await c.req('GET', `/api/account/orders/${order.number}`)).body.status, 'pending_payment');

  // Provedor aprova → webhook assinado → pedido pago.
  mpPayments.get(mpId).status = 'approved';
  const ts = String(Math.floor(Date.now() / 1000));
  const ok = await webhook(anon, mpId, sign(mpId, 'req-a', ts));
  assert.equal(ok.status, 200);
  const paid = await c.req('GET', `/api/account/orders/${order.number}`);
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.payments[0].status, 'approved');

  // Mesma notificação repetida: sem efeitos duplicados.
  const events = paid.body.events.length;
  const dup = await webhook(anon, mpId, sign(mpId, 'req-a', ts));
  assert.equal(dup.status, 200);
  const again = await c.req('GET', `/api/account/orders/${order.number}`);
  assert.equal(again.body.events.length, events);
});

test('valor divergente informado pelo provedor não aprova o pedido', async () => {
  const c = await customer();
  const v = inStockVariant(1);
  const { res } = await placeOrder(c, [{ variantId: v.id, quantity: 1 }]);
  const order = res.body;
  await c.req('POST', `/api/checkout/orders/${order.number}/pay`, { method: 'pix' });
  const mp = [...mpPayments.values()].find((p) => p.external_reference === order.number);
  mp.status = 'approved';
  mp.transaction_amount = 1; // R$ 1,00 em vez do total
  const anon = await client();
  await webhook(anon, mp.id, sign(mp.id, 'req-b'));
  const after = await c.req('GET', `/api/account/orders/${order.number}`);
  assert.equal(after.body.status, 'pending_payment');
  assert.ok(after.body.events.some((e: any) => e.type === 'amount_mismatch'));
});

test('webhook de pedido inexistente é ignorado', async () => {
  mpPayments.set('777', { id: '777', status: 'approved', transaction_amount: 10, external_reference: 'GZ999999' });
  const anon = await client();
  const r = await webhook(anon, '777', sign('777', 'req-c'));
  assert.equal(r.status, 200);
  assert.equal(getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM orders WHERE number = 'GZ999999'")!.n, 0);
});

test('cancelamento pelo cliente devolve estoque; admin não pode marcar como pago', async () => {
  const c = await customer();
  const v = inStockVariant(1);
  const before = getDb().get<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', v.id)!.stock;
  const { res } = await placeOrder(c, [{ variantId: v.id, quantity: 1 }]);
  const a = await admin();
  const tryPaid = await a.req('PATCH', `/api/admin/orders/${res.body.number}`, { status: 'paid' });
  assert.equal(tryPaid.status, 400, 'status "paid" não é aceito pelo painel');
  const cancel = await c.req('POST', `/api/account/orders/${res.body.number}/cancel`);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.status, 'cancelled');
  assert.equal(getDb().get<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', v.id)!.stock, before);
});
