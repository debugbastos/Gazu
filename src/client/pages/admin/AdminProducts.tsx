import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Link, useRouter, useSearchParams } from '../../lib/router';
import { useStore } from '../../lib/store';
import { formatPrice, AUDIENCE_LABEL } from '../../../shared/format';
import type { CategoryDTO } from '../../../shared/types';
import { Icon } from '../../components/ui/Icon';
import { Button, ButtonLink, Checkbox, Dialog, EmptyState, ErrorState, Field, Loading, Notice, Pagination, SelectField, TextareaField } from '../../components/ui/ui';
import { AdminShell, fromCents, fromIso, toCents, toIso } from './Admin';
import { useCan } from './AdminKit';

interface ProductRow { id: number; slug: string; name: string; priceCents: number; promoPriceCents: number | null; isActive: number; isFeatured: number; isDemo: number; image: string | null; stock: number; variantCount: number; category: string | null; status: ProductStatus; issueCount: number; blocking: number }
type ProductStatus = 'published' | 'draft' | 'archived' | 'trash';
const STATUS_LABEL: Record<ProductStatus, string> = { published: 'Publicado', draft: 'Rascunho', archived: 'Arquivado', trash: 'Na lixeira' };

export function AdminProducts() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const qs = new URLSearchParams(sp);
  const { data, error, loading, reload } = useApi<{ items: ProductRow[]; total: number; page: number; pages: number }>(`/api/admin/products?${qs.toString()}`);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'pagina') n.delete('pagina'); setSp(n); };
  return (
    <AdminShell title="Produtos" actions={<ButtonLink to="/admin/produtos/novo" icon="plus">Novo produto</ButtonLink>}>
      <div className="admin-toolbar">
        <form role="search" onSubmit={(e) => { e.preventDefault(); set('q', q.trim()); }} className="admin-search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, slug ou SKU" aria-label="Buscar produtos" />
        </form>
        <div className="admin-tabs" role="tablist" aria-label="Filtrar">
          {[['', 'Todos'], ['ativos', 'Publicados'], ['rascunhos', 'Rascunhos'], ['arquivados', 'Arquivados'], ['sem-estoque', 'Sem estoque'], ['demo', 'Demonstração'], ['lixeira', 'Lixeira']].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={(sp.get('status') ?? '') === v} className={(sp.get('status') ?? '') === v ? 'is-active' : ''} onClick={() => set('status', v!)}>{l}</button>
          ))}
        </div>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data && data.items.length === 0 ? <EmptyState title="Nenhum produto encontrado" /> : data ? (
        <>
          <p className="muted small">{data.total} produtos</p>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--products">
              <thead><tr><th colSpan={2}>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Status</th></tr></thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="admin-thumb">{p.image ? <img src={p.image} alt="" loading="lazy" /> : null}</td>
                    <td><Link to={`/admin/produtos/${p.id}`} className="admin-link">{p.name}</Link><br /><small className="muted">{p.slug} · {p.variantCount} variantes</small></td>
                    <td>{p.category ?? '—'}</td>
                    <td>{p.promoPriceCents ? <><s className="muted">{formatPrice(p.priceCents)}</s><br />{formatPrice(p.promoPriceCents)}</> : formatPrice(p.priceCents)}</td>
                    <td className={p.stock === 0 ? 'is-danger' : ''}>{p.stock}</td>
                    <td className="admin-flags"><span className={`status${p.status === 'published' ? ' status--paid' : ''}`}>{STATUS_LABEL[p.status]}</span>{p.isFeatured ? <span className="status status--processing">Destaque</span> : null}{p.isDemo ? <span className="demo-tag">Demo</span> : null}{p.issueCount ? <Link to={`/admin/produtos/${p.id}#qualidade`} className={`sev sev--${p.blocking ? 'critical' : 'medium'}`}>{p.blocking ? `${p.blocking} bloqueio(s)` : `${p.issueCount} aviso(s)`}</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pages={data.pages} onPage={(pg) => set('pagina', String(pg))} />
        </>
      ) : null}
    </AdminShell>
  );
}

interface AdminImage { id: number; url: string; alt: string; colorName: string | null; position: number; objectPosition: string | null; width: number; height: number }
interface AdminVariant { id: number; sku: string; colorName: string; colorHex: string | null; size: string; sizeOrder: number; priceCents: number | null; costCents: number | null; stock: number; isActive: boolean }
interface AdminProduct {
  id: number; slug: string; name: string; description: string; details: string | null; audience: string; productType: string; priceCents: number; promoPriceCents: number | null;
  promoStartsAt: string | null; promoEndsAt: string | null; primaryCategoryId: number; isActive: boolean; isFeatured: boolean; isDemo: boolean; colorConfirmed: boolean;
  seoTitle: string | null; seoDescription: string | null; categoryIds: number[]; images: AdminImage[]; variants: AdminVariant[];
  brand: string | null; composition: string | null; careInstructions: string | null; fitNotes: string | null; costCents: number | null;
  weightGrams: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null; sizeGuideId: number | null;
  status: ProductStatus; issues: { code: string; severity: string; message: string; field?: string }[]; soldUnits: number; collectionIds: number[]; publishedAt: string | null;
}

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);

export function AdminProductEdit({ id }: { id: number | null }) {
  const { notify } = useStore();
  const { navigate } = useRouter();
  const prod = useApi<AdminProduct>(id ? `/api/admin/products/${id}` : null);
  const cats = useApi<{ categories: CategoryDTO[]; tree: CategoryDTO[] }>('/api/admin/categories');
  const guides = useApi<{ items: { id: number; name: string }[] }>('/api/admin/size-guides?pagina=1');
  const can = useCan();
  const blank = { name: '', slug: '', description: '', details: '', audience: 'unissex', productType: '', price: '', promo: '', promoStartsAt: '', promoEndsAt: '', categoryIds: [] as number[], primaryCategoryId: 0, isActive: false, isFeatured: false, isDemo: false, colorConfirmed: true, seoTitle: '', seoDescription: '', brand: 'GAZU', composition: '', careInstructions: '', fitNotes: '', cost: '', weightGrams: '', lengthCm: '', widthCm: '', heightCm: '', sizeGuideId: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const p = prod.data;

  useEffect(() => {
    if (!p) return;
    const n = (v: number | null) => (v == null ? '' : String(v));
    setF({ name: p.name, slug: p.slug, description: p.description, details: p.details ?? '', audience: p.audience, productType: p.productType, price: fromCents(p.priceCents), promo: fromCents(p.promoPriceCents), promoStartsAt: fromIso(p.promoStartsAt), promoEndsAt: fromIso(p.promoEndsAt), categoryIds: p.categoryIds, primaryCategoryId: p.primaryCategoryId, isActive: p.isActive, isFeatured: p.isFeatured, isDemo: p.isDemo, colorConfirmed: p.colorConfirmed, seoTitle: p.seoTitle ?? '', seoDescription: p.seoDescription ?? '',
      brand: p.brand ?? '', composition: p.composition ?? '', careInstructions: p.careInstructions ?? '', fitNotes: p.fitNotes ?? '', cost: fromCents(p.costCents), weightGrams: n(p.weightGrams), lengthCm: n(p.lengthCm), widthCm: n(p.widthCm), heightCm: n(p.heightCm), sizeGuideId: n(p.sizeGuideId) });
  }, [p]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const priceCents = toCents(f.price);
    const errs: Record<string, string> = {};
    if (!priceCents) errs.priceCents = 'Informe o preço.';
    if (f.promo && toCents(f.promo) === null) errs.promoPriceCents = 'Valor inválido.';
    if (!f.categoryIds.length) errs.categoryIds = 'Selecione ao menos uma categoria.';
    if (f.cost && toCents(f.cost) === null) errs.costCents = 'Valor inválido.';
    const int = (v: string) => (v.trim() ? Math.round(Number(v.replace(',', '.'))) : null);
    for (const k of ['weightGrams', 'lengthCm', 'widthCm', 'heightCm'] as const) if (f[k].trim() && !(Number(f[k].replace(',', '.')) > 0)) errs[k] = 'Número inválido.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const body = {
      name: f.name, slug: f.slug || slugify(f.name), description: f.description, details: f.details || null, audience: f.audience, productType: f.productType,
      priceCents, promoPriceCents: f.promo ? toCents(f.promo) : null, promoStartsAt: toIso(f.promoStartsAt), promoEndsAt: toIso(f.promoEndsAt),
      categoryIds: f.categoryIds, primaryCategoryId: f.categoryIds.includes(f.primaryCategoryId) ? f.primaryCategoryId : f.categoryIds[0],
      isActive: f.isActive, isFeatured: f.isFeatured, isDemo: f.isDemo, colorConfirmed: f.colorConfirmed, seoTitle: f.seoTitle || null, seoDescription: f.seoDescription || null,
      brand: f.brand || null, composition: f.composition || null, careInstructions: f.careInstructions || null, fitNotes: f.fitNotes || null,
      costCents: f.cost ? toCents(f.cost) : null, weightGrams: int(f.weightGrams), lengthCm: int(f.lengthCm), widthCm: int(f.widthCm), heightCm: int(f.heightCm),
      sizeGuideId: f.sizeGuideId ? Number(f.sizeGuideId) : null,
    };
    try {
      const r = id ? await api.put<AdminProduct>(`/api/admin/products/${id}`, body) : await api.post<AdminProduct>('/api/admin/products', body);
      notify('Produto salvo.', 'success');
      if (id) prod.setData(r); else navigate(`/admin/produtos/${r.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      notify(errorMessage(err), 'error');
    } finally { setSaving(false); }
  };

  const lifecycle = async (action: 'publish' | 'unpublish' | 'archive' | 'restore' | 'trash' | 'duplicate') => {
    if (!id) return;
    const confirmText: Partial<Record<typeof action, string>> = { archive: 'Arquivar este produto? Ele sai da loja, mas o histórico é mantido.', trash: 'Mover para a lixeira? O produto sai de coleções, looks e artigos. Pedidos antigos não são afetados.' };
    if (confirmText[action] && !window.confirm(confirmText[action])) return;
    setBusy(action);
    try {
      if (action === 'duplicate') { const r = await api.post<{ id: number }>(`/api/admin/products/${id}/duplicate`); notify('Cópia criada como rascunho (estoque zerado).', 'success'); navigate(`/admin/produtos/${r.id}`); return; }
      const r = action === 'trash' ? await api.del<AdminProduct>(`/api/admin/products/${id}`) : await api.post<AdminProduct>(`/api/admin/products/${id}/${action}`);
      prod.setData(r);
      notify({ publish: 'Produto publicado.', unpublish: 'Produto despublicado (rascunho).', archive: 'Produto arquivado.', restore: 'Produto restaurado como rascunho.', trash: 'Produto movido para a lixeira.' }[action], 'success');
    } catch (err) { notify(errorMessage(err), 'error'); } finally { setBusy(null); }
  };

  if (id && prod.loading && !p) return <AdminShell title="Produto"><Loading /></AdminShell>;
  if (id && prod.error && !p) return <AdminShell title="Produto"><ErrorState message={prod.error} onRetry={prod.reload} /></AdminShell>;
  const tree = cats.data?.tree ?? [];
  const toggleCat = (cid: number) => setF((s) => ({ ...s, categoryIds: s.categoryIds.includes(cid) ? s.categoryIds.filter((x) => x !== cid) : [...s.categoryIds, cid] }));

  return (
    <AdminShell title={p ? p.name : 'Novo produto'} actions={p ? <ButtonLink to={`/produto/${p.slug}`} variant="secondary" icon="external">Ver na loja</ButtonLink> : null}>
      <p><Link to="/admin/produtos" className="link-btn"><Icon name="arrowLeft" size={14} /> Produtos</Link></p>
      {p ? (
        <section className="admin-card admin-lifecycle" id="qualidade">
          <div className="admin-card__head">
            <h2>Status: {STATUS_LABEL[p.status]}</h2>
            <span className="muted small">{p.soldUnits} unidade(s) vendida(s){p.publishedAt ? ` · publicado em ${new Date(p.publishedAt).toLocaleDateString('pt-BR')}` : ''}</span>
          </div>
          {p.issues.length ? (
            <ul className="audit-codes">{p.issues.map((i) => <li key={i.code + (i.field ?? '')}><span className={`sev sev--${i.severity}`}>{i.severity === 'critical' ? 'Bloqueia publicação' : i.severity === 'high' ? 'Alto' : i.severity === 'medium' ? 'Médio' : 'Baixo'}</span> {i.message}</li>)}</ul>
          ) : <p className="muted small">Nenhum problema de qualidade encontrado.</p>}
          {can('catalog.write') ? (
            <div className="admin-row">
              {p.status === 'draft' ? <Button size="sm" loading={busy === 'publish'} onClick={() => void lifecycle('publish')}>Publicar</Button> : null}
              {p.status === 'published' ? <Button size="sm" variant="secondary" loading={busy === 'unpublish'} onClick={() => void lifecycle('unpublish')}>Despublicar</Button> : null}
              {p.status === 'draft' || p.status === 'published' ? <Button size="sm" variant="ghost" loading={busy === 'archive'} onClick={() => void lifecycle('archive')}>Arquivar</Button> : null}
              {p.status === 'archived' || p.status === 'trash' ? <Button size="sm" variant="secondary" loading={busy === 'restore'} onClick={() => void lifecycle('restore')}>Restaurar</Button> : null}
              {p.status !== 'trash' ? <Button size="sm" variant="ghost" loading={busy === 'duplicate'} onClick={() => void lifecycle('duplicate')}>Duplicar</Button> : null}
              {p.status !== 'trash' ? <Button size="sm" variant="danger" loading={busy === 'trash'} onClick={() => void lifecycle('trash')}>Mover para a lixeira</Button> : null}
            </div>
          ) : null}
        </section>
      ) : null}
      <form className="admin-form" onSubmit={save} noValidate>
        <section className="admin-card">
          <h2>Informações</h2>
          <div className="admin-fields">
            <Field label="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: id ? f.slug : slugify(e.target.value) })} error={errors.name} required className="span-2" />
            <Field label="Slug (URL)" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} error={errors.slug} hint={`/produto/${f.slug || '…'}`} />
            <Field label="Tipo de produto" value={f.productType} onChange={(e) => setF({ ...f, productType: e.target.value })} error={errors.productType} placeholder="Camiseta, Tênis…" />
            <SelectField label="Público" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
              {Object.entries(AUDIENCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectField>
            <Field label="Marca" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} optional />
            <TextareaField label="Descrição" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} error={errors.description} className="span-2" />
            <TextareaField label="Composição" value={f.composition} onChange={(e) => setF({ ...f, composition: e.target.value })} error={errors.composition} className="span-2" placeholder="Ex.: 100% algodão. Informe exatamente o que consta na etiqueta do fornecedor." />
            <TextareaField label="Cuidados" value={f.careInstructions} onChange={(e) => setF({ ...f, careInstructions: e.target.value })} className="span-2" placeholder="Ex.: Lavar à mão com água fria. Não usar alvejante." />
            <TextareaField label="Medidas e caimento" value={f.fitNotes} onChange={(e) => setF({ ...f, fitNotes: e.target.value })} className="span-2" placeholder="Ex.: Modelagem ampla. A modelo veste M e mede 1,72 m." />
            <TextareaField label="Detalhes adicionais" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} className="span-2" optional />
            <SelectField label="Guia de medidas" value={f.sizeGuideId} onChange={(e) => setF({ ...f, sizeGuideId: e.target.value })} className="span-2">
              <option value="">Guia padrão da categoria</option>
              {(guides.data?.items ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </SelectField>
          </div>
        </section>
        <section className="admin-card">
          <h2>Custo, peso e dimensões</h2>
          <div className="admin-fields">
            <Field label="Custo unitário (R$)" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} error={errors.costCents} optional placeholder="0,00" hint="Usado no cálculo de margem. Sem custo, o financeiro mostra a margem como indisponível." />
            <Field label="Peso com embalagem (g)" inputMode="numeric" value={f.weightGrams} onChange={(e) => setF({ ...f, weightGrams: e.target.value })} error={errors.weightGrams} optional hint="Necessário para cotação real de frete." />
            <Field label="Comprimento (cm)" inputMode="numeric" value={f.lengthCm} onChange={(e) => setF({ ...f, lengthCm: e.target.value })} error={errors.lengthCm} optional />
            <Field label="Largura (cm)" inputMode="numeric" value={f.widthCm} onChange={(e) => setF({ ...f, widthCm: e.target.value })} error={errors.widthCm} optional />
            <Field label="Altura (cm)" inputMode="numeric" value={f.heightCm} onChange={(e) => setF({ ...f, heightCm: e.target.value })} error={errors.heightCm} optional />
          </div>
          <p className="muted small">Sem medidas, o frete usa a embalagem padrão das Configurações. Variantes podem ter custo próprio.</p>
        </section>
        <section className="admin-card">
          <h2>Preço e promoção</h2>
          <div className="admin-fields">
            <Field label="Preço (R$)" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} error={errors.priceCents} placeholder="0,00" />
            <Field label="Preço promocional (R$)" inputMode="decimal" value={f.promo} onChange={(e) => setF({ ...f, promo: e.target.value })} error={errors.promoPriceCents} optional placeholder="0,00" />
            <Field label="Promoção começa" type="datetime-local" value={f.promoStartsAt} onChange={(e) => setF({ ...f, promoStartsAt: e.target.value })} optional />
            <Field label="Promoção termina" type="datetime-local" value={f.promoEndsAt} onChange={(e) => setF({ ...f, promoEndsAt: e.target.value })} error={errors.promoEndsAt} optional />
          </div>
          <p className="muted small">Variantes podem ter preço próprio. O preço final é sempre recalculado no servidor no checkout.</p>
        </section>
        <section className="admin-card">
          <h2>Categorias</h2>
          {errors.categoryIds ? <p className="field__error">{errors.categoryIds}</p> : null}
          <div className="admin-cats">
            {tree.map((root) => (
              <fieldset key={root.id}>
                <legend><Checkbox checked={f.categoryIds.includes(root.id)} onChange={() => toggleCat(root.id)} label={<strong>{root.name}</strong>} /></legend>
                {(root.children ?? []).map((c) => <Checkbox key={c.id} checked={f.categoryIds.includes(c.id)} onChange={() => toggleCat(c.id)} label={c.name} />)}
              </fieldset>
            ))}
          </div>
          {f.categoryIds.length > 1 ? (
            <SelectField label="Categoria principal (breadcrumbs e relacionados)" value={String(f.primaryCategoryId)} onChange={(e) => setF({ ...f, primaryCategoryId: Number(e.target.value) })} error={errors.primaryCategoryId}>
              {f.categoryIds.map((cid) => <option key={cid} value={cid}>{cats.data?.categories.find((c) => c.id === cid)?.name ?? cid}</option>)}
            </SelectField>
          ) : null}
        </section>
        <section className="admin-card">
          <h2>Publicação e SEO</h2>
          <div className="admin-checks">
            <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Publicado (visível na loja) — exige nome, descrição, categoria, foto, preço e variante ativa" />
            <Checkbox checked={f.isFeatured} onChange={(v) => setF({ ...f, isFeatured: v })} label="Destaque na home" />
            <Checkbox checked={f.colorConfirmed} onChange={(v) => setF({ ...f, colorConfirmed: v })} label="Cores confirmadas pelo fornecedor" />
            <Checkbox checked={f.isDemo} onChange={(v) => setF({ ...f, isDemo: v })} label="Produto de demonstração (preço/estoque ilustrativos)" />
          </div>
          <div className="admin-fields">
            <Field label="Título SEO" value={f.seoTitle} onChange={(e) => setF({ ...f, seoTitle: e.target.value })} maxLength={70} optional />
            <Field label="Descrição SEO" value={f.seoDescription} onChange={(e) => setF({ ...f, seoDescription: e.target.value })} maxLength={170} optional />
          </div>
        </section>
        <div className="admin-savebar"><Button loading={saving} size="lg">{id ? 'Salvar alterações' : 'Criar produto'}</Button></div>
      </form>
      {p ? <Variants product={p} onProduct={(np) => prod.setData(np)} /> : <Notice tone="info">Salve o produto para cadastrar variantes, estoque e imagens.</Notice>}
      {p ? <Images product={p} onProduct={(np) => prod.setData(np)} /> : null}
    </AdminShell>
  );
}

function Variants({ product, onProduct }: { product: AdminProduct; onProduct: (p: AdminProduct) => void }) {
  const { notify } = useStore();
  const [adding, setAdding] = useState(false);
  const [nv, setNv] = useState({ sku: '', colorName: '', colorHex: '#111111', size: '', sizeOrder: '0', price: '', cost: '', initialStock: '0' });
  const [editing, setEditing] = useState<AdminVariant | null>(null);
  const [ev, setEv] = useState({ sku: '', colorName: '', colorHex: '#111111', size: '', sizeOrder: '0', price: '', cost: '' });
  const [stockFor, setStockFor] = useState<AdminVariant | null>(null);
  const [adj, setAdj] = useState({ delta: '', reason: 'restock', note: '' });
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onProduct(await api.post<AdminProduct>(`/api/admin/products/${product.id}/variants`, { sku: nv.sku, colorName: nv.colorName, colorHex: nv.colorHex || null, size: nv.size, sizeOrder: Number(nv.sizeOrder) || 0, priceCents: nv.price ? toCents(nv.price) : null, costCents: nv.cost ? toCents(nv.cost) : null, isActive: true, initialStock: Number(nv.initialStock) || 0 }));
      setAdding(false);
      setNv({ ...nv, sku: '', size: '', initialStock: '0' });
      notify('Variante criada.', 'success');
    } catch (err) { notify(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  const toggle = async (v: AdminVariant) => {
    try {
      onProduct(await api.put<AdminProduct>(`/api/admin/variants/${v.id}`, { sku: v.sku, colorName: v.colorName, colorHex: v.colorHex, size: v.size, sizeOrder: v.sizeOrder, priceCents: v.priceCents, costCents: v.costCents, isActive: !v.isActive }));
    } catch (err) { notify(errorMessage(err), 'error'); }
  };
  const openEdit = (v: AdminVariant) => { setEditing(v); setEv({ sku: v.sku, colorName: v.colorName, colorHex: v.colorHex ?? '#111111', size: v.size, sizeOrder: String(v.sizeOrder), price: fromCents(v.priceCents), cost: fromCents(v.costCents) }); };
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      onProduct(await api.put<AdminProduct>(`/api/admin/variants/${editing.id}`, { sku: ev.sku, colorName: ev.colorName, colorHex: ev.colorHex || null, size: ev.size, sizeOrder: Number(ev.sizeOrder) || 0, priceCents: ev.price ? toCents(ev.price) : null, costCents: ev.cost ? toCents(ev.cost) : null, isActive: editing.isActive }));
      setEditing(null);
      notify('Variante atualizada.', 'success');
    } catch (err) { notify(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  const adjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!stockFor) return;
    const delta = Number(adj.delta);
    if (!Number.isInteger(delta) || delta === 0) { notify('Informe um número inteiro diferente de zero.', 'error'); return; }
    setBusy(true);
    try {
      onProduct(await api.post<AdminProduct>(`/api/admin/variants/${stockFor.id}/stock`, { delta, reason: adj.reason, note: adj.note || undefined }));
      setStockFor(null);
      setAdj({ delta: '', reason: 'restock', note: '' });
      notify('Estoque ajustado e registrado no histórico.', 'success');
    } catch (err) { notify(errorMessage(err), 'error'); } finally { setBusy(false); }
  };

  return (
    <section className="admin-card">
      <div className="admin-card__head"><h2>Variantes e estoque</h2><Button variant="secondary" size="sm" icon="plus" onClick={() => setAdding(true)}>Nova variante</Button></div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>SKU</th><th>Cor</th><th>Tamanho</th><th>Preço</th><th>Custo</th><th>Estoque</th><th>Ativa</th><th /></tr></thead>
          <tbody>
            {product.variants.map((v) => (
              <tr key={v.id} className={v.isActive ? '' : 'is-muted'}>
                <td><code>{v.sku}</code></td>
                <td><span className="swatch swatch--inline" style={{ background: v.colorHex ?? '#ccc' }} />{v.colorName}</td>
                <td>{v.size}</td>
                <td>{v.priceCents ? formatPrice(v.priceCents) : <span className="muted">do produto</span>}</td>
                <td>{v.costCents != null ? formatPrice(v.costCents) : product.costCents != null ? <span className="muted">do produto</span> : <span className="is-warn">não informado</span>}</td>
                <td className={v.stock === 0 ? 'is-danger' : v.stock <= 2 ? 'is-warn' : ''}>{v.stock}</td>
                <td><Checkbox checked={v.isActive} onChange={() => void toggle(v)} label={<span className="sr-only">Ativa</span>} /></td>
                <td className="admin-row"><button className="link-btn" onClick={() => openEdit(v)}>Editar</button><button className="link-btn" onClick={() => setStockFor(v)}>Ajustar estoque</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Nova variante">
        <form className="dialog__body" onSubmit={create}>
          <div className="admin-fields">
            <Field label="SKU" value={nv.sku} onChange={(e) => setNv({ ...nv, sku: e.target.value })} required />
            <Field label="Tamanho / numeração" value={nv.size} onChange={(e) => setNv({ ...nv, size: e.target.value })} required />
            <Field label="Nome da cor" value={nv.colorName} onChange={(e) => setNv({ ...nv, colorName: e.target.value })} required />
            <Field label="Cor (hex)" type="color" value={nv.colorHex} onChange={(e) => setNv({ ...nv, colorHex: e.target.value })} />
            <Field label="Ordem do tamanho" inputMode="numeric" value={nv.sizeOrder} onChange={(e) => setNv({ ...nv, sizeOrder: e.target.value })} />
            <Field label="Preço próprio (R$)" inputMode="decimal" value={nv.price} onChange={(e) => setNv({ ...nv, price: e.target.value })} optional />
            <Field label="Custo próprio (R$)" inputMode="decimal" value={nv.cost} onChange={(e) => setNv({ ...nv, cost: e.target.value })} optional />
            <Field label="Estoque inicial" inputMode="numeric" value={nv.initialStock} onChange={(e) => setNv({ ...nv, initialStock: e.target.value })} />
          </div>
          <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button><Button loading={busy}>Criar variante</Button></div>
        </form>
      </Dialog>
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={`Editar variante — ${editing?.sku ?? ''}`}>
        <form className="dialog__body" onSubmit={saveEdit}>
          <div className="admin-fields">
            <Field label="SKU" value={ev.sku} onChange={(e) => setEv({ ...ev, sku: e.target.value })} required />
            <Field label="Tamanho / numeração" value={ev.size} onChange={(e) => setEv({ ...ev, size: e.target.value })} required />
            <Field label="Nome da cor" value={ev.colorName} onChange={(e) => setEv({ ...ev, colorName: e.target.value })} required />
            <Field label="Cor (hex)" type="color" value={ev.colorHex} onChange={(e) => setEv({ ...ev, colorHex: e.target.value })} />
            <Field label="Ordem do tamanho" inputMode="numeric" value={ev.sizeOrder} onChange={(e) => setEv({ ...ev, sizeOrder: e.target.value })} />
            <Field label="Preço próprio (R$)" inputMode="decimal" value={ev.price} onChange={(e) => setEv({ ...ev, price: e.target.value })} optional />
            <Field label="Custo próprio (R$)" inputMode="decimal" value={ev.cost} onChange={(e) => setEv({ ...ev, cost: e.target.value })} optional />
          </div>
          <p className="muted small">Estoque não é editado aqui: use "Ajustar estoque" para manter o histórico.</p>
          <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={busy}>Salvar</Button></div>
        </form>
      </Dialog>
      <Dialog open={Boolean(stockFor)} onClose={() => setStockFor(null)} title={`Ajustar estoque — ${stockFor?.sku ?? ''}`}>
        <form className="dialog__body" onSubmit={adjust}>
          <p className="muted small">Estoque atual: <strong>{stockFor?.stock}</strong>. Use números negativos para baixas (avaria, perda). Cada ajuste fica registrado com autor e data.</p>
          <div className="admin-fields">
            <Field label="Quantidade (+/−)" inputMode="numeric" value={adj.delta} onChange={(e) => setAdj({ ...adj, delta: e.target.value })} placeholder="ex.: 10 ou -2" required />
            <SelectField label="Motivo" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })}>
              <option value="restock">Reposição</option>
              <option value="adjustment">Ajuste / inventário</option>
            </SelectField>
            <Field label="Observação" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} optional className="span-2" />
          </div>
          <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setStockFor(null)}>Cancelar</Button><Button loading={busy}>Registrar ajuste</Button></div>
        </form>
      </Dialog>
    </section>
  );
}

function Images({ product, onProduct }: { product: AdminProduct; onProduct: (p: AdminProduct) => void }) {
  const { notify } = useStore();
  const [uploading, setUploading] = useState(false);
  const colors = [...new Set(product.variants.map((v) => v.colorName))];
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { notify('Use JPG, PNG ou WebP.', 'error'); return; }
    if (file.size > 8 * 1024 * 1024) { notify('Imagem acima de 8 MB.', 'error'); return; }
    setUploading(true);
    try { onProduct(await api.upload<AdminProduct>(`/api/admin/products/${product.id}/images?alt=${encodeURIComponent(product.name)}`, file)); notify('Imagem enviada.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } finally { setUploading(false); }
  };
  const update = async (im: AdminImage, patch: Partial<AdminImage>) => {
    try { onProduct(await api.put<AdminProduct>(`/api/admin/images/${im.id}`, { alt: im.alt, colorName: im.colorName, position: im.position, objectPosition: im.objectPosition ?? 'center', ...patch })); } catch (err) { notify(errorMessage(err), 'error'); }
  };
  const remove = async (im: AdminImage) => {
    if (!window.confirm('Remover esta imagem do produto?')) return;
    try { onProduct(await api.del<AdminProduct>(`/api/admin/images/${im.id}`)); } catch (err) { notify(errorMessage(err), 'error'); }
  };
  return (
    <section className="admin-card">
      <div className="admin-card__head">
        <h2>Imagens</h2>
        <label className={`btn btn--secondary btn--sm${uploading ? ' is-loading' : ''}`}>
          <Icon name="plus" size={16} /> <span className="btn__label">{uploading ? 'Enviando…' : 'Enviar imagem'}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} disabled={uploading} />
        </label>
      </div>
      <p className="muted small">A primeira imagem (posição 0) é a principal. Associe uma cor para que a galeria troque as fotos ao selecionar a variante. Arquivos são validados pelo conteúdo e convertidos para WebP.</p>
      <ul className="admin-images">
        {product.images.map((im) => (
          <li key={im.id}>
            <img src={im.url} alt="" />
            <Field label="Texto alternativo" defaultValue={im.alt} onBlur={(e) => { if (e.target.value !== im.alt) void update(im, { alt: e.target.value }); }} />
            <SelectField label="Cor" value={im.colorName ?? ''} onChange={(e) => void update(im, { colorName: e.target.value || null })}>
              <option value="">Todas as cores</option>
              {colors.map((c) => <option key={c} value={c}>{c}</option>)}
            </SelectField>
            <Field label="Posição" inputMode="numeric" defaultValue={String(im.position)} onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== im.position) void update(im, { position: n }); }} />
            <button className="link-btn" onClick={() => void remove(im)}><Icon name="trash" size={14} /> Remover</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
