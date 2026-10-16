import './_setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../../src/server/db.ts';
import { client, inStockVariant } from './_harness.ts';

test('catálogo: categoria, filtros, ordenação e busca sem acento', async () => {
  const c = await client();
  const cat = await c.req('GET', '/api/catalog?categoria=tenis&ordem=menor-preco');
  assert.equal(cat.status, 200);
  assert.ok(cat.body.total > 0);
  const prices = cat.body.items.map((p: any) => p.promoPriceCents ?? p.priceCents);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'ordenado por menor preço');
  const busca = await c.req('GET', '/api/catalog?q=tenis');
  assert.ok(busca.body.total > 0, '"tenis" encontra "Tênis"');
  const vazio = await c.req('GET', '/api/catalog?q=zzzzinexistente');
  assert.equal(vazio.body.total, 0);
  const filtro = await c.req('GET', '/api/catalog?categoria=feminino&tamanho=M&estoque=1');
  for (const p of filtro.body.items) assert.equal(p.available, true);
});

test('produto: variantes, relacionados e 404', async () => {
  const c = await client();
  const p = await c.req('GET', '/api/products/camisa-manga-curta-texturizada');
  assert.equal(p.status, 200);
  assert.ok(p.body.variants.length >= 1);
  assert.ok(p.body.related.length > 0, 'relacionados usam o departamento quando a subcategoria tem um só produto');
  assert.ok(!p.body.related.some((r: any) => r.id === p.body.id));
  const esgotado = await c.req('GET', '/api/products/jaqueta-racing-preta-patches');
  assert.ok(esgotado.body.variants.every((v: any) => v.stock === 0));
  assert.equal(esgotado.body.available, false);
  const nf = await c.req('GET', '/api/products/nao-existe');
  assert.equal(nf.status, 404);
});

test('home: vitrines não repetem produtos', async () => {
  const c = await client();
  const h = await c.req('GET', '/api/home');
  const shown = [...h.body.featured, ...h.body.newest.slice(0, 4), ...h.body.clothing.slice(0, 4), ...h.body.sneakers.slice(0, 4), ...h.body.accessories.slice(0, 4)].map((p: any) => p.id);
  assert.equal(new Set(shown).size, shown.length);
});

test('sacola: preço vem do servidor, estoque limita quantidade e itens inexistentes são ignorados', async () => {
  const c = await client();
  const v = inStockVariant(2);
  const q = await c.req('POST', '/api/cart/quote', { items: [{ variantId: v.id, quantity: 2 }, { variantId: 99999999, quantity: 1 }], unitPriceCents: 1 });
  assert.equal(q.status, 200);
  assert.equal(q.body.lines.length, 1);
  assert.equal(q.body.lines[0].unitPriceCents, v.priceCents, 'preço enviado pelo navegador é ignorado');
  assert.equal(q.body.subtotalCents, v.priceCents * 2);
  const over = await c.req('POST', '/api/cart/quote', { items: [{ variantId: v.id, quantity: Math.min(20, v.stock + 1) }] });
  if (v.stock + 1 <= 20) assert.equal(over.body.lines[0].issue, 'insufficient_stock');
  const zero = getDb().get<{ id: number }>('SELECT id FROM product_variants WHERE stock = 0 LIMIT 1')!;
  const out = await c.req('POST', '/api/cart/quote', { items: [{ variantId: zero.id, quantity: 1 }] });
  assert.equal(out.body.lines[0].issue, 'out_of_stock');
  assert.equal(out.body.hasIssues, true);
});

test('cupom: válido, abaixo do mínimo e inexistente', async () => {
  const c = await client();
  const v = inStockVariant(1);
  const qty = Math.min(v.stock, Math.ceil(15000 / v.priceCents));
  const ok = await c.req('POST', '/api/cart/quote', { items: [{ variantId: v.id, quantity: qty }], couponCode: 'BEMVINDO10' });
  if (ok.body.subtotalCents >= 15000) {
    assert.equal(ok.body.coupon.valid, true);
    assert.equal(ok.body.discountCents, Math.round(ok.body.subtotalCents * 0.1));
  }
  const min = await c.req('POST', '/api/cart/quote', { items: [{ variantId: v.id, quantity: 1 }], couponCode: 'BEMVINDO10' });
  if (min.body.subtotalCents < 15000) { assert.equal(min.body.coupon.valid, false); assert.equal(min.body.discountCents, 0); }
  const bad = await c.req('POST', '/api/cart/quote', { items: [{ variantId: v.id, quantity: 1 }], couponCode: 'NAOEXISTE' });
  assert.equal(bad.body.coupon.valid, false);
  assert.equal(bad.body.discountCents, 0);
});

test('frete: CEP inválido não gera cotação; demonstração é sinalizada', async () => {
  const c = await client();
  const bad = await c.req('POST', '/api/shipping/quote', { cep: '000', subtotalCents: 10000 });
  assert.ok(bad.status === 400 || bad.body.options?.length === 0);
  const ok = await c.req('POST', '/api/shipping/quote', { cep: '01310-100', subtotalCents: 10000 });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.options.length > 0);
  assert.ok(ok.body.options.every((o: any) => o.isDemo === true), 'frete simulado identificado como demonstração');
});
