#!/usr/bin/env node
// Testa dist/index.html aberto como ARQUIVO (file://), sem servidor: hero, navegação, compra completa e painel.
// Uso: npm run build:html && node tests/e2e/standalone.mjs [--out=pasta]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const FILE = process.env.HTML_URL ?? 'file://' + path.join(root, 'dist/index.html');
const OUT = path.resolve(process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? path.join(root, 'tests/e2e/screenshots/standalone'));
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function step(name, fn) { try { await fn(); results.push(true); console.log('✓', name); } catch (e) { results.push(false); console.log('✗', name, '\n   ', e.message); } }

const browser = await chromium.launch();
const errors = [];
const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); };

await step('abre sem servidor; hero com 4 modelos alterna e GAZU fixa', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); watch(p);
  await p.goto(FILE); await p.waitForSelector('.hero__word');
  await p.waitForTimeout(1600);
  await p.screenshot({ path: `${OUT}/home--desktop.png` });
  const seq = await p.evaluate(async () => {
    const ls = [...document.querySelectorAll('.hero-model__layer')]; const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 16500) { const i = ls.findIndex((l) => Number(getComputedStyle(l).opacity) > 0.99); if (i >= 0 && out[out.length - 1] !== i) out.push(i); await new Promise((r) => setTimeout(r, 60)); }
    return out;
  });
  assert(seq.slice(0, 4).join(',') === '0,1,2,3', `sequência ${seq}`);
  const imgs = await p.$$eval('img', (els) => els.filter((e) => e.complete && e.naturalWidth === 0 && e.currentSrc).map((e) => e.currentSrc.slice(0, 60)));
  assert(imgs.length === 0, `imagens quebradas: ${imgs.join(', ')}`);
  const font = await p.evaluate(() => document.fonts.check('700 40px "Inter Display"'));
  assert(font, 'fonte Inter Display não carregada');
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); } window.scrollTo(0, 0); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/home-inteira--desktop.png`, fullPage: true });
  await p.close();
});

await step('catálogo com filtro, produto, favoritos e busca', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); watch(p);
  await p.goto(FILE + '#/categoria/feminino'); await p.waitForSelector('.product-card');
  const before = await p.locator('.catalog__count').textContent();
  await p.getByRole('button', { name: 'Vestido' }).first().click().catch(() => {});
  await p.locator('.facet--tipo .checkbox', { hasText: 'Vestido' }).click();
  await p.waitForTimeout(300);
  const after = await p.locator('.catalog__count').textContent();
  assert(before !== after && /\d+ produto/.test(after), `filtro: ${before} → ${after}`);
  await p.screenshot({ path: `${OUT}/categoria--desktop.png` });
  await p.locator('.product-card__name a').first().click();
  await p.waitForSelector('.pdp-title');
  assert(p.url().includes('#/produto/'), 'url do produto');
  await p.screenshot({ path: `${OUT}/produto--desktop.png` });
  await p.locator('.pdp-fav').click();
  await p.getByRole('button', { name: 'Buscar produtos' }).click();
  await p.keyboard.type('tenis');
  await p.waitForSelector('.search-overlay__list a');
  await p.close();
});

let shared; // mesmo navegador (mesmo armazenamento local) para compra e painel
await step('compra completa no celular: sacola → cadastro → checkout → pagamento simulado → pago', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
  shared = ctx;
  const p = await ctx.newPage(); watch(p);
  await p.goto(FILE + '#/produto/vestido-midi-cerejas'); await p.waitForSelector('.pdp-title');
  await p.locator('.pdp-size:not(.is-out)').first().click();
  await p.locator('.pdp-buy__btn').click();
  await p.getByText(/foi adicionado à sacola/).waitFor();
  await p.screenshot({ path: `${OUT}/produto--celular.png` });
  await p.getByRole('button', { name: /Sacola com 1 item/ }).click();
  await p.getByRole('link', { name: 'Finalizar compra' }).click();
  await p.getByRole('link', { name: 'Criar conta' }).click();
  await p.getByLabel('Nome completo').fill('Cliente Demo');
  await p.getByLabel('E-mail').fill('cliente@demo.dev');
  await p.getByLabel('Senha', { exact: true }).fill('Demo2026x');
  await p.getByLabel('Confirmar senha').fill('Demo2026x');
  await p.locator('.checkbox').last().click();
  await p.getByRole('button', { name: 'Criar conta' }).click();
  await p.waitForURL(/#\/checkout$/);
  for (const [l, v] of [['Nome do destinatário', 'Cliente Demo'], ['CEP', '01310100'], ['Rua', 'Avenida Paulista'], ['Número', '1000'], ['Bairro', 'Bela Vista'], ['Cidade', 'São Paulo']]) await p.getByLabel(l, { exact: true }).fill(v);
  await p.getByLabel('UF').selectOption('SP');
  await p.locator('.ship-option').first().click();
  await p.getByRole('button', { name: 'Confirmar pedido e pagar' }).click();
  await p.waitForURL(/#\/checkout\/pedido\/GZ/);
  await p.getByRole('radio', { name: /Pagamento simulado/ }).click();
  await p.getByRole('button', { name: 'Iniciar pagamento simulado' }).click();
  await p.getByRole('button', { name: 'Simular aprovação' }).click();
  await p.getByText('Pagamento confirmado').first().waitFor();
  await p.screenshot({ path: `${OUT}/pedido-pago--celular.png`, fullPage: true });
  // Persistência: recarregar mantém sessão e pedido
  await p.reload(); await p.getByText('Pagamento confirmado').first().waitFor();
  await p.close();
});

await step('painel: login de demonstração, pedido enviado com rastreio, ajuste de estoque', async () => {
  const p = await (shared ?? browser).newPage(); watch(p);
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(FILE + '#/entrar?returnTo=/admin');
  await p.getByRole('button', { name: 'Preencher' }).click();
  await p.getByRole('button', { name: 'Entrar' }).click();
  await p.waitForURL(/#\/admin$/);
  await p.getByRole('link', { name: 'Pedidos', exact: true }).click();
  await p.locator('.admin-table .admin-link').first().click();
  await p.getByLabel('Alterar status').selectOption('processing');
  await p.getByRole('button', { name: 'Salvar' }).click();
  await p.getByText('Pedido atualizado.').waitFor();
  await p.getByLabel('Alterar status').selectOption('shipped');
  await p.getByLabel(/Código de rastreamento/).fill('BR123456789BR');
  await p.getByRole('button', { name: 'Salvar' }).click();
  await p.locator('.admin-card .status--shipped').waitFor();
  await p.goto(FILE + '#/admin/produtos/12'); await p.waitForSelector('.admin-table');
  await p.getByRole('button', { name: 'Ajustar estoque' }).first().click();
  await p.getByLabel('Quantidade (+/−)').fill('5');
  await p.getByRole('button', { name: 'Registrar ajuste' }).click();
  await p.getByText(/Estoque ajustado/).waitFor();
  await p.goto(FILE + '#/admin'); await p.waitForSelector('.kpi');
  await p.screenshot({ path: `${OUT}/admin--desktop.png` });
  await p.close();
});

await browser.close();
// A consulta de CEP (ViaCEP) precisa de internet; sem rede o formulário segue manual — não é falha.
const relevant = errors.filter((e) => !/favicon|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|viacep/i.test(e));
if (relevant.length) console.log('Erros no navegador:\n - ' + [...new Set(relevant)].join('\n - '));
console.log(`\n${results.filter(Boolean).length}/${results.length} cenários aprovados${relevant.length ? ' (com erros de console)' : ''}.`);
process.exitCode = results.every(Boolean) && !relevant.length ? 0 : 1;
