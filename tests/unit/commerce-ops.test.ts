import './_setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getDb } from '../../src/server/db.ts';
import { setMercadoPagoFetch } from '../../src/server/services/payments/mercadopago.ts';
import { canTransition, reconcilePayments, validCpf } from '../../src/server/services/payments/index.ts';
import { mapMeStatus, purchaseLabel, setMelhorEnvioFetch } from '../../src/server/services/melhorenvio.ts';
import { ADDRESS, admin, client, customer, inStockVariant, placeOrder, type Client } from './_harness.ts';

// ---- Mercado Pago simulado: nenhuma chamada real ao provedor ----
const mp = new Map<string, any>();
let nextId = 5_000_000;
let mpDown = false;
const calls: { method: string; url: string; body: any; idem: string | null }[] = [];
setMercadoPagoFetch(async (url, init) => {
  const u = String(url);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method, url: u, body, idem: (init?.headers as Record<string, string> | undefined)?.['X-Idempotency-Key'] ?? null });
  if (mpDown) return new Response('{"message":"unavailable"}', { status: 503 });
  if (method === 'POST' && u.endsWith('/v1/payments')) {
    const id = String(++nextId);
    const p: any = {
      id, status: body.payment_method_id === 'pix' || body.payment_method_id === 'bolbradesco' ? 'pending' : 'approved', status_detail: 'x', transaction_amount: body.transaction_amount,
      external_reference: body.external_reference, payment_method_id: body.payment_method_id, transaction_amount_refunded: 0, fee_details: [],
      point_of_interaction: { transaction_data: { qr_code: 'PIX', qr_code_base64: 'iVBOR' } },
      transaction_details: body.payment_method_id === 'bolbradesco' ? { external_resource_url: 'https://mp.test/boleto/' + id } : {}, barcode: body.payment_method_id === 'bolbradesco' ? { content: '23790000' } : undefined,
    };
    mp.set(id, p);
    return new Response(JSON.stringify(p), { status: 201 });
  }
  const refund = /\/v1\/payments\/(\d+)\/refunds$/.exec(u);
  if (refund && method === 'POST') {
    const p = mp.get(refund[1]!);
    const amount = body.amount ?? p.transaction_amount - p.transaction_amount_refunded;
    p.transaction_amount_refunded = Math.round((p.transaction_amount_refunded + amount) * 100) / 100;
    p.status = p.transaction_amount_refunded >= p.transaction_amount ? 'refunded' : 'approved';
    return new Response(JSON.stringify({ id: Number(String(Date.now()).slice(-8)), payment_id: p.id, amount, status: 'approved' }), { status: 201 });
  }
  const one = /\/v1\/payments\/(\d+)$/.exec(u);
  if (one && method === 'PUT') { const p = mp.get(one[1]!); p.status = 'cancelled'; return new Response(JSON.stringify(p), { status: 200 }); }
  if (one) { const p = mp.get(one[1]!); return new Response(JSON.stringify(p ?? { message: 'not found' }), { status: p ? 200 : 404 }); }
  if (u.includes('/v1/payment_methods/installments')) {
    return new Response(JSON.stringify([{ payer_costs: [1, 2, 3, 4, 5, 6, 10].map((n) => ({ installments: n, installment_rate: n <= 3 ? 0 : 2.5, installment_amount: 1, total_amount: 1 })) }]), { status: 200 });
  }
  return new Response('{}', { status: 404 });
});

const sign = (dataId: string, requestId = crypto.randomUUID()) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const v1 = crypto.createHmac('sha256', 'test-webhook-secret').update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
};
const hook = async (dataId: string) => (await client()).req('POST', `/api/webhooks/mercadopago?data.id=${dataId}&type=payment`, { type: 'payment', action: 'payment.updated', data: { id: dataId } }, sign(dataId));
const mpFor = (number: string) => [...mp.values()].find((p) => p.external_reference === number);
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const notifications = (orderId: number, event: string) => getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE order_id = ? AND event = ?', orderId, event)!.n;

async function paidOrder(c: Client, qty = 1, opts: { fee?: number } = {}) {
  const v = inStockVariant(qty);
  const { res } = await placeOrder(c, [{ variantId: v.id, quantity: qty }]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const pay = await c.req('POST', `/api/checkout/orders/${res.body.number}/pay`, { method: 'pix' });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  const p = mpFor(res.body.number);
  p.status = 'approved';
  p.fee_details = opts.fee === undefined ? [] : [{ type: 'mercadopago_fee', amount: opts.fee, fee_payer: 'collector' }];
  assert.equal((await hook(p.id)).status, 200);
  return { order: res.body, mpId: p.id as string, variantId: v.id };
}

// =====================================================================================

test('máquina de estados do pagamento: sem regressão de aprovado para pendente', () => {
  assert.equal(canTransition('approved', 'pending'), false);
  assert.equal(canTransition('refunded', 'approved'), false);
  assert.equal(canTransition('pending', 'in_process'), true);
  assert.equal(canTransition('in_process', 'approved'), true);
  assert.equal(canTransition('approved', 'partially_refunded'), true);
  assert.equal(canTransition('expired', 'approved'), true, 'aprovação tardia é registrada (e alertada)');
  assert.equal(validCpf('52998224725'), true);
  assert.equal(validCpf('11111111111'), false);
  assert.equal(validCpf('52998224724'), false);
});

test('evento fora de ordem (pendente depois de aprovado) é ignorado e o pedido continua pago', async () => {
  const c = await customer();
  const { order, mpId } = await paidOrder(c);
  mp.get(mpId).status = 'pending';
  assert.equal((await hook(mpId)).status, 200);
  const o = await c.req('GET', `/api/orders/${order.number}`);
  assert.equal(o.body.status, 'paid');
  assert.equal(o.body.payments[0].status, 'approved');
  assert.ok(o.body.events.some((e: any) => e.type === 'payment_out_of_order'));
});

test('em processamento → aprovado; notificação de pagamento aprovado é enviada uma única vez', async () => {
  const c = await customer();
  const v = inStockVariant(1);
  const { res } = await placeOrder(c, [{ variantId: v.id, quantity: 1 }]);
  await c.req('POST', `/api/checkout/orders/${res.body.number}/pay`, { method: 'pix' });
  const p = mpFor(res.body.number);
  p.status = 'in_process';
  await hook(p.id);
  assert.equal((await c.req('GET', `/api/orders/${res.body.number}`)).body.payments[0].status, 'in_process');
  p.status = 'approved';
  await hook(p.id);
  await hook(p.id); // repetida
  await wait();
  assert.equal((await c.req('GET', `/api/orders/${res.body.number}`)).body.status, 'paid');
  assert.equal(notifications(res.body.id, 'order.paid'), 1);
  const email = getDb().get<{ body_html: string; subject: string }>("SELECT e.body_html, e.subject FROM email_outbox e JOIN notifications n ON n.email_outbox_id = e.id WHERE n.order_id = ? AND n.event = 'order.paid'", res.body.id)!;
  assert.match(email.subject, /Pagamento aprovado/);
  assert.match(email.body_html, /GAZU/);
});

test('boleto: exige CPF válido e gera link do provedor; pedido fica reservado até o vencimento', async () => {
  const c = await customer();
  const v = inStockVariant(1);
  const { res } = await placeOrder(c, [{ variantId: v.id, quantity: 1 }]);
  const bad = await c.req('POST', `/api/checkout/orders/${res.body.number}/pay`, { method: 'boleto', boleto: { firstName: 'Ana', lastName: 'Silva', cpf: '123' } });
  assert.equal(bad.status, 400);
  const ok = await c.req('POST', `/api/checkout/orders/${res.body.number}/pay`, { method: 'boleto', boleto: { firstName: 'Ana', lastName: 'Silva', cpf: '529.982.247-25' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.payments[0].method, 'boleto');
  assert.ok(ok.body.payments[0].boletoUrl);
  assert.ok(Date.parse(ok.body.expiresAt) > Date.now() + 2 * 86400_000, 'reserva estendida até o vencimento do boleto');
  const sent = calls.filter((x) => x.body?.payment_method_id === 'bolbradesco').at(-1)!;
  assert.equal(sent.body.payer.identification.number, '52998224725');
  assert.ok(sent.idem, 'cobrança criada com chave de idempotência');
});

test('parcelamento informado pelo provedor respeita o limite configurado', async () => {
  const c = await client();
  const r = await c.req('GET', '/api/checkout/installments?amount=30000');
  assert.equal(r.status, 200);
  assert.equal(r.body.maxInstallments, 6);
  assert.equal(r.body.maxNoInterest, 3);
});

test('estorno total pelo provedor: só "reembolsado" após confirmação; estoque devolvido; permissões', async () => {
  const c = await customer();
  const { order, variantId } = await paidOrder(c, 1);
  const stockBefore = getDb().get<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', variantId)!.stock;
  const support = await admin('support');
  const denied = await support.req('POST', `/api/admin/orders/${order.number}/refunds`, { reason: 'teste' });
  assert.equal(denied.status, 403);
  assert.ok(getDb().get("SELECT 1 FROM audit_log WHERE action = 'permission.denied' AND result = 'denied' AND actor = ?", `admin:${support.id}`), 'tentativa negada auditada');
  const fin = await admin('finance');
  const r = await fin.req('POST', `/api/admin/orders/${order.number}/refunds`, { reason: 'Cliente desistiu antes do envio' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'refunded');
  assert.equal(r.body.refunds[0].status, 'approved');
  assert.equal(getDb().get<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', variantId)!.stock, stockBefore + 1);
  const refundCall = calls.filter((x) => x.url.endsWith('/refunds')).at(-1)!;
  assert.ok(refundCall.idem, 'estorno enviado com X-Idempotency-Key');
  await wait();
  assert.equal(notifications(order.id, 'refund.confirmed'), 1);
  const again = await fin.req('POST', `/api/admin/orders/${order.number}/refunds`, { reason: 'de novo' });
  assert.equal(again.status, 409, 'não há saldo a estornar');
  assert.ok(getDb().get("SELECT 1 FROM audit_log WHERE action = 'refund.request' AND entity_id = ?", String(order.id)));
});

test('estorno parcial mantém o pedido pago e registra o valor estornado', async () => {
  const c = await customer();
  const { order } = await paidOrder(c, 2);
  const a = await admin();
  const r = await a.req('POST', `/api/admin/orders/${order.number}/refunds`, { amountCents: 1000, reason: 'Ajuste' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'paid');
  assert.equal(r.body.payments[0].status, 'partially_refunded');
  assert.equal(r.body.payments[0].refundedCents, 1000);
  const tooMuch = await a.req('POST', `/api/admin/orders/${order.number}/refunds`, { amountCents: order.totalCents, reason: 'excesso' });
  assert.equal(tooMuch.status, 400);
});

test('webhook com provedor indisponível fica "erro" e é reprocessado pela reconciliação', async () => {
  const c = await customer();
  const v = inStockVariant(1);
  const { res } = await placeOrder(c, [{ variantId: v.id, quantity: 1 }]);
  await c.req('POST', `/api/checkout/orders/${res.body.number}/pay`, { method: 'pix' });
  const p = mpFor(res.body.number);
  p.status = 'approved';
  mpDown = true;
  const r = await hook(p.id);
  mpDown = false;
  assert.equal(r.status, 502, 'provedor indisponível: 5xx para o Mercado Pago reenviar');
  assert.equal(getDb().get<{ result: string }>('SELECT result FROM payment_events WHERE provider_payment_id = ? ORDER BY id DESC', p.id)!.result, 'error');
  assert.equal((await c.req('GET', `/api/orders/${res.body.number}`)).body.status, 'pending_payment');
  const out = await reconcilePayments();
  assert.ok(out.reprocessed >= 1 || out.synced >= 1);
  assert.equal((await c.req('GET', `/api/orders/${res.body.number}`)).body.status, 'paid');
});

test('compra sem cadastro: acesso só com o token do pedido; rastreio público sem dados pessoais', async () => {
  const guest = await client();
  const v = inStockVariant(1);
  const items = [{ variantId: v.id, quantity: 1 }];
  const q = await guest.req('POST', '/api/cart/quote', { items, cep: ADDRESS.cep });
  const ship = q.body.shippingOptions[0].id;
  const q2 = await guest.req('POST', '/api/cart/quote', { items, cep: ADDRESS.cep, shippingOptionId: ship });
  const email = `visitante${Date.now()}@teste.dev`;
  const body = { items, shippingOptionId: ship, expectedTotalCents: q2.body.totalCents, address: ADDRESS, guest: { name: 'Visitante Teste', email, acceptTerms: true } };
  const o = await guest.req('POST', '/api/checkout/guest-orders', body);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.equal(o.body.guest, true);
  const number = o.body.number;
  assert.equal((await guest.req('GET', `/api/orders/${number}`)).status, 200, 'mesmo navegador (cookie HttpOnly) acessa');
  assert.equal((await guest.req('POST', `/api/checkout/orders/${number}/pay`, { method: 'pix' })).status, 200);
  const stranger = await client();
  assert.equal((await stranger.req('GET', `/api/orders/${number}`)).status, 401);
  const other = await customer();
  assert.equal((await other.req('GET', `/api/orders/${number}`)).status, 404);
  // Link do e-mail (token) libera o acesso em outro dispositivo.
  const mail = getDb().get<{ body_text: string }>("SELECT body_text FROM email_outbox WHERE to_email = ? AND event = 'order.created'", email)!;
  const token = /acesso=([A-Za-z0-9_-]+)/.exec(mail.body_text)![1]!;
  assert.equal((await stranger.req('POST', '/api/orders/guest-access', { number, token: 'x'.repeat(20) })).status, 404);
  assert.equal((await stranger.req('POST', '/api/orders/guest-access', { number, token })).status, 200);
  assert.equal((await stranger.req('GET', `/api/orders/${number}`)).status, 200);
  // Rastreio público.
  assert.equal((await (await client()).req('POST', '/api/orders/track', { number, email: 'errado@teste.dev' })).status, 404);
  const tr = await (await client()).req('POST', '/api/orders/track', { number, email });
  assert.equal(tr.status, 200);
  assert.equal(tr.body.destination, 'São Paulo/SP');
  assert.equal(JSON.stringify(tr.body).includes('Paulista'), false, 'rastreio público não expõe o endereço');
  // Conta existente exige login; cadastro com e-mail de visitante exige ativação pelo e-mail.
  const exists = await guest.req('POST', '/api/checkout/guest-orders', { ...body, guest: { ...body.guest, email: other.email } });
  assert.equal(exists.status, 409);
  assert.equal(exists.body.error.code, 'account_exists');
  const reg = await client();
  const rr = await reg.req('POST', '/api/auth/register', { name: 'Visitante', email, password: 'senhaSegura123', acceptTerms: true });
  assert.equal(rr.status, 200);
  assert.equal(rr.body.pendingActivation, true);
  assert.equal((await reg.req('GET', '/api/auth/me')).body.user, null, 'não entra na conta sem provar posse do e-mail');
});

test('envios: "enviado" exige rastreio, avança o pedido e notifica uma vez; observação interna não vaza', async () => {
  const c = await customer();
  const { order } = await paidOrder(c);
  const a = await admin('support');
  const add = await a.req('POST', `/api/admin/orders/${order.number}/shipments`, { carrier: 'Correios', service: 'PAC', costCents: 2190 });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const sid = add.body.shipments.at(-1).id;
  assert.equal((await a.req('PATCH', `/api/admin/shipments/${sid}`, { status: 'shipped' })).status, 400);
  const s = await a.req('PATCH', `/api/admin/shipments/${sid}`, { status: 'shipped', trackingCode: 'AA123456789BR' });
  assert.equal(s.status, 200);
  assert.equal(s.body.status, 'shipped');
  await a.req('PATCH', `/api/admin/shipments/${sid}`, { status: 'delivered' });
  await wait();
  assert.equal(notifications(order.id, 'shipment.shipped'), 1);
  assert.equal(notifications(order.id, 'shipment.delivered'), 1);
  await a.req('POST', `/api/admin/orders/${order.number}/notes`, { body: 'Cliente pediu embrulho — SEGREDO-INTERNO' });
  const mine = await c.req('GET', `/api/orders/${order.number}`);
  assert.equal(mine.body.status, 'delivered');
  assert.equal(JSON.stringify(mine.body).includes('SEGREDO-INTERNO'), false);
  assert.equal(mine.body.shipments[0].costCents, undefined, 'custo do frete não aparece para o cliente');
  const adm = await a.req('GET', `/api/admin/orders/${order.number}`);
  assert.ok(adm.body.notes.some((n: any) => n.body.includes('SEGREDO-INTERNO')));
});

test('trocas e devoluções: prazos legais, quantidade, recebimento com reposição e estorno vinculado', async () => {
  const c = await customer();
  const { order, variantId } = await paidOrder(c, 2);
  const early = await c.req('POST', `/api/orders/${order.number}/returns`, { type: 'withdrawal', reason: 'Não serviu como esperado', items: [{ orderItemId: order.items[0].id, quantity: 1 }] });
  assert.equal(early.status, 409, 'só após a entrega');
  const a = await admin();
  await a.req('PATCH', `/api/admin/orders/${order.number}`, { status: 'processing' });
  await a.req('PATCH', `/api/admin/orders/${order.number}`, { status: 'shipped', trackingCode: 'BR1' });
  await a.req('PATCH', `/api/admin/orders/${order.number}`, { status: 'delivered' });
  const elig = await c.req('GET', `/api/orders/${order.number}/returns`);
  assert.equal(elig.body.eligibility.options.find((o: any) => o.type === 'withdrawal').allowed, true);
  const tooMany = await c.req('POST', `/api/orders/${order.number}/returns`, { type: 'withdrawal', reason: 'Não serviu como esperado', items: [{ orderItemId: order.items[0].id, quantity: 3 }] });
  assert.equal(tooMany.status, 409);
  const ret = await c.req('POST', `/api/orders/${order.number}/returns`, { type: 'withdrawal', reason: 'Não serviu como esperado', items: [{ orderItemId: order.items[0].id, quantity: 1 }] });
  assert.equal(ret.status, 200, JSON.stringify(ret.body));
  const id = ret.body.id;
  assert.equal((await a.req('PATCH', `/api/admin/returns/${id}`, { status: 'refunded' })).status, 400, '"reembolsada" não é definida manualmente');
  await a.req('PATCH', `/api/admin/returns/${id}`, { status: 'approved', message: 'Aprovada. Envie o produto.' });
  await a.req('PATCH', `/api/admin/returns/${id}`, { message: 'nota só da equipe', internal: true });
  const stock = getDb().get<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', variantId)!.stock;
  await a.req('PATCH', `/api/admin/returns/${id}`, { status: 'received', restock: true });
  assert.equal(getDb().get<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', variantId)!.stock, stock + 1);
  const unit = order.items[0].unitPriceCents;
  const ref = await a.req('POST', `/api/admin/returns/${id}/refund`, { amountCents: unit, reason: 'Devolução recebida' });
  assert.equal(ref.status, 200, JSON.stringify(ref.body));
  await wait(120);
  const mine = await c.req('GET', `/api/orders/${order.number}/returns`);
  const r0 = mine.body.returns[0];
  assert.equal(r0.status, 'refunded');
  assert.equal(r0.events.some((e: any) => e.message === 'nota só da equipe'), false, 'nota interna não aparece ao cliente');
  // Fora do prazo de desistência (entrega há 8 dias).
  getDb().run('UPDATE shipments SET delivered_at = ? WHERE order_id = ?', new Date(Date.now() - 8 * 86400_000).toISOString(), order.id);
  const late = await c.req('GET', `/api/orders/${order.number}/returns`);
  assert.equal(late.body.eligibility.options.find((o: any) => o.type === 'withdrawal').allowed, false);
  assert.equal(late.body.eligibility.options.find((o: any) => o.type === 'defect').allowed, true);
});

test('Melhor Envio (simulado): compra de etiqueta segue carrinho → checkout → gerar → imprimir; status mapeados', async () => {
  const seen: string[] = [];
  setMelhorEnvioFetch(async (url, init) => {
    const u = String(url);
    seen.push(`${init?.method} ${u.replace(/^https:\/\/[^/]+/, '')}`);
    assert.match(String((init?.headers as Record<string, string>)['User-Agent']), /GAZU/);
    if (u.endsWith('/me/cart')) return new Response(JSON.stringify({ id: 'me-ord-1' }), { status: 201 });
    if (u.endsWith('/shipment/print')) return new Response(JSON.stringify({ url: 'https://me.test/label.pdf' }), { status: 200 });
    if (u.endsWith('/shipment/tracking')) return new Response(JSON.stringify({ 'me-ord-1': { id: 'me-ord-1', status: 'generated', tracking: 'ME123BR' } }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  const party = { name: 'X', address: 'Rua', number: '1', district: 'B', city: 'C', state_abbr: 'SP', country_id: 'BR' as const, postal_code: '01001000' };
  const out = await purchaseLabel({ serviceId: 1, from: party, to: party, products: [{ name: 'P', quantity: 1, unitary_value: 10 }], volume: { height: 10, width: 20, length: 30, weight: 0.5 }, insuranceValue: 10, orderNumber: 'GZ1' });
  assert.deepEqual(out, { meOrderId: 'me-ord-1', labelUrl: 'https://me.test/label.pdf', tracking: 'ME123BR' });
  assert.deepEqual(seen.slice(0, 4).map((s) => s.split(' ')[1]), ['/api/v2/me/cart', '/api/v2/me/shipment/checkout', '/api/v2/me/shipment/generate', '/api/v2/me/shipment/print']);
  assert.equal(seen[0]!.startsWith('POST https') || seen[0]!.startsWith('POST /'), true);
  assert.equal(mapMeStatus('posted'), 'shipped');
  assert.equal(mapMeStatus('delivered'), 'delivered');
  assert.equal(mapMeStatus('canceled'), 'cancelled');
  assert.equal(mapMeStatus('desconhecido'), null);
  setMelhorEnvioFetch(null);
});
