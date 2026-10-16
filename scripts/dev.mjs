#!/usr/bin/env node
// Desenvolvimento: recompila o cliente a cada alteração e reinicia o servidor TypeScript (tsx) automaticamente.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as esbuild from 'esbuild';
import { clientOptions, writeManifest } from './build.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
fs.mkdirSync(path.join(root, 'public/build'), { recursive: true });

const ctx = await esbuild.context({
  ...clientOptions(true),
  plugins: [{ name: 'manifest', setup(b) { b.onEnd((r) => { if (r.metafile) writeManifest(r.metafile); }); } }],
});
await ctx.watch();

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--watch', '--watch-path=src/server', '--watch-path=src/shared', 'src/server/index.ts'], { cwd: root, stdio: 'inherit' });
const stop = () => { server.kill('SIGTERM'); void ctx.dispose(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
