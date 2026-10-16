import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { ROOT, env } from './config.ts';

export type Param = SQLInputValue | boolean | undefined;
type Row = Record<string, unknown>;

const norm = (params: Param[]): SQLInputValue[] =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

export class Database {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    // Normalização sem acentos/caixa para a busca ("tenis" encontra "Tênis").
    this.raw.function('gz_norm', { deterministic: true }, (s: unknown) => (s == null ? null : normalizeText(String(s))));
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...norm(params)) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...norm(params)) as T[];
  }

  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.raw.prepare(sql).run(...norm(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /**
   * Executa `fn` em uma transação. Usa BEGIN IMMEDIATE (trava de escrita desde o início),
   * o que evita condições de corrida no estoque. Chamadas aninhadas usam SAVEPOINT.
   */
  tx<T>(fn: () => T): T {
    const sp = `sp_${this.depth}`;
    if (this.depth === 0) this.raw.exec('BEGIN IMMEDIATE');
    else this.raw.exec(`SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      if (this.depth === 0) this.raw.exec('COMMIT');
      else this.raw.exec(`RELEASE ${sp}`);
      return result;
    } catch (err) {
      this.depth--;
      if (this.depth === 0) this.raw.exec('ROLLBACK');
      else this.raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    }
  }

  migrate(dir = path.join(ROOT, 'db/migrations')): string[] {
    this.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    const applied = new Set(this.all<{ version: string }>('SELECT version FROM schema_migrations').map((r) => r.version));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done: string[] = [];
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      this.tx(() => {
        this.raw.exec(sql);
        this.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', f, new Date().toISOString());
      });
      done.push(f);
    }
    return done;
  }

  close(): void {
    this.raw.close();
  }
}

let instance: Database | null = null;

export function getDb(): Database {
  if (!instance) {
    const file = env.DATABASE_PATH === ':memory:' ? ':memory:' : path.resolve(ROOT, env.DATABASE_PATH);
    instance = new Database(file);
  }
  return instance;
}

/** Usado pelos testes para injetar um banco isolado. */
export function setDb(db: Database | null): void {
  instance = db;
}

export const nowIso = (): string => new Date().toISOString();

export const normalizeText = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
