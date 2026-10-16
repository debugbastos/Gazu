#!/usr/bin/env node
// Gera dist/index.html: a loja GAZU inteira em UM arquivo (abre com duplo clique, sem servidor).
// Embute: aplicativo React, estilos, fontes, logomarca, fotos (modelos, produtos, editoriais) e o catálogo.
// Os dados ficam no armazenamento local do navegador; pagamento e frete são SIMULADOS (versão de demonstração).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'dist/index.html');

// 1. Catálogo de demonstração (banco novo em memória)
const seedJson = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'scripts/standalone-seed.ts'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GAZU_ROOT: root } });
const seed = JSON.parse(seedJson);

// 2. Imagens usadas pela loja → data URIs
const urls = new Set([
  ...seed.product_images.map((i) => i.url),
  ...seed.categories.map((c) => c.image_url).filter(Boolean),
]);
for (const f of ['src/client/components/home/Hero.tsx', 'src/client/pages/Home.tsx']) {
  for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/['"](\/assets\/[^'"]+\.(?:webp|png|jpe?g))['"]/g)) urls.add(m[1]);
}
const mime = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const images = {};
let imgBytes = 0;
for (const u of urls) {
  const file = path.join(root, 'public', u);
  if (!fs.existsSync(file)) { console.warn('Imagem ausente:', u); continue; }
  const buf = fs.readFileSync(file);
  imgBytes += buf.length;
  images[u] = `data:${mime[path.extname(file).toLowerCase()]};base64,${buf.toString('base64')}`;
}

// 3. Aplicativo: mesmo código do site, com roteador por hash e API local
const standalonePlugin = {
  name: 'gazu-standalone',
  setup(b) {
    // Qualquer import que aponte para src/client/lib/router ou src/client/lib/api (ex.: './api', '../lib/router')
    const swap = { [path.join(root, 'src/client/lib/router')]: 'router.tsx', [path.join(root, 'src/client/lib/api')]: 'api.ts' };
    b.onResolve({ filter: /(router|api)(\.tsx?)?$/ }, (args) => {
      if (!args.path.startsWith('.')) return undefined;
      const abs = path.resolve(args.resolveDir, args.path).replace(/\.tsx?$/, '');
      return swap[abs] ? { path: path.join(root, 'src/standalone', swap[abs]) } : undefined;
    });
    b.onResolve({ filter: /^\/assets\// }, (args) => ({ path: path.join(root, 'public', args.path) }));
  },
};
const result = await esbuild.build({
  entryPoints: [path.join(root, 'src/standalone/main.tsx')],
  bundle: true, write: false, outdir: path.join(root, 'dist/.standalone'), format: 'esm', target: ['es2020', 'chrome100', 'safari15', 'firefox100'],
  jsx: 'automatic', minify: true, legalComments: 'none',
  loader: { '.svg': 'text', '.woff': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [standalonePlugin], logLevel: 'warning',
});
const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = result.outputFiles.find((f) => f.path.endsWith('.css')).text.replace(/<\/style/gi, '<\\/style');

const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const favicon = `data:image/svg+xml;base64,${fs.readFileSync(path.join(root, 'public/favicon.svg')).toString('base64')}`;

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>GAZU — Moda que se move com você</title>
<meta name="description" content="GAZU — moda masculina, feminina e infantil, tênis e acessórios. Versão HTML de demonstração.">
<meta name="theme-color" content="#F7F6F3">
<link rel="icon" href="${favicon}" type="image/svg+xml">
<!--
  GAZU — versão HTML autônoma (demonstração visual e funcional).
  Abra este arquivo diretamente no navegador. Tudo funciona localmente: catálogo, filtros, busca, produto,
  sacola, favoritos, cadastro/login, checkout, pagamento SIMULADO, área do cliente e painel administrativo.
  Os dados ficam salvos apenas neste navegador. Não há cobrança, e-mail, login com Google ou frete real:
  para operar a loja de verdade use o projeto completo (README.md).
  Painel: admin@gazu.demo / gazu2026
-->
<style>${css}</style>
</head>
<body>
<div id="root"><noscript><p style="padding:24px;font-family:sans-serif">Ative o JavaScript para navegar na loja GAZU.</p></noscript></div>
<script id="gazu-seed" type="application/json">${safeJson(seed)}</script>
<script id="gazu-images" type="application/json">${safeJson(images)}</script>
<script type="module">${js}</script>
</body>
</html>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`dist/index.html — ${(html.length / 1024 / 1024).toFixed(1)} MB (${Object.keys(images).length} imagens, ${(imgBytes / 1024 / 1024).toFixed(1)} MB; ${seed.products.length} produtos)`);
