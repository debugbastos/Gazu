import fs from 'node:fs';
import path from 'node:path';
import { ROOT, env } from '../config.ts';
import { verifyBackupFile } from '../services/backup.ts';

// Restauração: npm run restore -- backups/gazu-AAAA-...db
// 1. PARE o servidor antes (o banco não pode estar em uso).
// 2. O arquivo é verificado (integridade, chaves estrangeiras, tabelas e migrations) ANTES de substituir.
// 3. O banco atual é preservado como <banco>.antes-da-restauracao-<data>.db (permite desfazer).
const src = process.argv[2];
if (!src) { console.error('Uso: npm run restore -- <arquivo-de-backup.db>'); process.exit(1); }
const file = path.resolve(process.cwd(), src);
const target = path.resolve(ROOT, env.DATABASE_PATH);
const check = verifyBackupFile(file, false);
for (const c of check.checks) console.log(`  ${c.ok ? 'OK ' : 'ERRO'}  ${c.name}: ${c.detail}`);
if (!check.ok) { console.error('Backup inválido — restauração cancelada. Nada foi alterado.'); process.exit(1); }
if (fs.existsSync(target)) {
  const keep = `${target}.antes-da-restauracao-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  fs.copyFileSync(target, keep);
  console.log(`Banco atual preservado em ${keep}`);
}
for (const ext of ['-wal', '-shm']) fs.rmSync(target + ext, { force: true });
fs.copyFileSync(file, target);
console.log(`Banco restaurado a partir de ${file}. Inicie o servidor novamente.`);
