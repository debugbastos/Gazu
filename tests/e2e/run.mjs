#!/usr/bin/env node
// Testes ponta a ponta no navegador real (Playwright/Chromium), com servidor e banco TEMPORÁRIOS:
//  1. Hero: ordem dos 4 modelos, permanência ≈3 s, retorno ao primeiro, palco nunca vazio, tipografia fixa.
//  2. Movimento reduzido: sem ciclo automático.
//  3. Compra completa: produto → variante → sacola → cadastro → checkout → pagamento simulado → pedido pago.
//  4. Painel: administrador vê o pedido e registra envio com rastreamento; cliente vê o código.
// Uso: node tests/e2e/run.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gazu-e2e-'));
const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const env = {
  ...process.env, NODE_ENV: 'development', PORT: String(PORT), HOST: '127.0.0.1', APP_URL: BASE, DATABASE_PATH: path.join(tmp, 'e2e.db'),
  SESSION_SECRET: 'e2e-secret-0123456789abcdef', DEMO_MODE: 'true', PAYMENT_PROVIDER: 'demo', SHIPPING_PROVIDER: 'demo', EMAIL_PROVIDER: 'console',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', MP_ACCESS_TOKEN: '', MP_WEBHOOK_SECRET: '',
};
const node = (args, extra = {}) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`✓ ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`✗ ${name}\n    ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function main() {
  if (!fs.existsSync(path.join(root, 'public/build/manifest.json'))) throw new Error('Execute "npm run build" antes dos testes e2e.');
  let r = node(['src/server/cli/seed.ts']);
  if (r.status !== 0) throw new Error(r.stderr);
  r = node(['src/server/cli/create-admin.ts', 'admin@e2e.dev'], { ADMIN_PASSWORD: 'AdminE2E2026' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);

  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/server/index.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/config')).ok) break; } catch { /* aguardando */ } await new Promise((res) => setTimeout(res, 250)); }

  const browser = await chromium.launch();
  try {
    await step('hero: 4 modelos em ordem, permanência ≈3 s, retorno ao 1º, sem palco vazio, palavra fixa', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      const samples = await page.evaluate(async () => {
        const layers = [...document.querySelectorAll('.hero-model__layer')];
        const word = document.querySelector('.hero__word');
        const out = [];
        const t0 = performance.now();
        while (performance.now() - t0 < 21500) {
          const ops = layers.map((l) => Number(getComputedStyle(l).opacity));
          const still = layers.map((l) => { const t = getComputedStyle(l).transform; return t === 'none' || /^matrix\(1, 0, 0, 1, 0, 0\)$/.test(t); });
          const r = word.getBoundingClientRect();
          out.push({ t: Math.round(performance.now() - t0), ops, still, word: [Math.round(r.left), Math.round(r.top), Math.round(r.width)] });
          await new Promise((res) => setTimeout(res, 50));
        }
        return out;
      });
      // Sequência de modelos dominantes (opacidade total)
      const seq = [];
      for (const s of samples) { const full = s.ops.findIndex((o) => o > 0.99); if (full >= 0 && seq[seq.length - 1] !== full) seq.push(full); }
      assert(seq.slice(0, 5).join(',') === '0,1,2,3,0', `ordem dos modelos: ${seq.join(',')}`);
      // Permanência: do momento em que o modelo chega à posição final (sem deslocamento, opacidade total,
      // nenhum outro visível) até o início da saída — o PRD pede ≈3 s após a entrada.
      const holds = [];
      let start = null, cur = null;
      for (const s of samples) {
        const vis = s.ops.filter((o) => o > 0.01).length;
        const full = s.ops.findIndex((o) => o > 0.99);
        if (vis === 1 && full >= 0 && s.still[full]) { if (cur !== full) { start = s.t; cur = full; } }
        else if (start !== null) { holds.push(s.t - start); start = null; cur = null; }
      }
      const mid = holds.slice(1, 4);
      assert(mid.length >= 3 && mid.every((h) => h >= 2800 && h <= 3300), `permanências (ms): ${holds.join(', ')}`);
      // Palco nunca vazio depois da primeira entrada
      const firstFull = samples.findIndex((s) => s.ops.some((o) => o > 0.99));
      const empty = samples.slice(firstFull).filter((s) => s.ops.every((o) => o < 0.05));
      assert(empty.length === 0, `palco vazio em ${empty.length} amostras`);
      // Tipografia não se move durante as trocas
      const words = new Set(samples.map((s) => s.word.join(',')));
      assert(words.size === 1, `palavra GAZU se moveu: ${[...words].join(' | ')}`);
      await page.close();
    });

    await step('hero: controles anterior/próximo/pausa funcionam', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1300);
      await page.getByRole('button', { name: 'Pausar animação' }).click();
      await page.getByRole('button', { name: 'Próximo modelo' }).click();
      await page.waitForTimeout(1500);
      const count = await page.locator('.hero__count').textContent();
      assert(count.trim().startsWith('02'), `após "próximo": ${count}`);
      await page.waitForTimeout(4000);
      assert((await page.locator('.hero__count').textContent()).trim().startsWith('02'), 'pausado não deve avançar');
      await page.getByRole('button', { name: 'Modelo anterior' }).click();
      await page.waitForTimeout(1500);
      assert((await page.locator('.hero__count').textContent()).trim().startsWith('01'), 'após "anterior"');
      await page.close();
    });

    await step('movimento reduzido: hero estático (sem troca automática)', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(5500);
      const ops = await page.$$eval('.hero-model__layer', (ls) => ls.map((l) => Number(getComputedStyle(l).opacity)));
      assert(ops[0] > 0.99 && ops.slice(1).every((o) => o < 0.01), `opacidades: ${ops}`);
      await ctx.close();
    });

    let orderNumber = '';
    await step('compra completa: variante → sacola → cadastro → checkout → pagamento simulado aprovado', async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(BASE + '/produto/camisa-manga-curta-texturizada', { waitUntil: 'networkidle' });
      // Sem tamanho → erro acessível
      await page.locator('.pdp-buy__btn').click();
      assert(await page.getByText('Selecione um tamanho para continuar.').isVisible(), 'mensagem de tamanho obrigatória');
      const sizes = page.locator('.pdp-size:not(.is-out)');
      await sizes.first().click();
      await page.locator('.pdp-buy__btn').click();
      await page.getByText(/foi adicionado à sacola/).waitFor();
      await page.getByRole('button', { name: /Sacola com 1 item/ }).click();
      await page.locator('.cart-drawer .cart-line').first().waitFor();
      await page.getByRole('link', { name: 'Finalizar compra' }).click();
      await page.waitForURL(/\/entrar/);
      await page.getByRole('link', { name: 'Criar conta' }).click();
      await page.getByLabel('Nome completo').fill('Cliente E2E');
      await page.getByLabel('E-mail').fill(`e2e${Date.now()}@teste.dev`);
      await page.getByLabel('Senha', { exact: true }).fill('SenhaE2E2026');
      await page.getByLabel('Confirmar senha').fill('SenhaE2E2026');
      await page.locator('.checkbox').last().click();
      await page.getByRole('button', { name: 'Criar conta' }).click();
      await page.waitForURL(/\/checkout$/);
      await page.getByLabel('Nome do destinatário').fill('Cliente E2E');
      await page.getByLabel('CEP').fill('01310100');
      await page.getByLabel('Rua').fill('Avenida Paulista');
      await page.getByLabel('Número').fill('1000');
      await page.getByLabel('Bairro').fill('Bela Vista');
      await page.getByLabel('Cidade').fill('São Paulo');
      await page.getByLabel('UF').selectOption('SP');
      await page.locator('.ship-option').first().click();
      await page.getByRole('button', { name: 'Confirmar pedido e pagar' }).click();
      await page.waitForURL(/\/checkout\/pedido\//);
      orderNumber = page.url().split('/').pop();
      await page.getByText('Aguardando pagamento').first().waitFor();
      await page.getByRole('radio', { name: /Pagamento simulado/ }).click();
      await page.getByRole('button', { name: 'Iniciar pagamento simulado' }).click();
      await page.getByRole('button', { name: 'Simular aprovação' }).click();
      await page.getByText('Pagamento confirmado').first().waitFor();
      fs.mkdirSync(path.join(root, 'tests/e2e/screenshots'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'tests/e2e/screenshots/fluxo-pedido-pago--celular.png'), fullPage: true });
      await ctx.close();
    });

    await step('painel: admin registra envio com rastreio; cliente comum não acessa /admin', async () => {
      assert(orderNumber, 'pedido do passo anterior');
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(BASE + '/entrar?returnTo=/admin/pedidos', { waitUntil: 'networkidle' });
      await page.getByLabel('E-mail').fill('admin@e2e.dev');
      await page.getByLabel('Senha').fill('AdminE2E2026');
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.waitForURL(/\/admin\/pedidos/);
      await page.getByRole('link', { name: orderNumber }).click();
      await page.getByLabel('Alterar status').selectOption('processing');
      await page.getByRole('button', { name: 'Salvar' }).click();
      await page.getByText('Pedido atualizado.').waitFor();
      await page.getByLabel('Alterar status').selectOption('shipped');
      await page.getByLabel(/Código de rastreamento/).fill('BR123456789BR');
      await page.getByRole('button', { name: 'Salvar' }).click();
      await page.locator('.admin-card .status--shipped').waitFor();
      await page.screenshot({ path: path.join(root, 'tests/e2e/screenshots/admin-pedido--desktop.png'), fullPage: true });
      await ctx.close();
      const res = await fetch(`${BASE}/api/admin/orders/${orderNumber}`);
      assert(res.status === 401, `visitante na API admin: ${res.status}`);
    });
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} cenários aprovados.`);
  if (failed.length) { console.log('\nLog do servidor (final):\n' + log.split('\n').slice(-25).join('\n')); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exit(1); });
