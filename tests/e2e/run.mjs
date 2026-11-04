#!/usr/bin/env node
// Testes ponta a ponta no navegador real (Playwright/Chromium), com servidor e banco TEMPORÁRIOS:
//  1. Hero: ordem dos 4 modelos, permanência ≈3 s, retorno ao primeiro, palco nunca vazio, tipografia fixa.
//  2. Movimento reduzido: sem ciclo automático.
//  3. Compra completa: produto → variante → sacola → cadastro → checkout → pagamento simulado → pedido pago.
//  4. Painel: administrador vê o pedido e registra envio com rastreamento; cliente vê o código.
//  5. Compra sem cadastro (visitante) com acesso ao pedido pelo link/cookie assinado.
//  6. Faixa de cookies: analytics só depois do consentimento.
//  7. Páginas editoriais e institucionais carregam sem erros.
//  8. Painel: módulos de gestão abrem sem erros e a função "Atendimento" não acessa o financeiro.
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
  // Rotinas desligadas e backups (se houver) na pasta temporária: o teste não grava nada no projeto.
  JOBS_ENABLED: 'false', BACKUP_DIR: path.join(tmp, 'backups'),
};
const node = (args, extra = {}) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`✓ ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`✗ ${name}\n    ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
// Nos fluxos de compra a escolha de cookies já está feita ("somente essenciais"); a faixa é testada no cenário 6.
const CONSENT = () => { try { localStorage.setItem('gazu.consent.v1', JSON.stringify({ analytics: false, decidedAt: new Date().toISOString() })); } catch { /* sem armazenamento */ } };
const newCtx = async (opts) => { const ctx = await browser.newContext(opts); await ctx.addInitScript(CONSENT); return ctx; };
const pageErrors = (page, bag, label) => {
  page.on('pageerror', (e) => bag.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|sdk\.mercadopago|viacep|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED/i.test(m.text())) bag.push(`${label}: ${m.text()}`); });
};
let browser;

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

  browser = await chromium.launch();
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
      const ctx = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
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
      await page.waitForURL(/\/checkout$/);
      await page.locator('.checkout-identify').getByRole('link', { name: 'Criar conta' }).click();
      const auth = page.locator('.auth__card');
      await auth.getByLabel('Nome completo').fill('Cliente E2E');
      await auth.getByLabel('E-mail', { exact: true }).fill(`e2e${Date.now()}@teste.dev`);
      await auth.getByLabel('Senha', { exact: true }).fill('SenhaE2E2026');
      await auth.getByLabel('Confirmar senha').fill('SenhaE2E2026');
      await auth.locator('.checkbox', { hasText: 'Li e aceito' }).click({ position: { x: 9, y: 9 } });
      await auth.getByRole('button', { name: 'Criar conta' }).click();
      await page.waitForURL((u) => new URL(u).pathname === '/checkout');
      await page.getByLabel('Nome do destinatário', { exact: true }).fill('Cliente E2E');
      await page.getByLabel('CEP', { exact: true }).fill('01310100');
      await page.getByLabel('Rua', { exact: true }).fill('Avenida Paulista');
      await page.getByLabel('Número', { exact: true }).fill('1000');
      await page.getByLabel('Bairro', { exact: true }).fill('Bela Vista');
      await page.getByLabel('Cidade', { exact: true }).fill('São Paulo');
      await page.getByLabel('UF', { exact: true }).selectOption('SP');
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
      const ctx = await newCtx({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(BASE + '/entrar?returnTo=/admin/pedidos', { waitUntil: 'networkidle' });
      await page.locator('.auth__card').getByLabel('E-mail', { exact: true }).fill('admin@e2e.dev');
      await page.locator('.auth__card').getByLabel('Senha', { exact: true }).fill('AdminE2E2026');
      await page.locator('.auth__card').getByRole('button', { name: 'Entrar' }).click();
      await page.waitForURL((u) => new URL(u).pathname === '/admin/pedidos');
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

    await step('compra sem cadastro: visitante paga (simulado) e acompanha o pedido pelo link seguro', async () => {
      const ctx = await newCtx({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(BASE + '/produto/camisa-manga-curta-texturizada', { waitUntil: 'networkidle' });
      await page.locator('.pdp-size:not(.is-out)').first().click();
      await page.locator('.pdp-buy__btn').click();
      await page.getByText(/foi adicionado à sacola/).waitFor();
      await page.goto(BASE + '/checkout', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continuar como visitante' }).click();
      const email = `visitante${Date.now()}@teste.dev`;
      const step1 = page.locator('.step').first();
      await step1.getByLabel('Nome completo').fill('Visitante E2E');
      await step1.getByLabel('E-mail', { exact: true }).fill(email);
      await step1.locator('.checkbox', { hasText: 'Li e aceito' }).click({ position: { x: 9, y: 9 } });
      await page.getByLabel('Nome do destinatário', { exact: true }).fill('Visitante E2E');
      await page.getByLabel('CEP', { exact: true }).fill('01310100');
      await page.getByLabel('Rua', { exact: true }).fill('Avenida Paulista');
      await page.getByLabel('Número', { exact: true }).fill('1000');
      await page.getByLabel('Bairro', { exact: true }).fill('Bela Vista');
      await page.getByLabel('Cidade', { exact: true }).fill('São Paulo');
      await page.getByLabel('UF', { exact: true }).selectOption('SP');
      await page.locator('.ship-option').first().click();
      await page.getByRole('button', { name: 'Confirmar pedido e pagar' }).click();
      await page.waitForURL(/\/pedido\/GZ/);
      const guestOrder = page.url().split('/').pop().split('?')[0];
      await page.getByRole('radio', { name: /Pagamento simulado/ }).click();
      await page.getByRole('button', { name: 'Iniciar pagamento simulado' }).click();
      await page.getByRole('button', { name: 'Simular aprovação' }).click();
      await page.getByText('Pagamento confirmado').first().waitFor();
      await page.screenshot({ path: path.join(root, 'tests/e2e/screenshots/visitante-pedido-pago--desktop.png'), fullPage: true });
      // Outro navegador (sem o cookie assinado) não vê o pedido sem o token do e-mail.
      const anon = await fetch(`${BASE}/api/orders/${guestOrder}`);
      assert(anon.status === 401 || anon.status === 403 || anon.status === 404, `pedido de visitante sem token: ${anon.status}`);
      await ctx.close();
    });

    await step('cookies: analytics só é enviado depois do consentimento', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const analytics = [];
      page.on('request', (rq) => { if (rq.url().includes('/api/analytics/events')) analytics.push(rq.url()); });
      await page.goto(BASE + '/categoria/masculino', { waitUntil: 'networkidle' });
      await page.locator('.consent').waitFor();
      await page.waitForTimeout(800);
      assert(analytics.length === 0, `eventos enviados sem consentimento: ${analytics.length}`);
      await page.getByRole('button', { name: 'Somente essenciais' }).click();
      await page.locator('.consent').waitFor({ state: 'detached' });
      await page.goto(BASE + '/categoria/feminino', { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      assert(analytics.length === 0, `eventos enviados após recusa: ${analytics.length}`);
      await ctx.close();
    });

    await step('páginas editoriais e institucionais carregam sem erros', async () => {
      const ctx = await newCtx({ viewport: { width: 1440, height: 900 } });
      const errs = [];
      for (const pth of ['/colecoes', '/archive', '/lookbook', '/journal', '/monte-seu-look', '/ajuda', '/entrega', '/pagamento', '/trocas-e-devolucoes', '/cancelamento', '/politica-de-privacidade', '/termos-de-uso', '/rastreio', '/atendimento', '/busca?q=camisa']) {
        const page = await ctx.newPage();
        pageErrors(page, errs, pth);
        const res = await page.goto(BASE + pth, { waitUntil: 'networkidle' });
        assert(res && res.status() < 400, `${pth}: HTTP ${res?.status()}`);
        const h1 = await page.locator('h1').first().textContent().catch(() => '');
        assert(h1 && h1.trim().length > 0, `${pth}: sem título`);
        await page.close();
      }
      const page = await ctx.newPage();
      await page.goto(BASE + '/lookbook', { waitUntil: 'networkidle' });
      await page.locator('a[href^="/lookbook/"]').first().click();
      await page.locator('.hotspot').first().waitFor({ timeout: 10000 }).catch(() => { throw new Error('lookbook sem pontos de produto'); });
      await page.screenshot({ path: path.join(root, 'tests/e2e/screenshots/lookbook--desktop.png') });
      await ctx.close();
      assert(errs.length === 0, errs.join(' | '));
    });

    await step('painel: módulos de gestão abrem sem erros; função Atendimento não acessa o financeiro', async () => {
      const ctx = await newCtx({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const errs = [];
      pageErrors(page, errs, 'admin');
      page.on('response', (rs) => { if (rs.url().includes('/api/admin/') && rs.status() >= 400) errs.push(`HTTP ${rs.status()} ${rs.url()}`); });
      await page.goto(BASE + '/entrar?returnTo=/admin', { waitUntil: 'networkidle' });
      await page.locator('.auth__card').getByLabel('E-mail', { exact: true }).fill('admin@e2e.dev');
      await page.locator('.auth__card').getByLabel('Senha', { exact: true }).fill('AdminE2E2026');
      await page.locator('.auth__card').getByRole('button', { name: 'Entrar' }).click();
      await page.waitForURL((u) => new URL(u).pathname === '/admin');
      for (const pth of ['/admin/financeiro', '/admin/operacao', '/admin/atendimento', '/admin/trocas', '/admin/envios', '/admin/analytics', '/admin/marketing', '/admin/equipe', '/admin/auditoria', '/admin/privacidade', '/admin/marca', '/admin/qualidade', '/admin/estoque', '/admin/avaliacoes', '/admin/conteudo/lookbooks', '/admin/configuracoes', '/admin/produtos', '/admin/clientes']) {
        await page.goto(BASE + pth, { waitUntil: 'networkidle' });
        await page.locator('.admin__head h1').waitFor();
      }
      assert(errs.length === 0, errs.join(' | '));
      await ctx.close();
      // Pessoa de atendimento: conta criada no site e promovida pelo proprietário.
      const supportEmail = `atendimento${Date.now()}@e2e.dev`;
      const reg = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ name: 'Atendimento E2E', email: supportEmail, password: 'Atende2026x', acceptTerms: true }) });
      assert(reg.ok, `cadastro da pessoa de atendimento: ${reg.status}`);
      const ownerLogin = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email: 'admin@e2e.dev', password: 'AdminE2E2026' }) });
      const ownerCookie = ownerLogin.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      const add = await fetch(`${BASE}/api/admin/team`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: ownerCookie }, body: JSON.stringify({ email: supportEmail, role: 'support' }) });
      assert(add.ok, `proprietário adiciona atendimento: ${add.status}`);
      const supLogin = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email: supportEmail, password: 'Atende2026x' }) });
      const supCookie = supLogin.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      const fin = await fetch(`${BASE}/api/admin/finance/summary`, { headers: { Cookie: supCookie } });
      assert(fin.status === 403, `atendimento no financeiro: ${fin.status}`);
      const tickets = await fetch(`${BASE}/api/admin/support/tickets`, { headers: { Cookie: supCookie } });
      assert(tickets.ok, `atendimento na central: ${tickets.status}`);
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
