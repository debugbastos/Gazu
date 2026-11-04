import './_setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../../src/server/db.ts';
import { categorySales, financeCsv, financeSummary, financialMovements, parsePeriod } from '../../src/server/services/finance.ts';
import { scrubText } from '../../src/server/services/analytics.ts';
import { runBackup, verifyBackup, verifyBackupFile, backupDir } from '../../src/server/services/backup.ts';
import { setWhatsAppFetch } from '../../src/server/services/support.ts';
import { redact } from '../../src/server/services/audit.ts';
import { permissionsFor } from '../../src/server/auth/permissions.ts';
import { admin, boot, client, customer, inStockVariant } from './_harness.ts';

const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Financeiro: fórmulas verificadas com dados controlados (ver docs/FORMULAS-FINANCEIRAS.md)
// ---------------------------------------------------------------------------------------------
function fixtureOrder(o: { userId: string; subtotal: number; discount: number; shipping: number; packaging: number | null; demo?: boolean; payStatus?: string; approvedAt?: string | null; fee?: number | null; provider?: string; itemCost?: number | null; qty?: number; shipCost?: number | null }) {
  const db = getDb();
  const total = o.subtotal - o.discount + o.shipping;
  const n = `FX${crypto.randomBytes(4).toString('hex')}`;
  const id = db.run(
    `INSERT INTO orders (number, user_id, status, subtotal_cents, discount_cents, shipping_cents, total_cents, shipping_option_id, shipping_label, ship_recipient, ship_cep, ship_street, ship_number, ship_district, ship_city, ship_state, is_demo, packaging_cost_cents, paid_at)
     VALUES (?, ?, 'paid', ?, ?, ?, ?, 'manual:1', 'Entrega', 'X', '01001000', 'Rua', '1', 'B', 'São Paulo', 'SP', ?, ?, ?)`,
    n, o.userId, o.subtotal, o.discount, o.shipping, total, o.demo ? 1 : 0, o.packaging, o.approvedAt ?? null,
  ).lastInsertRowid;
  const qty = o.qty ?? 1;
  db.run('INSERT INTO order_items (order_id, sku, product_name, product_slug, color_name, size, unit_price_cents, quantity, line_total_cents, unit_cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, 'SKU', 'Produto', 'produto', 'Preto', 'M', o.subtotal / qty, qty, o.subtotal, o.itemCost === undefined ? 4000 : o.itemCost);
  const payId = db.run("INSERT INTO payments (order_id, provider, method, status, amount_cents, fee_cents, idempotency_key, approved_at) VALUES (?, ?, 'pix', ?, ?, ?, ?, ?)",
    id, o.provider ?? 'mercadopago', o.payStatus ?? 'approved', total, o.fee === undefined ? 100 : o.fee, crypto.randomUUID(), o.approvedAt === undefined ? new Date().toISOString() : o.approvedAt).lastInsertRowid;
  if (o.shipCost !== undefined) db.run("INSERT INTO shipments (order_id, status, cost_cents) VALUES (?, 'shipped', ?)", id, o.shipCost);
  return { id, payId, total };
}

test('financeiro: receita, descontos, estornos, taxas, custos, despesas, lucro e ticket médio', async () => {
  await boot();
  const db = getDb();
  const uid = crypto.randomUUID();
  db.run('INSERT INTO users (id, email) VALUES (?, ?)', uid, `fin${Date.now()}@teste.dev`);
  const a = fixtureOrder({ userId: uid, subtotal: 20000, discount: 2000, shipping: 1500, packaging: 300, fee: 99, qty: 2, itemCost: 4000, shipCost: 1800 });   // total 19500
  const b = fixtureOrder({ userId: uid, subtotal: 10000, discount: 0, shipping: 0, packaging: 300, fee: 50, itemCost: 3500, shipCost: 0 });                 // total 10000
  fixtureOrder({ userId: uid, subtotal: 99999, discount: 0, shipping: 0, packaging: 300, demo: true, shipCost: 0 });                                        // demonstração: excluído
  fixtureOrder({ userId: uid, subtotal: 50000, discount: 0, shipping: 0, packaging: 300, payStatus: 'pending', approvedAt: null, shipCost: 0 });          // não pago: excluído
  fixtureOrder({ userId: uid, subtotal: 30000, discount: 0, shipping: 0, packaging: 300, approvedAt: '2020-01-10T12:00:00.000Z', shipCost: 0 });           // fora do período
  fixtureOrder({ userId: uid, subtotal: 77777, discount: 0, shipping: 0, packaging: 300, provider: 'demo', shipCost: 0 });                                  // provedor simulado: excluído
  db.run("INSERT INTO refunds (payment_id, order_id, amount_cents, status, reason, idempotency_key, requested_by, confirmed_at) VALUES (?, ?, 2500, 'approved', 'teste', ?, 'admin:x', ?)", b.payId, b.id, crypto.randomUUID(), new Date().toISOString());
  db.run("INSERT INTO refunds (payment_id, order_id, amount_cents, status, reason, idempotency_key, requested_by) VALUES (?, ?, 999, 'requested', 'pendente', ?, 'admin:x')", b.payId, b.id, crypto.randomUUID());
  db.run("INSERT INTO expenses (category, description, amount_cents, incurred_on) VALUES ('marketing', 'Anúncio', 3000, ?)", today);
  db.run("INSERT INTO expenses (category, description, amount_cents, incurred_on, deleted_at) VALUES ('outros', 'Excluída', 99999, ?, ?)", today, new Date().toISOString());

  const s = financeSummary(today, today);
  assert.equal(s.orders.paidCount, 2);
  assert.equal(s.grossSalesCents, 30000);
  assert.equal(s.discountsCents, 2000);
  assert.equal(s.shippingChargedCents, 1500);
  assert.equal(s.paidRevenueCents, 29500);
  assert.equal(s.refundsCents, 2500, 'somente estornos confirmados');
  assert.equal(s.netRevenueCents, 27000);
  assert.equal(s.providerFeesCents, 149);
  assert.equal(s.productCostCents, 4000 * 2 + 3500);
  assert.equal(s.shippingCostCents, 1800);
  assert.equal(s.packagingCostCents, 600);
  assert.equal(s.expensesCents, 3000);
  assert.equal(s.estimatedProfitCents, 27000 - 149 - 11500 - 1800 - 600 - 3000);
  assert.equal(s.averageTicketCents, 14750);
  assert.equal(s.marginPercent, Math.round(((27000 - 149 - 11500 - 1800 - 600 - 3000) / 27000) * 1000) / 10);
  assert.deepEqual(s.missing, []);

  // Custo ausente: o lucro não é estimado e o motivo aparece.
  fixtureOrder({ userId: uid, subtotal: 5000, discount: 0, shipping: 0, packaging: 300, itemCost: null, shipCost: 500 });
  const s2 = financeSummary(today, today);
  assert.equal(s2.productCostCents, null);
  assert.equal(s2.estimatedProfitCents, null);
  assert.ok(s2.missing.some((m) => m.includes('Custo do produto')));
  // Taxa ausente idem.
  fixtureOrder({ userId: uid, subtotal: 5000, discount: 0, shipping: 0, packaging: 300, fee: null, shipCost: 500 });
  assert.equal(financeSummary(today, today).providerFeesCents, null);

  // Movimentações: entradas e saídas batem com o resumo (pagamentos − taxas conhecidas − estornos − despesas).
  const mov = financialMovements(today, today);
  const s3 = financeSummary(today, today);
  const sumKind = (k: string) => mov.filter((m) => m.kind === k).reduce((n, m) => n + m.amountCents, 0);
  assert.equal(sumKind('payment'), s3.paidRevenueCents);
  assert.equal(-sumKind('refund'), s3.refundsCents);
  assert.equal(-sumKind('expense'), s3.expensesCents);
  assert.ok(mov.every((m, i) => i === 0 || mov[i - 1]!.at <= m.at), 'ordem cronológica');
  assert.ok(!mov.some((m) => m.amountCents === 99999 * -1), 'despesa excluída não aparece');
  // Vendas por categoria somam a receita de itens dos pedidos pagos no período.
  const cats = categorySales(today, today);
  const itemsRevenue = getDb().get<{ n: number }>(`SELECT COALESCE(SUM(i.line_total_cents), 0) AS n FROM order_items i JOIN orders o ON o.id = i.order_id JOIN payments p ON p.order_id = o.id
     WHERE p.status IN ('approved','partially_refunded','refunded') AND p.approved_at >= ? AND o.is_demo = 0 AND p.provider <> 'demo'`, parsePeriod(today, today).fromIso)!.n;
  assert.equal(cats.reduce((n, c) => n + c.revenueCents, 0), itemsRevenue);

  const csv = financeCsv(today, today);
  assert.ok(csv.startsWith('﻿pedido;aprovado_em'));
  assert.equal(csv.trim().split('\r\n').length, 1 + 4, 'cabeçalho + 4 pagamentos reais do período');
  assert.throws(() => parsePeriod('2026-02-10', '2026-01-01'));
});

test('financeiro: rota exige permissão; CSV neutraliza fórmulas', async () => {
  const sup = await admin('support');
  assert.equal((await sup.req('GET', '/api/admin/finance/summary')).status, 403);
  const fin = await admin('finance');
  const r = await fin.req('GET', `/api/admin/finance/summary?de=${today}&ate=${today}`);
  assert.equal(r.status, 200);
  const csv = await fin.req('GET', `/api/admin/finance/export.csv?de=${today}&ate=${today}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
  const db = getDb();
  db.run("UPDATE orders SET utm_campaign = '=HYPERLINK(1)' WHERE id = (SELECT order_id FROM payments WHERE status = 'approved' AND provider = 'mercadopago' ORDER BY id LIMIT 1)");
  assert.ok(financeCsv(today, today).includes("'=HYPERLINK(1)"));
});

// ---------------------------------------------------------------------------------------------
test('analytics: nada é gravado sem consentimento; revogação apaga; compra não vem do navegador', async () => {
  const c = await client();
  const sid = crypto.randomBytes(16).toString('base64url');
  const ev = { sessionId: sid, events: [{ event: 'page_view', path: '/produto/x?email=a@b.com' }, { event: 'purchase', valueCents: 99999 }, { event: 'search', searchTerm: 'camiseta joao@x.com 11987654321', resultsCount: 0 }] };
  assert.equal((await c.req('POST', '/api/analytics/events', ev)).body.accepted, 0);
  await c.req('POST', '/api/consent', { sessionId: sid, analytics: true });
  const r = await c.req('POST', '/api/analytics/events', ev);
  assert.equal(r.body.accepted, 2, '"purchase" não é aceito do navegador');
  const rows = getDb().all<{ event: string; path: string | null; search_term: string | null }>('SELECT event, path, search_term FROM analytics_events WHERE session_id = ?', sid);
  assert.equal(rows.find((x) => x.event === 'page_view')!.path, '/produto/x', 'query string removida');
  assert.equal(rows.find((x) => x.event === 'search')!.search_term, 'camiseta [email] [número]');
  await c.req('POST', '/api/consent', { sessionId: sid, analytics: false });
  assert.equal(getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM analytics_events WHERE session_id = ?', sid)!.n, 0);
  assert.equal(scrubText('cartão 4111 1111 1111 1111'), 'cartão [número]');
  // Busca sem resultado (registro agregado do servidor).
  await c.req('GET', '/api/catalog?q=zzzxxyyqq');
  assert.ok(getDb().get("SELECT 1 FROM analytics_events WHERE event = 'search_zero' AND search_term = 'zzzxxyyqq' AND user_id IS NULL"));
  const mk = await admin('marketing');
  const rep = await mk.req('GET', '/api/admin/analytics');
  assert.equal(rep.status, 200);
  assert.ok(rep.body.zeroResultSearches.some((z: any) => z.term === 'zzzxxyyqq'));
  assert.match(rep.body.purchases.note, /provedor/);
});

// ---------------------------------------------------------------------------------------------
test('auditoria: alterações críticas registradas; segredos omitidos', async () => {
  const a = await admin();
  const v = inStockVariant(1);
  const r = await a.req('POST', `/api/admin/variants/${v.id}/stock`, { delta: 2, reason: 'restock', note: 'reposição' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const log = await a.req('GET', '/api/admin/audit?q=stock.adjust');
  assert.ok(log.body.entries.some((e: any) => e.action === 'stock.adjust' && e.entityId === String(v.id)));
  assert.deepEqual(redact({ password: 'x', nested: { cardNumber: '4111', ok: 1 }, accessToken: 'abc' }), { password: '[omitido]', nested: { cardNumber: '[omitido]', ok: 1 }, accessToken: '[omitido]' });
  const cat = await admin('catalog');
  assert.equal((await cat.req('GET', '/api/admin/audit')).status, 403);
});

test('papéis e permissões: matriz e gestão de equipe pelo proprietário', async () => {
  assert.ok(permissionsFor('owner').includes('team.manage'));
  assert.ok(!permissionsFor('manager').includes('team.manage'));
  assert.ok(!permissionsFor('support').includes('finance.read'));
  assert.ok(!permissionsFor('marketing').includes('payments.refund'));
  assert.ok(permissionsFor('finance').includes('payments.refund'));
  const owner = await admin('owner');
  const person = await customer();
  assert.equal((await owner.req('POST', '/api/admin/team', { email: 'ninguem@teste.dev', role: 'support' })).status, 404);
  assert.equal((await owner.req('POST', '/api/admin/team', { email: person.email, role: 'support' })).status, 200);
  assert.equal((await person.req('GET', '/api/auth/me')).body.user, null, 'sessão renovada após mudança de papel');
  await person.req('POST', '/api/auth/login', { email: person.email, password: 'senhaSegura123' });
  const me = (await person.req('GET', '/api/auth/me')).body.user;
  assert.equal(me.staffRole, 'support');
  assert.equal((await person.req('GET', '/api/admin/support/tickets')).status, 200);
  assert.equal((await person.req('GET', '/api/admin/finance/summary')).status, 403);
  assert.equal((await person.req('GET', '/api/admin/team')).status, 403);
  assert.equal((await owner.req('PATCH', `/api/admin/team/${owner.id}`, { role: 'support' })).status, 409, 'não altera o próprio papel');
  const manager = await admin('manager');
  assert.equal((await manager.req('POST', '/api/admin/team', { email: person.email, role: 'owner' })).status, 403, 'gerente não gerencia a equipe');
});

// ---------------------------------------------------------------------------------------------
test('atendimento: chamado sem login por token; observação interna nunca chega ao cliente', async () => {
  const visitor = await client();
  const r = await visitor.req('POST', '/api/support/tickets', { name: 'Maria Teste', email: 'maria@teste.dev', category: 'produto', subject: 'Dúvida de tamanho', message: 'A camiseta veste grande?', acceptPrivacy: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { number, token } = r.body;
  assert.equal((await visitor.req('GET', `/api/support/tickets/${number}`)).status, 404, 'sem token: não encontrado');
  assert.equal((await visitor.req('GET', `/api/support/tickets/${number}?acesso=${token}`)).status, 200);
  const sup = await admin('support');
  const list = await sup.req('GET', '/api/admin/support/tickets?status=active');
  const t = list.body.tickets.find((x: any) => x.number === number);
  await sup.req('POST', `/api/admin/support/tickets/${t.id}/messages`, { body: 'NOTA-INTERNA: cliente recorrente', internal: true });
  const rep = await sup.req('POST', `/api/admin/support/tickets/${t.id}/messages`, { body: 'Ela tem modelagem ampla; recomendamos seu tamanho usual.', internal: false });
  assert.equal(rep.status, 200);
  await wait();
  const view = await visitor.req('GET', `/api/support/tickets/${number}?acesso=${token}`);
  assert.equal(JSON.stringify(view.body).includes('NOTA-INTERNA'), false);
  assert.equal(view.body.status, 'waiting_customer');
  assert.ok(view.body.messages.some((m: any) => m.authorType === 'staff' && m.authorName === 'Equipe GAZU'));
  const emails = getDb().all<{ body_text: string }>("SELECT body_text FROM email_outbox WHERE to_email = 'maria@teste.dev'");
  assert.ok(emails.length >= 2, 'confirmação + resposta');
  assert.equal(emails.some((e) => e.body_text.includes('NOTA-INTERNA')), false);
  const reply = await visitor.req('POST', `/api/support/tickets/${number}/messages`, { body: 'Obrigada!', token });
  assert.equal(reply.body.status, 'open');
  const mk = await admin('marketing');
  assert.equal((await mk.req('GET', `/api/admin/support/tickets/${t.id}`)).status, 403);
});

test('WhatsApp Cloud API: verificação, assinatura, idempotência e resposta dentro da janela de 24h', async () => {
  const c = await client();
  const ok = await c.req('GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345');
  assert.equal(ok.status, 200);
  assert.equal(ok.body, 12345);
  assert.equal((await c.req('GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1')).status, 403);
  const payload = { entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: '5511999990000', profile: { name: 'João' } }], messages: [{ from: '5511999990000', id: 'wamid.TESTE1', type: 'text', text: { body: 'Meu pedido chega quando?' } }] } }] }] };
  const raw = JSON.stringify(payload);
  const sig = 'sha256=' + crypto.createHmac('sha256', 'test-app-secret').update(raw).digest('hex');
  const post = (signature: string) => fetch(c.base + '/api/webhooks/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body: raw });
  assert.equal((await post('sha256=' + '0'.repeat(64))).status, 401);
  const first = (await (await post(sig)).json()) as { received: number };
  assert.equal(first.received, 1);
  const dup = (await (await post(sig)).json()) as { duplicates: number };
  assert.equal(dup.duplicates, 1);
  const t = getDb().get<{ id: number; channel: string }>("SELECT id, channel FROM support_tickets WHERE whatsapp_wa_id = '5511999990000'")!;
  assert.equal(t.channel, 'whatsapp');
  const sent: any[] = [];
  setWhatsAppFetch(async (url, init) => { sent.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT1' }] }), { status: 200 }); });
  const sup = await admin('support');
  const r = await sup.req('POST', `/api/admin/support/tickets/${t.id}/messages`, { body: 'Olá João! Seu pedido está em preparação.' });
  assert.equal(r.body.delivery, 'whatsapp');
  assert.match(sent[0].url, /graph\.facebook\.com\/v21\.0\/1234567890\/messages$/);
  assert.equal(sent[0].body.to, '5511999990000');
  getDb().run('UPDATE support_tickets SET last_customer_message_at = ? WHERE id = ?', new Date(Date.now() - 25 * 3600_000).toISOString(), t.id);
  const late = await sup.req('POST', `/api/admin/support/tickets/${t.id}/messages`, { body: 'Mensagem fora da janela' });
  assert.equal(late.body.delivery, 'whatsapp_window_closed', 'fora de 24h exige modelo aprovado (não envia texto livre)');
  setWhatsAppFetch(null);
});

// ---------------------------------------------------------------------------------------------
test('newsletter: confirmação dupla, descadastro e consentimento registrado', async () => {
  const c = await client();
  const email = `news${Date.now()}@teste.dev`;
  assert.equal((await c.req('POST', '/api/newsletter', { email })).status, 400, 'exige autorização explícita');
  const r = await c.req('POST', '/api/newsletter', { email, consent: true });
  assert.equal(r.body.status, 'pending');
  const mail = getDb().get<{ body_text: string }>("SELECT body_text FROM email_outbox WHERE to_email = ? AND event = 'newsletter.confirm'", email)!;
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.body_text)![1]!;
  const sair = /sair=([A-Za-z0-9_-]+)/.exec(mail.body_text)![1]!;
  assert.equal((await c.req('POST', '/api/newsletter/confirm', { token })).status, 200);
  assert.equal(getDb().get<{ status: string }>('SELECT status FROM newsletter_subscribers WHERE email = ?', email)!.status, 'confirmed');
  assert.equal((await c.req('POST', '/api/newsletter/confirm', { token })).status, 400, 'link de uso único');
  await c.req('POST', '/api/newsletter/unsubscribe', { token: sair });
  assert.equal(getDb().get<{ status: string }>('SELECT status FROM newsletter_subscribers WHERE email = ?', email)!.status, 'unsubscribed');
  assert.ok(getDb().get("SELECT 1 FROM consents WHERE subject = ? AND purpose = 'newsletter' AND granted = 0", `email:${email}`));
});

test('lista de espera: aviso único quando o tamanho volta ao estoque', async () => {
  await boot();
  const v = getDb().get<{ id: number }>('SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.stock = 0 AND p.is_active = 1 AND v.is_active = 1 LIMIT 1')!;
  const c = await client();
  const email = `espera${Date.now()}@teste.dev`;
  assert.equal((await c.req('POST', '/api/stock-alerts', { variantId: v.id, email })).status, 200);
  assert.equal((await c.req('POST', '/api/stock-alerts', { variantId: v.id, email })).body.already, true);
  const a = await admin();
  await a.req('POST', `/api/admin/variants/${v.id}/stock`, { delta: 3, reason: 'restock' });
  await wait(150);
  assert.ok(getDb().get<{ notified_at: string | null }>('SELECT notified_at FROM stock_alerts WHERE variant_id = ? AND email = ?', v.id, email)!.notified_at);
  await a.req('POST', `/api/admin/variants/${v.id}/stock`, { delta: 1, reason: 'restock' });
  await wait(100);
  assert.equal(getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE recipient = ? AND event = 'stock.restored'", email)!.n, 1);
  const inStock = inStockVariant(1);
  assert.equal((await c.req('POST', '/api/stock-alerts', { variantId: inStock.id, email })).status, 409);
});

test('avaliações verificadas: só após entrega, com moderação; nenhuma avaliação automática', async () => {
  const c = await customer();
  const v = inStockVariant(1);
  assert.equal(getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM reviews')!.n, 0, 'o sistema não cria avaliações');
  const before = await c.req('GET', `/api/products/${v.productId}/reviews`);
  assert.equal(before.body.eligibility.eligible, false);
  assert.equal((await c.req('POST', `/api/products/${v.productId}/reviews`, { rating: 5, body: 'Excelente peça, recomendo.' })).status, 403);
  const uid = (await c.req('GET', '/api/auth/me')).body.user.id;
  const oid = getDb().run("INSERT INTO orders (number, user_id, status, subtotal_cents, discount_cents, shipping_cents, total_cents, shipping_option_id, shipping_label, ship_recipient, ship_cep, ship_street, ship_number, ship_district, ship_city, ship_state, is_demo) VALUES (?, ?, 'delivered', 100, 0, 0, 100, 'x', 'x', 'x', '01001000', 'x', '1', 'x', 'x', 'SP', 0)", `RV${Date.now()}`, uid).lastInsertRowid;
  getDb().run("INSERT INTO order_items (order_id, product_id, sku, product_name, product_slug, color_name, size, unit_price_cents, quantity, line_total_cents) VALUES (?, ?, 'S', 'P', 'p', 'c', 'M', 100, 1, 100)", oid, v.productId);
  const r = await c.req('POST', `/api/products/${v.productId}/reviews`, { rating: 4, title: 'Bom', body: 'Tecido confortável e bom caimento.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'pending');
  assert.equal((await (await client()).req('GET', `/api/products/${v.productId}/reviews`)).body.reviews.length, 0, 'pendente não aparece');
  const a = await admin('catalog');
  const rid = getDb().get<{ id: number }>('SELECT id FROM reviews WHERE product_id = ?', v.productId)!.id;
  assert.equal((await a.req('POST', `/api/admin/reviews/${rid}/moderate`, { action: 'approved' })).status, 200);
  const pub = await (await client()).req('GET', `/api/products/${v.productId}/reviews`);
  assert.equal(pub.body.reviews.length, 1);
  assert.equal(pub.body.reviews[0].verified, true);
  assert.equal(pub.body.summary.count, 1);
  assert.equal(JSON.stringify(pub.body).includes(c.email), false, 'e-mail do autor não é exibido');
  assert.equal((await c.req('POST', `/api/products/${v.productId}/reviews`, { rating: 1, body: 'Segunda avaliação repetida.' })).status, 403);
});

test('LGPD: exportação dos dados e anonimização (pedidos mantidos sem vínculo de contato)', async () => {
  const c = await customer();
  const exp = await c.req('GET', '/api/account/privacy/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.body.account.email, c.email);
  assert.match(exp.headers.get('content-disposition') ?? '', /attachment/);
  const req = await c.req('POST', '/api/account/privacy/requests', { type: 'deletion' });
  assert.equal(req.status, 200);
  const uid = (await c.req('GET', '/api/auth/me')).body.user.id;
  const a = await admin();
  assert.equal((await a.req('POST', `/api/admin/privacy/users/${uid}/anonymize`, { confirm: 'sim' })).status, 400, 'exige confirmação explícita');
  assert.equal((await a.req('POST', `/api/admin/privacy/users/${uid}/anonymize`, { confirm: 'ANONIMIZAR' })).status, 200);
  const u = getDb().get<{ email: string; password_hash: string | null; anonymized_at: string | null }>('SELECT email, password_hash, anonymized_at FROM users WHERE id = ?', uid)!;
  assert.match(u.email, /anonimizado\.invalid$/);
  assert.equal(u.password_hash, null);
  assert.ok(u.anonymized_at);
  assert.equal((await c.req('GET', '/api/auth/me')).body.user, null);
  assert.equal((await (await client()).req('POST', '/api/auth/login', { email: c.email, password: 'senhaSegura123' })).status, 401);
  assert.equal(getDb().get<{ status: string }>("SELECT status FROM data_requests WHERE user_id = ? AND type = 'deletion'", uid)!.status, 'completed');
});

// ---------------------------------------------------------------------------------------------
test('backup: cópia consistente, SHA-256, teste de restauração e detecção de adulteração', async () => {
  await boot();
  const b = runBackup('manual');
  assert.ok(fs.existsSync(b.file));
  const v = verifyBackup(b.id);
  assert.equal(v.ok, true, JSON.stringify(v.checks));
  assert.ok(v.checks.some((c) => c.name.startsWith('integridade') && c.ok));
  assert.ok(v.checks.some((c) => c.name === 'registros em orders' && c.ok));
  assert.equal(getDb().get<{ status: string }>('SELECT status FROM backups WHERE id = ?', b.id)!.status, 'verified');
  // Adulteração: muda 1 byte → SHA-256 não confere → backup marcado como falho.
  const fd = fs.openSync(b.file, 'r+');
  fs.writeSync(fd, Buffer.from([0x00]), 0, 1, 2000);
  fs.closeSync(fd);
  assert.equal(verifyBackup(b.id).ok, false);
  const notDb = path.join(backupDir(), 'nao-e-banco.db');
  fs.writeFileSync(notDb, 'texto qualquer');
  assert.equal(verifyBackupFile(notDb, false).ok, false);
  const a = await admin();
  const r = await a.req('POST', '/api/admin/ops/backups');
  assert.equal(r.status, 200);
  assert.equal(r.body.verification.ok, true);
  const ops = await a.req('GET', '/api/admin/ops');
  assert.equal(ops.status, 200);
  assert.ok(Array.isArray(ops.body.issues));
  assert.equal(ops.body.health.database, 'ok');
  fs.rmSync(backupDir(), { recursive: true, force: true });
});

test('qualidade do catálogo: produto sem imagem não pode ser publicado; saúde pública mínima', async () => {
  const a = await admin('catalog');
  const v = inStockVariant(1);
  const db = getDb();
  db.run('DELETE FROM product_images WHERE product_id = ?', v.productId);
  await a.req('POST', `/api/admin/products/${v.productId}/unpublish`);
  const pub = await a.req('POST', `/api/admin/products/${v.productId}/publish`);
  assert.equal(pub.status, 422);
  assert.equal(pub.body.error.code, 'publish_requirements');
  const audit = await a.req('GET', '/api/admin/catalog-audit');
  assert.equal(audit.status, 200);
  const h = await (await client()).req('GET', '/api/health');
  assert.deepEqual(Object.keys(h.body).sort(), ['checkedAt', 'status']);
});

test('config pública não expõe custos internos nem segredos', async () => {
  const c = await client();
  const cfg = await c.req('GET', '/api/config');
  const s = JSON.stringify(cfg.body);
  assert.equal(s.includes('packagingCostCents'), false);
  assert.equal(s.includes('TEST-access-token'), false);
  assert.equal(s.includes('test-webhook-secret'), false);
  assert.equal(s.includes('test-app-secret'), false);
  assert.equal(s.includes('TEST-wa-token'), false);
  assert.equal(cfg.body.payments.boleto, true);
  assert.equal(cfg.body.guestCheckout, true);
});
