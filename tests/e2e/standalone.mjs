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
// A faixa de cookies é testada à parte; nos fluxos, a escolha "somente necessários" já está registrada.
const CONSENT = () => { try { localStorage.setItem('gazu.consent.v1', JSON.stringify({ analytics: false, decidedAt: new Date().toISOString() })); } catch { /* sem armazenamento */ } };
const watch = async (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); await p.addInitScript(CONSENT); };

await step('abre sem servidor; hero com 4 modelos alterna e GAZU fixa', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await watch(p);
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
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await watch(p);
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
  await p.locator('.pdp-fav[aria-pressed]').click();
  await p.getByRole('button', { name: 'Buscar produtos' }).click();
  await p.locator('.search-overlay input[aria-label="Buscar produtos"]').fill('tenis');
  await p.waitForSelector('.search-overlay__list a');
  await p.close();
});

await step('conteúdo editorial: coleções, lookbook, journal, FAQ e páginas institucionais', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await watch(p);
  for (const [hash, sel] of [['#/colecoes', '.collection-card, .editorial-card, a[href*="colecao"]'], ['#/lookbook', 'a[href*="lookbook/"]'], ['#/journal', 'a[href*="journal/"]'], ['#/ajuda', 'details, .faq, .accordion'], ['#/monte-seu-look', 'main']]) {
    await p.goto(FILE + hash);
    await p.locator(sel).first().waitFor({ timeout: 8000 });
  }
  await p.goto(FILE + '#/lookbook'); await p.locator('a[href*="lookbook/"]').first().click();
  await p.waitForTimeout(600);
  const broken = await p.$$eval('img', (els) => els.filter((e) => e.complete && e.naturalWidth === 0).length);
  assert(broken === 0, `${broken} imagem(ns) quebrada(s) no lookbook`);
  await p.screenshot({ path: `${OUT}/lookbook--desktop.png` });
  // Recurso de servidor: mensagem clara, sem quebrar a página.
  await p.goto(FILE + '#/atendimento');
  await p.waitForTimeout(500);
  await p.close();
});

let shared; // mesmo navegador (mesmo armazenamento local) para compra e painel
await step('compra completa no celular: sacola → cadastro → checkout → pagamento simulado → pago', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
  shared = ctx;
  const p = await ctx.newPage(); await watch(p);
  await p.goto(FILE + '#/produto/vestido-midi-cerejas'); await p.waitForSelector('.pdp-title');
  await p.locator('.pdp-size:not(.is-out)').first().click();
  await p.locator('.pdp-buy__btn').click();
  await p.getByText(/foi adicionado à sacola/).waitFor();
  await p.screenshot({ path: `${OUT}/produto--celular.png` });
  await p.getByRole('button', { name: /Sacola com 1 item/ }).click();
  await p.getByRole('link', { name: 'Finalizar compra' }).click();
  await p.getByRole('link', { name: 'Criar conta' }).click();
  const auth = p.locator('.auth__card');
  await auth.getByLabel('Nome completo').fill('Cliente Demo');
  await auth.getByLabel('E-mail', { exact: true }).fill('cliente@demo.dev');
  await auth.getByLabel('Senha', { exact: true }).fill('Demo2026x');
  await auth.getByLabel('Confirmar senha').fill('Demo2026x');
  await auth.locator('.checkbox', { hasText: 'Li e aceito' }).click({ position: { x: 9, y: 9 } });
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

await step('painel: entrada de demonstração (sem senha), pedido enviado com rastreio, ajuste de estoque', async () => {
  const p = await (shared ?? browser).newPage(); await watch(p);
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(FILE + '#/entrar?returnTo=/admin');
  await p.getByRole('button', { name: 'entrar no painel de demonstração' }).click();
  await p.waitForURL(/#\/admin$/);
  // Módulos que dependem do servidor ficam fora do menu da demonstração.
  const nav = await p.locator('.admin__side nav a').allTextContents();
  assert(!nav.some((t) => /Financeiro|Atendimento|Operação|Equipe/.test(t)), `menu da demonstração: ${nav.join(', ')}`);
  await p.getByRole('link', { name: 'Pedidos', exact: true }).click();
  await p.waitForURL(/#\/admin\/pedidos/);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/admin-pedidos--desktop.png` });
  await p.locator('.admin-table .admin-link').first().click({ timeout: 8000 });
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
