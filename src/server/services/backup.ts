import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, env } from '../config.ts';
import { getDb, nowIso } from '../db.ts';
import { HttpError } from '../http.ts';
import { logError } from './monitoring.ts';

// Backups do banco SQLite.
// - Cópia consistente com VACUUM INTO (não bloqueia leituras, funciona com WAL).
// - Cada arquivo recebe SHA-256 e é VERIFICADO: aberto em modo somente leitura, integrity_check,
//   tabelas essenciais, migrations e contagem de registros comparada com o banco em uso (teste de restauração).
// - Retenção: mantém os BACKUP_RETENTION backups mais recentes.
// - Cópia externa (outro servidor/nuvem) NÃO é feita por este módulo: depende do provedor de hospedagem
//   (ver docs/OPERACAO-BACKUP.md). Sem essa cópia, um backup no mesmo disco não protege contra perda do disco.

export const backupDir = () => path.resolve(ROOT, env.BACKUP_DIR);
const ESSENTIAL = ['users', 'products', 'product_variants', 'orders', 'order_items', 'payments', 'inventory_movements', 'schema_migrations'];

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function runBackup(kind: 'auto' | 'manual'): { id: number; file: string; sizeBytes: number; sha256: string } {
  const db = getDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupDir(), `gazu-${stamp}-${kind}.db`);
  try {
    db.backupTo(file);
    const size = fs.statSync(file).size;
    const hash = sha256File(file);
    const id = db.run("INSERT INTO backups (file, size_bytes, sha256, kind, status) VALUES (?, ?, ?, ?, 'ok')", path.basename(file), size, hash, kind).lastInsertRowid;
    applyRetention();
    return { id, file, sizeBytes: size, sha256: hash };
  } catch (e) {
    db.run("INSERT INTO backups (file, size_bytes, sha256, kind, status, detail) VALUES (?, 0, '', ?, 'failed', ?)", path.basename(file), kind, String((e as Error).message).slice(0, 300));
    logError('critical', 'backup', e);
    throw e;
  }
}

export interface VerifyResult { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] }

/** Teste de restauração: abre a cópia isolada e confere integridade e conteúdo. */
export function verifyBackupFile(file: string, compareWithLive = true): VerifyResult {
  const checks: VerifyResult['checks'] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  if (!fs.existsSync(file)) return { ok: false, checks: [{ name: 'arquivo', ok: false, detail: 'Arquivo não encontrado.' }] };
  // Restaura em um arquivo temporário (nunca sobre o banco em uso) e valida a cópia restaurada.
  const tmp = path.join(path.dirname(file), `.restore-test-${process.pid}-${Date.now()}.db`);
  fs.copyFileSync(file, tmp);
  let restored: DatabaseSync | null = null;
  try {
    restored = new DatabaseSync(tmp, { readOnly: true });
    const integrity = (restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    add('integridade (PRAGMA integrity_check)', integrity === 'ok', integrity);
    const fk = restored.prepare('PRAGMA foreign_key_check').all();
    add('chaves estrangeiras', fk.length === 0, fk.length ? `${fk.length} referência(s) inválida(s)` : 'ok');
    const tables = new Set((restored.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    const missingTables = ESSENTIAL.filter((t) => !tables.has(t));
    add('tabelas essenciais', missingTables.length === 0, missingTables.length ? `ausentes: ${missingTables.join(', ')}` : `${ESSENTIAL.length} presentes`);
    const migrations = (restored.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: string }[]).map((m) => m.version);
    add('migrations', migrations.length > 0, migrations.join(', '));
    if (compareWithLive && !missingTables.length) {
      const live = getDb();
      for (const t of ['orders', 'products', 'payments']) {
        const a = (restored.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
        const b = live.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n;
        // O banco em uso pode ter crescido depois do backup; menos registros no backup é esperado, mais não.
        add(`registros em ${t}`, a <= b, `backup ${a} · em uso ${b}`);
      }
    }
  } catch (e) {
    add('abertura do arquivo', false, String((e as Error).message));
  } finally {
    restored?.close();
    fs.rmSync(tmp, { force: true });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

export function verifyBackup(id: number): VerifyResult {
  const db = getDb();
  const b = db.get<{ file: string; sha256: string; status: string }>('SELECT file, sha256, status FROM backups WHERE id = ?', id);
  if (!b || b.status === 'removed' || b.status === 'failed') throw new HttpError(404, 'Backup indisponível.', 'not_found');
  const file = path.join(backupDir(), b.file);
  const result = fs.existsSync(file) ? verifyBackupFile(file) : { ok: false, checks: [{ name: 'arquivo', ok: false, detail: 'Arquivo não encontrado.' }] };
  if (fs.existsSync(file)) {
    const hashOk = sha256File(file) === b.sha256;
    result.checks.unshift({ name: 'SHA-256', ok: hashOk, detail: hashOk ? 'confere' : 'diferente do registrado (arquivo alterado ou corrompido)' });
    result.ok = result.ok && hashOk;
  }
  db.run('UPDATE backups SET status = ?, verified_at = ?, detail = ? WHERE id = ?', result.ok ? 'verified' : 'failed', nowIso(), JSON.stringify(result.checks).slice(0, 1000), id);
  if (!result.ok) logError('critical', 'backup:verify', `Backup #${id} falhou na verificação`, { checks: result.checks });
  return result;
}

export function applyRetention(): number {
  const db = getDb();
  const keep = env.BACKUP_RETENTION;
  const old = db.all<{ id: number; file: string }>("SELECT id, file FROM backups WHERE status IN ('ok','verified') ORDER BY id DESC LIMIT -1 OFFSET ?", keep);
  for (const b of old) {
    fs.rmSync(path.join(backupDir(), b.file), { force: true });
    db.run("UPDATE backups SET status = 'removed' WHERE id = ?", b.id);
  }
  return old.length;
}

export function listBackups() {
  return getDb().all('SELECT id, file, size_bytes AS sizeBytes, sha256, kind, status, detail, created_at AS createdAt, verified_at AS verifiedAt FROM backups ORDER BY id DESC LIMIT 60');
}

/** Rotina automática: cria um backup se o último tiver mais de BACKUP_INTERVAL_HOURS e o verifica. */
export function scheduledBackup(): { created: boolean; verified?: boolean } {
  if (!env.BACKUP_INTERVAL_HOURS || env.DATABASE_PATH === ':memory:') return { created: false };
  const last = getDb().get<{ created_at: string }>("SELECT created_at FROM backups WHERE status IN ('ok','verified') ORDER BY id DESC LIMIT 1");
  if (last && Date.now() - Date.parse(last.created_at) < env.BACKUP_INTERVAL_HOURS * 3600_000) return { created: false };
  const b = runBackup('auto');
  return { created: true, verified: verifyBackup(b.id).ok };
}
