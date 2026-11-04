import './_setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getDb } from '../../src/server/db.ts';
import { remindAbandonedCarts } from '../../src/server/services/engagement.ts';
import { consistencyChecks } from '../../src/server/services/monitoring.ts';
import { admin, ADDRESS, client, customer, inStockVariant, placeOrder } from './_harness.ts';

test('busca: erro de digitação gera correção real e busca sem resultado sugere termos existentes (nada inventado)', async () => {
  const c = await client();
  const typo = await c.req('GET', '/api/catalog?q=camiseya');
  assert.equal(typo.status, 200);
  assert.ok(typo.body.total > 0, 'erro de digitação ainda encontra produtos');
  assert.equal(typo.body.correctedQuery, 'camiseta', 'a correção é informada ao cliente');
  const none = await c.req('GET', '/api/catalog?q=xyzqwk');
  assert.equal(none.body.total, 0);
  const names = getDb().all<{ name: string }>('SELECT name FROM products WHERE is_active = 1').map((p) => p.name.toLowerCase()).join(' ');
  for (const s of none.body.suggestions ?? []) {
    const r = await c.req('GET', `/api/catalog?q=${encodeURIComponent(s)}`);
    assert.ok(r.body.total > 0 || names.includes(String(s).toLowerCase()), `sugestão "${s}" precisa existir no catálogo`);
  }
  const sug = await c.req('GET', '/api/search/suggest?q=tenis');
  assert.ok(sug.body.items.length > 0 && sug.body.items.every((p: { slug: string }) => getDb().get('SELECT 1 FROM products WHERE slug = ? AND is_active = 1', p.slug)));
});

test('filtros de novidades e coleção usam dados reais e combinam com os demais', async () => {
  const c = await client();
  const col = getDb().get<{ slug: string; n: number }>("SELECT col.slug, COUNT(*) AS n FROM collections col JOIN collection_products cp ON cp.collection_id = col.id JOIN products p ON p.id = cp.product_id WHERE col.status = 'active' AND p.is_active = 1 GROUP BY col.id ORDER BY n DESC LIMIT 1")!;
  const r = await c.req('GET', `/api/catalog?colecao=${col.slug}&por_pagina=60`);
  assert.equal(r.body.total, col.n);
  const inStock = await c.req('GET', `/api/catalog?colecao=${col.slug}&estoque=1&por_pagina=60`);
  assert.ok(inStock.body.total <= col.n && inStock.body.items.every((p: { available: boolean }) => p.available));
  const novidades = await c.req('GET', '/api/catalog?categoria=novidades&por_pagina=60');
  assert.ok(novidades.body.items.every((p: { isNew?: boolean }) => p.isNew), 'novidades só lista produtos dentro da janela de lançamento');
  assert.ok(Array.isArray(r.body.facets.collections));
});

test('produto: rascunho → publicar (com bloqueios) → despublicar → arquivar → duplicar → lixeira → restaurar', async () => {
  const a = await admin('catalog');
  const cat = getDb().get<{ id: number }>("SELECT id FROM categories WHERE slug = 'masculino-camisetas'")!;
  const created = await a.req('POST', '/api/admin/products', { name: 'Camiseta Teste Ciclo', slug: `camiseta-teste-ciclo-${Date.now()}`, description: 'Descrição suficiente para o produto.', audience: 'masculino', productType: 'Camiseta', priceCents: 9900, categoryIds: [cat.id], primaryCategoryId: cat.id, isActive: false, isFeatured: false, isDemo: false, colorConfirmed: true });
  assert.equal(created.status, 200);
  assert.equal(created.body.status, 'draft', 'produto novo nasce como rascunho');
  const id = created.body.id as number;
  const blocked = await a.req('POST', `/api/admin/products/${id}/publish`);
  assert.equal(blocked.status, 422, 'sem imagem e sem variante não publica');
  assert.ok(blocked.body.error.details.blockers.some((b: { code: string }) => b.code === 'no_image'));
  const db = getDb();
  db.run("INSERT INTO product_images (product_id, url, alt, position) VALUES (?, '/assets/branding/og-image.png', 'Teste', 0)", id);
  const v = await a.req('POST', `/api/admin/products/${id}/variants`, { sku: `TST-${Date.now()}`, colorName: 'Preto', size: 'M', sizeOrder: 2, isActive: true, initialStock: 3 });
  assert.equal(v.status, 200);
  const pub = await a.req('POST', `/api/admin/products/${id}/publish`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.status, 'published');
  assert.equal((await a.req('POST', `/api/admin/products/${id}/unpublish`)).body.status, 'draft');
  assert.equal((await a.req('POST', `/api/admin/products/${id}/archive`)).body.status, 'archived');
  const dup = await a.req('POST', `/api/admin/products/${id}/duplicate`);
  assert.equal(dup.status, 200);
  const copy = db.get<{ is_active: number; slug: string }>('SELECT is_active, slug FROM products WHERE id = ?', dup.body.id)!;
  assert.equal(copy.is_active, 0, 'cópia nasce despublicada');
  assert.equal(db.get<{ n: number }>('SELECT COALESCE(SUM(stock), 0) AS n FROM product_variants WHERE product_id = ?', dup.body.id)!.n, 0, 'cópia com estoque zerado');
  assert.equal((await a.req('DELETE', `/api/admin/products/${id}`)).body.status, 'trash');
  assert.equal((await a.req('POST', `/api/admin/products/${id}/restore`)).body.status, 'draft');
  const actions = db.all<{ action: string }>("SELECT action FROM audit_log WHERE entity = 'product' AND entity_id = ?", String(id)).map((r) => r.action);
  for (const act of ['product.create', 'product.publish', 'product.unpublish', 'product.archive', 'product.trash', 'product.restore']) assert.ok(actions.includes(act), `auditoria: ${act}`);
  // Função sem catalog.write não altera produtos.
  const fin = await admin('finance');
  assert.equal((await fin.req('POST', `/api/admin/products/${id}/publish`)).status, 403);
});

test('categoria com produtos ou subcategorias não pode ser excluída; vazia pode', async () => {
  const a = await admin('catalog');
  const busy = getDb().get<{ id: number }>("SELECT id FROM categories WHERE slug = 'masculino'")!;
  const r = await a.req('DELETE', `/api/admin/categories/${busy.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'has_dependencies');
  const created = await a.req('POST', '/api/admin/categories', { name: 'Temporária', slug: `temporaria-${Date.now()}`, description: null, parentId: null, position: 99, isActive: false, imageUrl: null });
  assert.equal(created.status, 200);
  const id = (created.body.categories as { id: number; slug: string }[]).find((c) => c.slug.startsWith('temporaria-'))!.id;
  assert.equal((await a.req('DELETE', `/api/admin/categories/${id}`)).status, 200);
  // Categoria vazia não aparece na navegação pública.
  const pub = await (await client()).req('GET', '/api/categories');
  const flat = JSON.stringify(pub.body.categories);
  assert.ok(!flat.includes('temporaria-'));
});

test('cupom com limite por cliente: segundo uso pelo mesmo cliente é recusado no servidor', async () => {
  const a = await admin('owner');
  const code = `UMAVEZ${Date.now().toString().slice(-6)}`;
  const cr = await a.req('POST', '/api/admin/coupons', { code, description: 'Teste', discountType: 'percent', value: 10, minOrderCents: 0, startsAt: null, endsAt: null, maxUses: null, maxUsesPerUser: 1, isActive: true, isDemo: false, categoryIds: [], productIds: [] });
  assert.equal(cr.status, 200, JSON.stringify(cr.body));
  const c = await customer();
  const v = inStockVariant(3);
  const first = await placeOrder(c, [{ variantId: v.id, quantity: 1 }], code);
  assert.equal(first.res.status, 200);
  assert.ok(first.res.body.discountCents > 0);
  // Pedido pago confirma o uso do cupom.
  getDb().run("UPDATE coupon_redemptions SET status = 'confirmed' WHERE order_id = (SELECT id FROM orders WHERE number = ?)", first.res.body.number);
  const q = await c.req('POST', '/api/cart/quote', { items: [{ variantId: v.id, quantity: 1 }], couponCode: code, cep: ADDRESS.cep, shippingOptionId: null });
  assert.ok(q.body.coupon, 'cupom avaliado');
  assert.equal(q.body.coupon.valid, false, 'segundo uso recusado');
  assert.equal(q.body.discountCents, 0);
});

test('campanha: pedido com utm_campaign cadastrado é atribuído; utm desconhecido não cria campanha', async () => {
  const mk = await admin('marketing');
  const utm = `lanc${Date.now().toString().slice(-6)}`;
  const camp = await mk.req('POST', '/api/admin/campaigns', { name: 'Lançamento teste', slug: utm, channel: 'instagram', utmSource: 'instagram', utmMedium: 'social', utmCampaign: utm, landingPath: '/', status: 'active', couponId: null, startsAt: null, endsAt: null, notes: null });
  assert.equal(camp.status, 200, JSON.stringify(camp.body));
  const c = await customer();
  const v = inStockVariant(2);
  const q = await c.req('POST', '/api/cart/quote', { items: [{ variantId: v.id, quantity: 1 }], couponCode: null, cep: ADDRESS.cep, shippingOptionId: null });
  const ship = q.body.shippingOptions[0];
  const q2 = await c.req('POST', '/api/cart/quote', { items: [{ variantId: v.id, quantity: 1 }], couponCode: null, cep: ADDRESS.cep, shippingOptionId: ship.id });
  const o = await c.req('POST', '/api/checkout/orders', { items: [{ variantId: v.id, quantity: 1 }], couponCode: null, shippingOptionId: ship.id, expectedTotalCents: q2.body.totalCents, address: ADDRESS, saveAddress: false, attribution: { utmSource: 'instagram', utmMedium: 'social', utmCampaign: utm.toUpperCase() } });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const row = getDb().get<{ campaign_id: number | null; utm_campaign: string }>('SELECT campaign_id, utm_campaign FROM orders WHERE number = ?', o.body.number)!;
  assert.equal(row.campaign_id, camp.body.id);
  assert.equal(row.utm_campaign, utm);
  const before = getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM campaigns')!.n;
  await c.req('POST', '/api/checkout/orders', { items: [{ variantId: v.id, quantity: 1 }], couponCode: null, shippingOptionId: ship.id, expectedTotalCents: q2.body.totalCents, address: ADDRESS, saveAddress: false, attribution: { utmCampaign: 'inexistente' } });
  assert.equal(getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM campaigns')!.n, before);
  // Relatório: pedido não pago não conta receita.
  const rep = await mk.req('GET', '/api/admin/marketing/campaigns-report');
  const mine = rep.body.campaigns.find((x: { id: number }) => x.id === camp.body.id);
  assert.equal(mine.revenueCents, 0);
  assert.equal(mine.roas, null, 'sem gasto registrado não há ROAS');
});

test('carrinho abandonado: lembrete único e só para quem autorizou marketing', async () => {
  const db = getDb();
  const mk = (optIn: number) => {
    const uid = crypto.randomUUID();
    db.run('INSERT INTO users (id, email, password_hash, marketing_opt_in) VALUES (?, ?, ?, ?)', uid, `carrinho${optIn}${Date.now()}@teste.dev`, 'x', optIn);
    const old = new Date(Date.now() - 2 * 86400_000).toISOString();
    const cartId = db.run('INSERT INTO carts (user_id, updated_at) VALUES (?, ?)', uid, old).lastInsertRowid;
    db.run('INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES (?, ?, 1)', cartId, inStockVariant().id);
    return { uid, cartId };
  };
  const yes = mk(1);
  const no = mk(0);
  await remindAbandonedCarts();
  await remindAbandonedCarts();
  const sent = (uid: string) => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE event = 'cart.abandoned' AND user_id = ?", uid)!.n;
  assert.equal(sent(yes.uid), 1, 'um único lembrete');
  assert.equal(sent(no.uid), 0, 'sem consentimento não recebe');
});

test('verificação de consistência detecta pedido pago sem pagamento aprovado e estoque divergente', async () => {
  await client();
  const db = getDb();
  const uid = crypto.randomUUID();
  db.run('INSERT INTO users (id, email) VALUES (?, ?)', uid, `consist${Date.now()}@teste.dev`);
  db.run(`INSERT INTO orders (number, user_id, status, subtotal_cents, discount_cents, shipping_cents, total_cents, shipping_option_id, shipping_label, ship_recipient, ship_cep, ship_street, ship_number, ship_district, ship_city, ship_state, paid_at)
          VALUES (?, ?, 'paid', 1000, 0, 0, 1000, 'manual:1', 'Entrega', 'X', '01001000', 'Rua', '1', 'B', 'São Paulo', 'SP', ?)`, `CK${Date.now()}`, uid, new Date().toISOString());
  const v = inStockVariant();
  db.run('UPDATE product_variants SET stock = stock + 7 WHERE id = ?', v.id); // alteração sem movimentação registrada
  const keys = consistencyChecks().map((i) => i.key);
  assert.ok(keys.includes('paid_without_payment'));
  assert.ok(keys.includes('stock_mismatch'));
  db.run('UPDATE product_variants SET stock = stock - 7 WHERE id = ?', v.id);
});
