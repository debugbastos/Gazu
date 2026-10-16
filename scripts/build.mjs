#!/usr/bin/env node
// Build de produção: bundle do cliente (JS + CSS com hash) e do servidor (dist/server.mjs).
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outdir = path.join(root, 'public/build');

export const clientOptions = (dev = false) => ({
  entryPoints: { app: path.join(root, 'src/client/main.tsx') },
  bundle: true,
  outdir,
  format: 'esm',
  splitting: false,
  target: ['es2020', 'chrome100', 'safari15', 'firefox100'],
  jsx: 'automatic',
  loader: { '.svg': 'text' },
  // Fontes e imagens são servidas de /public — não entram no bundle.
  external: ['/assets/*'],
  entryNames: dev ? '[name]' : '[name].[hash]',
  minify: !dev,
  sourcemap: dev ? 'inline' : true,
  metafile: true,
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  logLevel: 'info',
});

export function writeManifest(metafile) {
  const outs = Object.keys(metafile.outputs).map((f) => '/' + path.relative(path.join(root, 'public'), path.resolve(root, f)).split(path.sep).join('/'));
  const js = outs.find((f) => f.endsWith('.js'));
  const css = outs.find((f) => f.endsWith('.css'));
  fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify({ js, css }, null, 2));
  return { js, css };
}

async function main() {
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const client = await esbuild.build(clientOptions(false));
  const mf = writeManifest(client.metafile);
  console.log('Cliente:', mf);
  await esbuild.build({
    entryPoints: [path.join(root, 'src/server/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: path.join(root, 'dist/server.mjs'),
    packages: 'external',
    sourcemap: true,
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'info',
  });
  console.log('Servidor: dist/server.mjs');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
