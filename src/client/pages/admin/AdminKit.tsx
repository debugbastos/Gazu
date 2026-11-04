import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useApi, useDebounced } from '../../lib/hooks';
import { useSearchParams } from '../../lib/router';
import { useStore } from '../../lib/store';
import { Icon } from '../../components/ui/Icon';
import { Button, Checkbox, Dialog, EmptyState, ErrorState, Field, Loading, Notice, Pagination, SelectField, TextareaField } from '../../components/ui/ui';
import { AdminShell, fromCents, fromIso, toCents, toIso } from './Admin';

// Peças reutilizáveis do painel: permissões, recurso genérico (lista + editor), upload de imagem,
// seletor de produtos e filtro de período. A autorização real acontece no servidor.

export function useCan(): (perm: string) => boolean {
  const { user } = useStore();
  return (perm: string) => Boolean(user?.permissions?.includes(perm));
}

export const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------------------------------------
// Upload de imagem (o servidor valida o tipo real do arquivo e gera versões otimizadas)
// ---------------------------------------------------------------------------------------------
export function ImageField({ label, value, onChange, folder = 'conteudo', hint }: { label: string; value: string; onChange: (url: string, meta?: { width: number; height: number }) => void; folder?: string; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.upload<{ url: string; width: number; height: number }>(`/api/admin/uploads?pasta=${folder}`, file);
      onChange(r.url, { width: r.width, height: r.height });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="field image-field">
      <label>{label}</label>
      <div className="image-field__row">
        {value ? <img src={value} alt="" className="image-field__preview" /> : <span className="image-field__empty"><Icon name="layers" size={18} /></span>}
        <div className="image-field__ctrl">
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/uploads/... ou https://..." aria-label={`${label} (endereço)`} />
          <div className="admin-row">
            <label className="btn btn--secondary btn--sm image-field__btn">
              <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} disabled={busy} />
              <span className="btn__label">{busy ? 'Enviando…' : 'Enviar imagem'}</span>
            </label>
            {value ? <button type="button" className="link-btn" onClick={() => onChange('')}>Remover</button> : null}
          </div>
        </div>
      </div>
      {hint ? <p className="field__hint">{hint}</p> : null}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Seletor de produtos (busca no catálogo do painel)
// ---------------------------------------------------------------------------------------------
interface ProductHit { id: number; name: string; image: string | null; status: string; stock: number }
const productCache = new Map<number, ProductHit>();

export function ProductPicker({ label, value, onChange, max = 60, single }: { label: string; value: number[]; onChange: (ids: number[]) => void; max?: number; single?: boolean }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [, force] = useState(0);
  useEffect(() => {
    if (dq.length < 2) { setHits([]); return; }
    api.get<{ items: ProductHit[] }>(`/api/admin/products?q=${encodeURIComponent(dq)}`).then((r) => { r.items.forEach((p) => productCache.set(p.id, p)); setHits(r.items.slice(0, 8)); }).catch(() => setHits([]));
  }, [dq]);
  useEffect(() => {
    const missing = value.filter((id) => !productCache.has(id));
    if (!missing.length) return;
    // Carrega nomes dos produtos já selecionados.
    Promise.all(missing.slice(0, 40).map((id) => api.get<{ id: number; name: string; images: { url: string }[]; status: string; variants: { stock: number }[] }>(`/api/admin/products/${id}`).then((p) => productCache.set(id, { id, name: p.name, image: p.images[0]?.url ?? null, status: p.status, stock: p.variants.reduce((s, v) => s + v.stock, 0) })).catch(() => undefined)))
      .then(() => force((n) => n + 1));
  }, [value]);
  const add = (id: number) => { if (single) onChange([id]); else if (!value.includes(id) && value.length < max) onChange([...value, id]); setQ(''); setHits([]); };
  const move = (i: number, d: number) => { const n = [...value]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j]!, n[i]!]; onChange(n); };
  return (
    <div className="field product-picker">
      <label>{label}</label>
      <div className="product-picker__search">
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto por nome ou SKU" aria-label={`${label}: buscar`} />
      </div>
      {hits.length ? (
        <ul className="product-picker__hits" role="listbox">
          {hits.map((h) => <li key={h.id}><button type="button" onClick={() => add(h.id)} disabled={value.includes(h.id)}>{h.image ? <img src={h.image} alt="" /> : <span />}<span>{h.name}<small> · {h.status === 'published' ? 'publicado' : h.status} · estoque {h.stock}</small></span></button></li>)}
        </ul>
      ) : null}
      {value.length ? (
        <ol className="product-picker__chosen">
          {value.map((id, i) => {
            const p = productCache.get(id);
            return (
              <li key={id}>
                {p?.image ? <img src={p.image} alt="" /> : <span />}
                <span>{p?.name ?? `Produto #${id}`}{p && p.status !== 'published' ? <small className="muted"> · {p.status}</small> : null}</span>
                {!single ? <><button type="button" className="icon-btn" onClick={() => move(i, -1)} aria-label="Mover para cima"><Icon name="chevronLeft" size={14} /></button><button type="button" className="icon-btn" onClick={() => move(i, 1)} aria-label="Mover para baixo"><Icon name="chevronRight" size={14} /></button></> : null}
                <button type="button" className="icon-btn" onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Remover"><Icon name="close" size={14} /></button>
              </li>
            );
          })}
        </ol>
      ) : <p className="field__hint">Nenhum produto selecionado.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Filtro de período (datas em horário de Brasília; padrão: últimos 30 dias)
// ---------------------------------------------------------------------------------------------
export function PeriodFilter({ onChange }: { onChange: (qs: string) => void }) {
  const [sp, setSp] = useSearchParams();
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const back = (d: number) => new Date(Date.now() - 3 * 3600_000 - d * 86400_000).toISOString().slice(0, 10);
  const [de, setDe] = useState(sp.get('de') ?? back(29));
  const [ate, setAte] = useState(sp.get('ate') ?? today);
  const apply = (a: string, b: string) => { setDe(a); setAte(b); const n = new URLSearchParams(sp); n.set('de', a); n.set('ate', b); setSp(n); onChange(`de=${a}&ate=${b}`); };
  useEffect(() => { onChange(`de=${de}&ate=${ate}`); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return (
    <form className="period" onSubmit={(e) => { e.preventDefault(); apply(de, ate); }}>
      <label><span>De</span><input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} /></label>
      <label><span>Até</span><input type="date" value={ate} min={de} max={today} onChange={(e) => setAte(e.target.value)} /></label>
      <Button size="sm" variant="secondary">Aplicar</Button>
      <div className="admin-tabs">
        {[[0, 'Hoje'], [6, '7 dias'], [29, '30 dias'], [89, '90 dias']].map(([d, l]) => <button type="button" key={l} onClick={() => apply(back(d as number), today)}>{l}</button>)}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Recurso genérico (CRUD) — lista com busca/filtros + editor em diálogo
// ---------------------------------------------------------------------------------------------
export type FieldType = 'text' | 'textarea' | 'markdown' | 'number' | 'money' | 'select' | 'checkbox' | 'datetime' | 'date' | 'image' | 'products' | 'product' | 'slug' | 'url' | 'table';
export interface FieldDef { key: string; label: string; type: FieldType; options?: [string, string][]; required?: boolean; hint?: string; span?: boolean; slugFrom?: string; folder?: string; default?: unknown; nullable?: boolean }
export interface Column { key: string; label: string; render?: (row: Record<string, unknown>) => ReactNode }
export interface ResourceConfig {
  name: string; title: string; singular: string; feminine?: boolean; fields: FieldDef[]; columns: Column[]; write: string;
  filters?: { param: string; label: string; options: [string, string][] }[]; intro?: ReactNode; searchPlaceholder?: string; deletable?: boolean;
  rowActions?: (row: Record<string, unknown>, reload: () => void) => ReactNode; afterEditor?: (id: number | null, close: () => void) => ReactNode;
}

type Values = Record<string, unknown>;

function toForm(fields: FieldDef[], row: Values | null): Values {
  const v: Values = {};
  for (const f of fields) {
    const raw = row ? row[f.key] : f.default;
    if (f.type === 'money') v[f.key] = raw == null ? '' : fromCents(raw as number);
    else if (f.type === 'datetime') v[f.key] = fromIso(raw as string | null);
    else if (f.type === 'checkbox') v[f.key] = row ? Boolean(raw) : f.default ?? true;
    else if (f.type === 'products') v[f.key] = (raw as number[] | undefined) ?? [];
    else if (f.type === 'product') v[f.key] = raw ? [raw as number] : [];
    else if (f.type === 'table') v[f.key] = row && row.head ? { head: row.head, rows: row.rows } : { head: ['Tamanho', 'Medida (cm)'], rows: [['P', '']] };
    else v[f.key] = raw == null ? '' : String(raw);
  }
  return v;
}

function toBody(fields: FieldDef[], v: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    const x = v[f.key];
    if (f.type === 'money') out[f.key] = x === '' ? null : toCents(String(x));
    else if (f.type === 'number') out[f.key] = x === '' ? (f.nullable ? null : 0) : Number(x);
    else if (f.type === 'datetime') out[f.key] = toIso(String(x ?? ''));
    else if (f.type === 'checkbox') out[f.key] = Boolean(x);
    else if (f.type === 'products') out[f.key] = x;
    else if (f.type === 'product') out[f.key] = (x as number[])[0] ?? null;
    else if (f.type === 'select' && f.nullable && x === '') out[f.key] = null;
    else if (f.type === 'table') { const t = x as { head: string[]; rows: string[][] }; out.head = t.head; out.rows = t.rows; }
    else out[f.key] = x === '' && !f.required ? null : x;
  }
  return out;
}

function TableEditor({ value, onChange }: { value: { head: string[]; rows: string[][] }; onChange: (v: { head: string[]; rows: string[][] }) => void }) {
  const setHead = (i: number, s: string) => onChange({ ...value, head: value.head.map((h, j) => (j === i ? s : h)) });
  const setCell = (r: number, c: number, s: string) => onChange({ ...value, rows: value.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? s : x)) : row)) });
  return (
    <div className="table-editor">
      <table>
        <thead><tr>{value.head.map((h, i) => <th key={i}><input value={h} onChange={(e) => setHead(i, e.target.value)} aria-label={`Coluna ${i + 1}`} /></th>)}<th /></tr></thead>
        <tbody>{value.rows.map((row, r) => <tr key={r}>{row.map((c, i) => <td key={i}><input value={c} onChange={(e) => setCell(r, i, e.target.value)} aria-label={`Linha ${r + 1}, coluna ${i + 1}`} /></td>)}<td><button type="button" className="icon-btn" onClick={() => onChange({ ...value, rows: value.rows.filter((_, i) => i !== r) })} aria-label="Remover linha"><Icon name="close" size={14} /></button></td></tr>)}</tbody>
      </table>
      <div className="admin-row">
        <button type="button" className="link-btn" onClick={() => onChange({ ...value, rows: [...value.rows, value.head.map(() => '')] })}>+ Linha</button>
        <button type="button" className="link-btn" onClick={() => value.head.length < 8 && onChange({ head: [...value.head, 'Nova coluna'], rows: value.rows.map((r) => [...r, '']) })}>+ Coluna</button>
        {value.head.length > 2 ? <button type="button" className="link-btn" onClick={() => onChange({ head: value.head.slice(0, -1), rows: value.rows.map((r) => r.slice(0, -1)) })}>− Coluna</button> : null}
      </div>
    </div>
  );
}

export function FieldInput({ f, v, set, errors }: { f: FieldDef; v: Values; set: (k: string, x: unknown) => void; errors: Record<string, string> }) {
  const val = v[f.key];
  const cls = f.span || ['textarea', 'markdown', 'image', 'products', 'table'].includes(f.type) ? 'span-2' : undefined;
  const err = errors[f.key];
  switch (f.type) {
    case 'textarea': case 'markdown':
      return <TextareaField label={f.label} value={String(val ?? '')} onChange={(e) => set(f.key, e.target.value)} error={err} className={cls} rows={f.type === 'markdown' ? 12 : 4} />;
    case 'select':
      return <SelectField label={f.label} value={String(val ?? '')} onChange={(e) => set(f.key, e.target.value)} error={err} className={cls}>{f.nullable ? <option value="">—</option> : null}{(f.options ?? []).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>;
    case 'checkbox':
      return <div className={cls ?? 'span-2'}><Checkbox checked={Boolean(val)} onChange={(x) => set(f.key, x)} label={f.label} /></div>;
    case 'image':
      return <div className={cls}><ImageField label={f.label} value={String(val ?? '')} onChange={(u) => set(f.key, u)} folder={f.folder} hint={f.hint} />{err ? <p className="field__error">{err}</p> : null}</div>;
    case 'products': case 'product':
      return <div className={cls ?? 'span-2'}><ProductPicker label={f.label} value={(val as number[]) ?? []} onChange={(ids) => set(f.key, ids)} single={f.type === 'product'} />{err ? <p className="field__error">{err}</p> : null}</div>;
    case 'table':
      return <div className={cls}><p className="field-legend">{f.label}</p><TableEditor value={val as { head: string[]; rows: string[][] }} onChange={(t) => set(f.key, t)} />{errors.rows ? <p className="field__error">{errors.rows}</p> : null}</div>;
    case 'datetime':
      return <Field label={f.label} type="datetime-local" value={String(val ?? '')} onChange={(e) => set(f.key, e.target.value)} error={err} hint={f.hint} optional={!f.required} className={cls} />;
    case 'date':
      return <Field label={f.label} type="date" value={String(val ?? '')} onChange={(e) => set(f.key, e.target.value)} error={err} required={f.required} className={cls} />;
    default:
      return <Field label={f.label} value={String(val ?? '')} onChange={(e) => set(f.key, e.target.value)} error={err} hint={f.hint} optional={!f.required && f.type !== 'slug'} required={f.required} inputMode={f.type === 'number' || f.type === 'money' ? 'decimal' : undefined} className={cls} />;
  }
}

export function ResourceEditor({ cfg, id, onClose, onSaved }: { cfg: ResourceConfig; id: number | null; onClose: () => void; onSaved: (row: Values) => void }) {
  const { notify } = useStore();
  const [values, setValues] = useState<Values | null>(id ? null : toForm(cfg.fields, null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(id);
  useEffect(() => {
    if (!id) return;
    api.get<Values>(`/api/admin/${cfg.name}/${id}`).then((row) => setValues(toForm(cfg.fields, row))).catch((e: unknown) => notify(errorMessage(e), 'error'));
  }, [id, cfg, notify]);
  const set = (k: string, x: unknown) => setValues((v) => {
    const next = { ...v!, [k]: x };
    for (const f of cfg.fields) if (f.type === 'slug' && f.slugFrom === k && !savedId) next[f.key] = slugify(String(x));
    return next;
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!values) return;
    setSaving(true);
    setErrors({});
    try {
      const body = toBody(cfg.fields, values);
      const row = savedId ? await api.put<Values>(`/api/admin/${cfg.name}/${savedId}`, body) : await api.post<Values>(`/api/admin/${cfg.name}`, body);
      setSavedId(row.id as number);
      notify(`${cfg.singular} ${cfg.feminine ? 'salva' : 'salvo'}.`, 'success');
      onSaved(row);
      if (!cfg.afterEditor) onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      notify(errorMessage(err), 'error');
    } finally { setSaving(false); }
  };
  return (
    <Dialog open onClose={onClose} title={`${savedId ? 'Editar' : cfg.feminine ? 'Nova' : 'Novo'} ${cfg.singular.toLowerCase()}`} className="admin-dialog">
      {!values ? <div className="dialog__body"><Loading /></div> : (
        <form className="dialog__body" onSubmit={save} noValidate>
          <div className="admin-fields">{cfg.fields.map((f) => <FieldInput key={f.key} f={f} v={values} set={set} errors={errors} />)}</div>
          {cfg.afterEditor ? cfg.afterEditor(savedId, onClose) : null}
          <div className="dialog__actions"><Button type="button" variant="ghost" onClick={onClose}>Fechar</Button><Button loading={saving}>Salvar</Button></div>
        </form>
      )}
    </Dialog>
  );
}

export function ResourcePage({ cfg, embedded }: { cfg: ResourceConfig; embedded?: boolean }) {
  const can = useCan();
  const { notify } = useStore();
  const [sp, setSp] = useSearchParams();
  const qs = new URLSearchParams();
  for (const k of ['q', 'pagina', ...(cfg.filters ?? []).map((f) => f.param)]) { const x = sp.get(k); if (x) qs.set(k, x); }
  const { data, error, loading, reload } = useApi<{ items: Values[]; total: number; page: number; pages: number }>(`/api/admin/${cfg.name}?${qs.toString()}`);
  const [edit, setEdit] = useState<{ id: number | null } | null>(null);
  const [q, setQ] = useState(sp.get('q') ?? '');
  const writable = can(cfg.write);
  const setParam = (k: string, x: string) => { const n = new URLSearchParams(sp); if (x) n.set(k, x); else n.delete(k); if (k !== 'pagina') n.delete('pagina'); setSp(n); };
  const remove = async (row: Values) => {
    if (!window.confirm(`Excluir "${String(row.name ?? row.title ?? row.message ?? row.question ?? row.description ?? row.id)}"?`)) return;
    try { await api.del(`/api/admin/${cfg.name}/${row.id as number}`); notify('Excluído.', 'info'); reload(); } catch (e) { notify(errorMessage(e), 'error'); }
  };
  const body = (
    <>
      {cfg.intro ? <div className="admin-intro muted small">{cfg.intro}</div> : null}
      <div className="admin-toolbar">
        <form role="search" className="admin-search" onSubmit={(e) => { e.preventDefault(); setParam('q', q.trim()); }}>
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={cfg.searchPlaceholder ?? 'Buscar'} aria-label={`Buscar em ${cfg.title}`} />
        </form>
        {(cfg.filters ?? []).map((f) => (
          <div key={f.param} className="admin-tabs" role="tablist" aria-label={f.label}>
            {[['', 'Todos'] as [string, string], ...f.options].map(([k, l]) => <button key={k} role="tab" aria-selected={(sp.get(f.param) ?? '') === k} className={(sp.get(f.param) ?? '') === k ? 'is-active' : ''} onClick={() => setParam(f.param, k)}>{l}</button>)}
          </div>
        ))}
        {writable ? <Button size="sm" icon="plus" onClick={() => setEdit({ id: null })}>{cfg.feminine ? 'Nova' : 'Novo'} {cfg.singular.toLowerCase()}</Button> : null}
      </div>
      {!writable ? <Notice tone="info">Sua função permite apenas visualizar esta seção.</Notice> : null}
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.items.length ? <EmptyState title="Nenhum registro" text={writable ? 'Crie o primeiro registro pelo botão acima.' : undefined} /> : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr>{cfg.columns.map((c) => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id as number}>
                    {cfg.columns.map((c, i) => <td key={c.key}>{i === 0 ? <button className="admin-link" onClick={() => setEdit({ id: row.id as number })}>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</button> : c.render ? c.render(row) : String(row[c.key] ?? '—')}</td>)}
                    <td className="admin-table__actions">
                      {cfg.rowActions?.(row, reload)}
                      {writable && cfg.deletable !== false ? <button className="icon-btn" onClick={() => void remove(row)} aria-label="Excluir"><Icon name="trash" size={16} /></button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pages={data.pages} onPage={(pg) => setParam('pagina', String(pg))} />
        </>
      )}
      {edit ? <ResourceEditor cfg={cfg} id={edit.id} onClose={() => setEdit(null)} onSaved={() => reload()} /> : null}
    </>
  );
  return embedded ? body : <AdminShell title={cfg.title}>{body}</AdminShell>;
}

export function Bool({ v, yes = 'Sim', no = 'Não' }: { v: unknown; yes?: string; no?: string }) {
  return <span className={`status${v ? ' status--paid' : ''}`}>{v ? yes : no}</span>;
}
export const dt = (v: unknown) => (v ? new Date(String(v)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
