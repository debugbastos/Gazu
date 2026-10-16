import './_setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, client, customer, inStockVariant, placeOrder } from './_harness.ts';

test('cadastro inválido e login inválido', async () => {
  const c = await client();
  const weak = await c.req('POST', '/api/auth/register', { name: 'A', email: 'x@y.z', password: '123', acceptTerms: true });
  assert.equal(weak.status, 400);
  const noTerms = await c.req('POST', '/api/auth/register', { name: 'Ana', email: 'ana@teste.dev', password: 'senhaSegura123', acceptTerms: false });
  assert.equal(noTerms.status, 400);
  const u = await customer();
  const wrong = await client();
  const r = await wrong.req('POST', '/api/auth/login', { email: u.email, password: 'senhaErrada999' });
  assert.equal(r.status, 401);
  const me = await wrong.req('GET', '/api/auth/me');
  assert.equal(me.body.user, null);
});

test('sessão: login, /me e logout', async () => {
  const u = await customer();
  const me = await u.req('GET', '/api/auth/me');
  assert.equal(me.body.user.email, u.email);
  assert.equal(me.body.user.role, 'customer');
  assert.equal(me.body.user.passwordHash, undefined, 'hash de senha nunca é exposto');
  await u.req('POST', '/api/auth/logout');
  assert.equal((await u.req('GET', '/api/auth/me')).body.user, null);
  assert.equal((await u.req('GET', '/api/account/orders')).status, 401);
});

test('cliente não acessa pedido de outro cliente', async () => {
  const a = await customer();
  const b = await customer();
  const { res } = await placeOrder(a, [{ variantId: inStockVariant(1).id, quantity: 1 }]);
  assert.equal(res.status, 200);
  const spy = await b.req('GET', `/api/account/orders/${res.body.number}`);
  assert.equal(spy.status, 404);
  const pay = await b.req('POST', `/api/checkout/orders/${res.body.number}/pay`, { method: 'pix' });
  assert.equal(pay.status, 404);
  const cancel = await b.req('POST', `/api/account/orders/${res.body.number}/cancel`);
  assert.equal(cancel.status, 404);
});

test('cliente não acessa endereços de outro cliente', async () => {
  const a = await customer();
  const b = await customer();
  const created = await a.req('POST', '/api/account/addresses', { recipient: 'Ana Teste', cep: '01310100', street: 'Rua A', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP', label: 'Casa' });
  assert.equal(created.status, 200);
  const id = created.body.addresses[0].id;
  assert.equal((await b.req('PUT', `/api/account/addresses/${id}`, { recipient: 'Invasor', cep: '01310100', street: 'Rua B', number: '2', district: 'Centro', city: 'São Paulo', state: 'SP' })).status, 404);
  assert.equal((await b.req('DELETE', `/api/account/addresses/${id}`)).status, 404);
  assert.equal((await b.req('GET', '/api/account/addresses')).body.addresses.length, 0);
});

test('painel: visitante e cliente comum recebem 401/403; admin acessa', async () => {
  const anon = await client();
  assert.equal((await anon.req('GET', '/api/admin/dashboard')).status, 401);
  const u = await customer();
  for (const path of ['/api/admin/dashboard', '/api/admin/products', '/api/admin/orders', '/api/admin/customers', '/api/admin/settings']) {
    assert.equal((await u.req('GET', path)).status, 403, path);
  }
  assert.equal((await u.req('PUT', '/api/admin/settings', {})).status, 403);
  const a = await admin();
  const d = await a.req('GET', '/api/admin/dashboard');
  assert.equal(d.status, 200);
  assert.equal(d.body.revenueCents, 0, 'pedidos de demonstração não entram na receita');
});

test('admin: altera preço, cria variante, ajusta estoque e registra rastreio', async () => {
  const a = await admin();
  const list = await a.req('GET', '/api/admin/products?q=camisa');
  const p = (await a.req('GET', `/api/admin/products/${list.body.items[0].id}`)).body;
  const upd = await a.req('PUT', `/api/admin/products/${p.id}`, { ...p, priceCents: 25900, promoPriceCents: 19900, details: null, seoTitle: null, seoDescription: null });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.equal(upd.body.priceCents, 25900);
  const badPromo = await a.req('PUT', `/api/admin/products/${p.id}`, { ...p, priceCents: 10000, promoPriceCents: 20000, details: null, seoTitle: null, seoDescription: null });
  assert.equal(badPromo.status, 400);
  const nv = await a.req('POST', `/api/admin/products/${p.id}/variants`, { sku: `TEST-${Date.now()}`, colorName: 'Preto', colorHex: '#111111', size: 'XG', sizeOrder: 9, initialStock: 5 });
  assert.equal(nv.status, 200, JSON.stringify(nv.body));
  const v = nv.body.variants.find((x: any) => x.size === 'XG');
  assert.equal(v.stock, 5);
  const adj = await a.req('POST', `/api/admin/variants/${v.id}/stock`, { delta: -2, reason: 'adjustment', note: 'avaria' });
  assert.equal(adj.body.variants.find((x: any) => x.id === v.id).stock, 3);
  const neg = await a.req('POST', `/api/admin/variants/${v.id}/stock`, { delta: -50, reason: 'adjustment' });
  assert.ok(neg.status >= 400, 'estoque não fica negativo');
  const mv = await a.req('GET', `/api/admin/variants/${v.id}/movements`);
  assert.ok(mv.body.movements.length >= 2, 'movimentações registradas');
  // a vitrine reflete o novo preço promocional
  const pub = await (await client()).req('GET', `/api/products/${p.slug}`);
  assert.equal(pub.body.promoPriceCents, 19900);
});

test('requisições de outra origem são bloqueadas (CSRF)', async () => {
  const u = await customer();
  const r = await u.req('POST', '/api/account/addresses', { recipient: 'X Y', cep: '01310100', street: 'Rua', number: '1', district: 'C', city: 'SP', state: 'SP' }, { Origin: 'https://site-malicioso.example' });
  assert.equal(r.status, 403);
});
