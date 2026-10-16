#!/usr/bin/env node
// Revisão visual: abre o site real no Chromium (Playwright) em desktop, notebook, tablet e celular,
// captura as páginas principais e verifica problemas objetivos de layout:
//  - rolagem horizontal (elementos fora da tela);
//  - imagens deformadas (proporção exibida ≠ proporção natural com object-fit: fill);
//  - textos cortados por overflow em elementos de uma linha;
//  - erros no console do navegador.
// Uso: BASE_URL=http://localhost:3000 node tests/e2e/visual.mjs [--out=pasta] [--only=home,produto]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const OUT = path.resolve(arg('out') ?? 'tests/e2e/screenshots');
const ONLY = arg('only')?.split(',');

export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'notebook', width: 1280, height: 720 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'celular', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: 'celular-pequeno', width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

export const PAGES = [
  { key: 'home', path: '/', full: true },
  { key: 'produto', path: '/produto/camisa-manga-curta-texturizada', full: true },
  { key: 'produto-esgotado', path: '/produto/jaqueta-racing-preta-patches' },
  { key: 'categoria', path: '/categoria/masculino' },
  { key: 'tenis', path: '/categoria/tenis' },
  { key: 'busca', path: '/busca?q=camiseta' },
  { key: 'sacola', path: '/carrinho' },
  { key: 'entrar', path: '/entrar' },
  { key: 'entrega', path: '/entrega' },
  { key: '404', path: '/pagina-que-nao-existe' },
];

async function audit(page) {
  return page.evaluate(() => {
    const issues = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > doc.clientWidth + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('[class*="strip"], [class*="band__inner"], .subcats, .lookbook__tiles, .pdp-strip, .account__nav ul'); })
        .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
      issues.push(`rolagem horizontal (${doc.scrollWidth}px > ${doc.clientWidth}px): ${wide.join(', ')}`);
    }
    for (const img of document.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if (!img.complete || !img.naturalWidth || r.width < 24 || r.height < 24) continue;
      const fit = getComputedStyle(img).objectFit;
      if (fit === 'fill') {
        const a = r.width / r.height, n = img.naturalWidth / img.naturalHeight;
        if (Math.abs(a - n) / n > 0.03) issues.push(`imagem deformada: ${img.currentSrc.split('/').pop()} (${a.toFixed(2)} vs ${n.toFixed(2)})`);
      }
    }
    // Colisões no cabeçalho (menu x logomarca x ações) e entre textos e o modelo do hero.
    const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') return null; const r = el.getBoundingClientRect(); return r.width ? r : null; };
    const gap = (a, b) => b.left - a.right;
    const nav = box('.site-nav > ul'), logo = box('.site-header__logo .logo'), actions = box('.site-actions');
    if (nav && logo && gap(nav, logo) < 16) issues.push(`menu encosta na logomarca (${Math.round(gap(nav, logo))}px)`);
    if (logo && actions && gap(logo, actions) < 16) issues.push(`logomarca encosta nas ações (${Math.round(gap(logo, actions))}px)`);
    for (const el of document.querySelectorAll('h1, h2, h3, .btn, .action, .site-nav a, .cat-band__title, .pdp-size, .chip')) {
      const s = getComputedStyle(el);
      if (s.overflow === 'hidden' && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) issues.push(`texto cortado: ${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}"`);
    }
    return issues;
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor ?? 1, reducedMotion: 'no-preference' });
    for (const pg of PAGES) {
      if (ONLY && !ONLY.includes(pg.key)) continue;
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && !/favicon|sdk\.mercadopago/.test(m.text()) && !(pg.key === '404' && /404/.test(m.text()))) errors.push(`console: ${m.text()}`); });
      await page.goto(BASE + pg.path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(pg.key === 'home' ? 1700 : 500);
      // Revela seções animadas por IntersectionObserver antes da captura de página inteira.
      if (pg.full) {
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
        await page.waitForTimeout(400);
      }
      const issues = [...(await audit(page)), ...errors];
      const file = path.join(OUT, `${pg.key}--${vp.name}.png`);
      await page.screenshot({ path: file, fullPage: Boolean(pg.full) });
      report.push({ viewport: vp.name, page: pg.key, issues });
      console.log(`${issues.length ? '✗' : '✓'} ${vp.name.padEnd(16)} ${pg.key.padEnd(18)} ${issues.join(' | ')}`);
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const failed = report.filter((r) => r.issues.length);
  console.log(`\n${report.length - failed.length}/${report.length} capturas sem problemas detectados. Capturas em ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
