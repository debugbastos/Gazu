import type { ZodTypeAny } from 'zod';
import { getDb, nowIso, type Param } from '../db.ts';
import { HttpError, intParam, requirePermission, type Ctx, type Router } from '../http.ts';
import type { Permission } from '../auth/permissions.ts';
import { audit } from './audit.ts';

/**
 * Fábrica de recursos administráveis (CRUD) com validação Zod, permissões no servidor,
 * transação, unicidade, relações N:N ordenadas e auditoria. Evita duplicar a mesma lógica
 * para anúncios, banners, coleções, lookbooks, Journal, páginas, FAQ, campanhas, despesas etc.
 */
export interface Relation {
  key: string;            // chave no corpo/DTO (ex.: productIds)
  table: string;          // tabela de junção
  fk: string;             // coluna que aponta para o recurso
  otherFk: string;        // coluna que aponta para o item relacionado
  check?: string;         // tabela usada para validar a existência (ex.: products)
}

export interface ResourceDef {
  name: string;           // segmento da URL: /api/admin/<name>
  table: string;
  entity: string;         // nome usado na auditoria
  read: Permission;
  write: Permission;
  schema: ZodTypeAny;
  columns: Record<string, string>;
  unique?: string[];
  search?: string[];
  filters?: Record<string, string>;   // ?param= → coluna
  orderBy?: string;
  relations?: Relation[];
  softDelete?: boolean;               // usa deleted_at
  deletable?: boolean;
  beforeSave?: (data: Record<string, unknown>, id: number | null, ctx: Ctx) => void;
  afterSave?: (id: number, data: Record<string, unknown>, created: boolean) => void;
  beforeDelete?: (id: number) => void;
  toDTO?: (row: Record<string, unknown>) => Record<string, unknown>;
  pageSize?: number;
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function rowToDTO(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = k.startsWith('is_') ? Boolean(v) : v;
  return out;
}

function hasColumn(table: string, col: string): boolean {
  return getDb().all<{ name: string }>(`PRAGMA table_info(${table})`).some((c) => c.name === col);
}

export function loadResource(def: ResourceDef, id: number): Record<string, unknown> | null {
  const db = getDb();
  const row = db.get<Record<string, unknown>>(`SELECT * FROM ${def.table} WHERE id = ?${def.softDelete ? ' AND deleted_at IS NULL' : ''}`, id);
  if (!row) return null;
  const dto = def.toDTO ? def.toDTO(row) : rowToDTO(row);
  for (const rel of def.relations ?? []) {
    const hasPos = hasColumn(rel.table, 'position');
    dto[rel.key] = db.all<{ v: number }>(`SELECT ${rel.otherFk} AS v FROM ${rel.table} WHERE ${rel.fk} = ?${hasPos ? ' ORDER BY position' : ''}`, id).map((r) => r.v);
  }
  return dto;
}

export function registerResource(r: Router, def: ResourceDef): void {
  const base = `/api/admin/${def.name}`;
  const touch = hasColumnSafe(def.table, 'updated_at');

  r.get(base, (ctx) => {
    requirePermission(ctx, def.read);
    const sp = ctx.url.searchParams;
    const where: string[] = def.softDelete ? ['deleted_at IS NULL'] : ['1=1'];
    const params: Param[] = [];
    const q = (sp.get('q') ?? '').trim();
    if (q && def.search?.length) {
      where.push(`(${def.search.map((c) => `gz_norm(${c}) LIKE gz_norm(?)`).join(' OR ')})`);
      for (let i = 0; i < def.search.length; i++) params.push(`%${q}%`);
    }
    for (const [param, col] of Object.entries(def.filters ?? {})) {
      const v = sp.get(param);
      if (v) { where.push(`${col} = ?`); params.push(v); }
    }
    const size = def.pageSize ?? 50;
    const page = Math.max(1, Number(sp.get('pagina') ?? 1) || 1);
    const db = getDb();
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${def.table} WHERE ${where.join(' AND ')}`, ...params)!.n;
    const rows = db.all<{ id: number }>(`SELECT id FROM ${def.table} WHERE ${where.join(' AND ')} ORDER BY ${def.orderBy ?? 'id DESC'} LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size);
    return { items: rows.map((x) => loadResource(def, x.id)), total, page, pages: Math.max(1, Math.ceil(total / size)) };
  });

  r.get(`${base}/:id`, (ctx) => {
    requirePermission(ctx, def.read);
    const item = loadResource(def, intParam(ctx.params.id));
    if (!item) throw new HttpError(404, 'Registro não encontrado.', 'not_found');
    return item;
  });

  const save = async (ctx: Ctx, id: number | null) => {
    const admin = requirePermission(ctx, def.write);
    const data = (await ctx.body(def.schema)) as Record<string, unknown>;
    const db = getDb();
    for (const key of def.unique ?? []) {
      const col = def.columns[key]!;
      if (data[key] !== undefined && data[key] !== null && db.get(`SELECT 1 FROM ${def.table} WHERE ${col} = ? AND id <> ?`, data[key] as Param, id ?? 0)) {
        throw new HttpError(409, 'Já existe um registro com este valor.', 'duplicate', { fieldErrors: { [key]: ['Valor já utilizado.'] } });
      }
    }
    def.beforeSave?.(data, id, ctx);
    const keys = Object.keys(def.columns).filter((k) => data[k] !== undefined);
    const savedId = db.tx(() => {
      let rowId = id;
      if (id) {
        if (!db.get(`SELECT 1 FROM ${def.table} WHERE id = ?${def.softDelete ? ' AND deleted_at IS NULL' : ''}`, id)) throw new HttpError(404, 'Registro não encontrado.', 'not_found');
        const sets = keys.map((k) => `${def.columns[k]} = ?`);
        if (touch) sets.push('updated_at = ?');
        if (sets.length) db.run(`UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = ?`, ...keys.map((k) => data[k] as Param), ...(touch ? [nowIso()] : []), id);
      } else {
        rowId = db.run(`INSERT INTO ${def.table} (${keys.map((k) => def.columns[k]).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map((k) => data[k] as Param)).lastInsertRowid;
      }
      for (const rel of def.relations ?? []) {
        const list = data[rel.key];
        if (!Array.isArray(list)) continue;
        const ids = [...new Set(list.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
        if (rel.check && ids.length) {
          const found = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${rel.check} WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)!.n;
          if (found !== ids.length) throw new HttpError(400, 'Há itens relacionados inexistentes.', 'bad_relation', { fieldErrors: { [rel.key]: ['Item inexistente.'] } });
        }
        db.run(`DELETE FROM ${rel.table} WHERE ${rel.fk} = ?`, rowId!);
        const hasPos = hasColumn(rel.table, 'position');
        ids.forEach((other, i) => db.run(`INSERT INTO ${rel.table} (${rel.fk}, ${rel.otherFk}${hasPos ? ', position' : ''}) VALUES (?, ?${hasPos ? ', ?' : ''})`, rowId!, other, ...(hasPos ? [i] : [])));
      }
      def.afterSave?.(rowId!, data, !id);
      audit({ actor: `admin:${admin.id}`, action: `${def.entity}.${id ? 'update' : 'create'}`, entity: def.entity, entityId: rowId, data, ip: ctx.ip });
      return rowId!;
    });
    return loadResource(def, savedId);
  };

  r.post(base, (ctx) => save(ctx, null));
  r.put(`${base}/:id`, (ctx) => save(ctx, intParam(ctx.params.id)));

  if (def.deletable !== false) {
    r.delete(`${base}/:id`, (ctx) => {
      const admin = requirePermission(ctx, def.write);
      const id = intParam(ctx.params.id);
      const db = getDb();
      db.tx(() => {
        if (!db.get(`SELECT 1 FROM ${def.table} WHERE id = ?`, id)) throw new HttpError(404, 'Registro não encontrado.', 'not_found');
        def.beforeDelete?.(id);
        if (def.softDelete) db.run(`UPDATE ${def.table} SET deleted_at = ? WHERE id = ?`, nowIso(), id);
        else db.run(`DELETE FROM ${def.table} WHERE id = ?`, id);
        audit({ actor: `admin:${admin.id}`, action: `${def.entity}.delete`, entity: def.entity, entityId: id, ip: ctx.ip });
      });
      return { ok: true };
    });
  }
}

const colCache = new Map<string, boolean>();
function hasColumnSafe(table: string, col: string): boolean {
  const k = `${table}.${col}`;
  if (!colCache.has(k)) {
    try { colCache.set(k, hasColumn(table, col)); } catch { return false; }
  }
  return colCache.get(k)!;
}
