import { useEffect, useState, type FormEvent } from 'react';
import { useApi, useDocumentTitle, useMediaQuery } from '../lib/hooks';
import { Link, useSearchParams } from '../lib/router';
import { formatPrice } from '../../shared/format';
import type { CatalogResultDTO, FacetValue } from '../../shared/types';
import { ProductGrid, ProductGridSkeleton } from '../components/catalog/ProductCard';
import { Icon } from '../components/ui/Icon';
import { Breadcrumbs, Button, Checkbox, Dialog, EmptyState, ErrorState, Pagination } from '../components/ui/ui';
import { NotFoundPage } from './Static';

const FILTER_KEYS = ['publico', 'tamanho', 'cor', 'tipo'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
const FILTER_LABEL: Record<FilterKey, string> = { publico: 'Público', tamanho: 'Tamanho', cor: 'Cor', tipo: 'Tipo de produto' };

const getList = (sp: URLSearchParams, k: string) => (sp.get(k) ? sp.get(k)!.split(',').filter(Boolean) : []);

function FacetGroup({ k, values, selected, onToggle }: { k: FilterKey; values: FacetValue[]; selected: string[]; onToggle: (k: FilterKey, v: string) => void }) {
  const [open, setOpen] = useState(true);
  if (!values.length) return null;
  return (
    <fieldset className={`facet facet--${k}${open ? ' is-open' : ''}`}>
      <legend>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>{FILTER_LABEL[k]} <Icon name={open ? 'minus' : 'plus'} size={16} /></button>
      </legend>
      {open ? (
        k === 'tamanho' ? (
          <div className="facet__sizes">
            {values.map((v) => (
              <button type="button" key={v.value} className={`size-chip${selected.includes(v.value) ? ' is-selected' : ''}`} aria-pressed={selected.includes(v.value)} onClick={() => onToggle(k, v.value)}>{v.label}</button>
            ))}
          </div>
        ) : (
          <ul>
            {values.map((v) => (
              <li key={v.value}>
                <Checkbox
                  checked={selected.includes(v.value)}
                  onChange={() => onToggle(k, v.value)}
                  label={<>{k === 'cor' ? <span className="swatch swatch--inline" style={{ background: v.hex ?? '#ccc' }} aria-hidden="true" /> : null}{v.label} <span className="facet__count">({v.count})</span></>}
                />
              </li>
            ))}
          </ul>
        )
      ) : null}
    </fieldset>
  );
}

function PriceFilter({ min, max, bounds, onApply }: { min: string; max: string; bounds: { min: number; max: number }; onApply: (min: string, max: string) => void }) {
  const [lo, setLo] = useState(min ? String(Number(min) / 100) : '');
  const [hi, setHi] = useState(max ? String(Number(max) / 100) : '');
  useEffect(() => { setLo(min ? String(Number(min) / 100) : ''); setHi(max ? String(Number(max) / 100) : ''); }, [min, max]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const toCents = (s: string) => (s && Number(s) >= 0 ? String(Math.round(Number(s.replace(',', '.')) * 100)) : '');
    onApply(toCents(lo), toCents(hi));
  };
  return (
    <fieldset className="facet is-open">
      <legend><span>Faixa de preço</span></legend>
      <form className="price-filter" onSubmit={submit}>
        <label><span className="sr-only">Preço mínimo</span><input inputMode="decimal" placeholder={`Mín. ${formatPrice(bounds.min)}`} value={lo} onChange={(e) => setLo(e.target.value.replace(/[^\d,.]/g, ''))} /></label>
        <span aria-hidden="true">—</span>
        <label><span className="sr-only">Preço máximo</span><input inputMode="decimal" placeholder={`Máx. ${formatPrice(bounds.max)}`} value={hi} onChange={(e) => setHi(e.target.value.replace(/[^\d,.]/g, ''))} /></label>
        <Button variant="secondary" size="sm">Aplicar</Button>
      </form>
    </fieldset>
  );
}

export function CatalogPage({ category, search }: { category?: string; search?: boolean }) {
  const [sp, setSp] = useSearchParams();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const qs = new URLSearchParams(sp);
  if (category) qs.set('categoria', category);
  qs.set('por_pagina', '24');
  const q = sp.get('q') ?? '';
  const { data, error, loading, reload } = useApi<CatalogResultDTO>(search && !q ? null : `/api/catalog?${qs.toString()}`);
  useDocumentTitle(search ? (q ? `Busca: ${q}` : 'Busca') : data?.category?.name ?? null);

  const update = (mut: (n: URLSearchParams) => void, scroll = false) => {
    const n = new URLSearchParams(sp);
    mut(n);
    n.delete('pagina');
    setSp(n, { scroll });
  };
  const toggle = (k: FilterKey, v: string) => update((n) => {
    const cur = getList(n, k);
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    if (next.length) n.set(k, next.join(',')); else n.delete(k);
  });
  const clearAll = () => update((n) => { for (const k of [...FILTER_KEYS, 'min', 'max', 'estoque']) n.delete(k); });

  if (!search && !loading && !error && data && !data.category) return <NotFoundPage />;

  const chips: { key: string; label: string; remove: () => void }[] = [];
  for (const k of FILTER_KEYS) for (const v of getList(sp, k)) {
    const label = data?.facets[k === 'publico' ? 'audience' : k === 'tamanho' ? 'size' : k === 'cor' ? 'color' : 'type'].find((f) => f.value === v)?.label ?? v;
    chips.push({ key: `${k}:${v}`, label: `${FILTER_LABEL[k]}: ${label}`, remove: () => toggle(k, v) });
  }
  if (sp.get('min') || sp.get('max')) chips.push({ key: 'price', label: `Preço: ${sp.get('min') ? formatPrice(Number(sp.get('min'))) : '…'} – ${sp.get('max') ? formatPrice(Number(sp.get('max'))) : '…'}`, remove: () => update((n) => { n.delete('min'); n.delete('max'); }) });
  if (sp.get('estoque') === '1') chips.push({ key: 'stock', label: 'Somente disponíveis', remove: () => update((n) => n.delete('estoque')) });

  const filters = data ? (
    <div className="filters">
      <Checkbox checked={sp.get('estoque') === '1'} onChange={(v) => update((n) => (v ? n.set('estoque', '1') : n.delete('estoque')))} label="Somente disponíveis em estoque" />
      {(['publico', 'tipo', 'tamanho', 'cor'] as FilterKey[]).map((k) => (
        <FacetGroup key={k} k={k} values={data.facets[k === 'publico' ? 'audience' : k === 'tamanho' ? 'size' : k === 'cor' ? 'color' : 'type']} selected={getList(sp, k)} onToggle={toggle} />
      ))}
      {data.facets.price.max > 0 ? <PriceFilter min={sp.get('min') ?? ''} max={sp.get('max') ?? ''} bounds={data.facets.price} onApply={(lo, hi) => update((n) => { if (lo) n.set('min', lo); else n.delete('min'); if (hi) n.set('max', hi); else n.delete('max'); })} /> : null}
    </div>
  ) : null;

  const cat = data?.category;
  const title = search ? (q ? `Resultados para “${q}”` : 'Buscar produtos') : cat?.name ?? '';

  return (
    <div className="catalog container">
      {cat ? <Breadcrumbs items={cat.breadcrumbs} /> : search ? <Breadcrumbs items={[{ name: 'Início', href: '/' }, { name: 'Busca', href: '/busca' }]} /> : null}
      <header className="catalog__head">
        <div>
          <h1 className="catalog__title">{title || ' '}</h1>
          {cat?.description ? <p className="catalog__desc">{cat.description}</p> : null}
        </div>
        {cat && cat.subcategories.length ? (
          <nav className="subcats" aria-label="Subcategorias">
            {cat.subcategories.map((s) => <Link key={s.id} to={`/categoria/${s.slug}`} className="chip">{s.name}</Link>)}
          </nav>
        ) : null}
        {search ? <SearchBox initial={q} onSearch={(v) => update((n) => { n.set('q', v); })} /> : null}
      </header>

      {search && !q ? (
        <EmptyState title="Digite o que você procura" text="Busque por nome, categoria, cor ou tipo de peça." />
      ) : (
        <div className="catalog__layout">
          {isDesktop ? <aside className="catalog__aside" aria-label="Filtros">{filters}</aside> : null}
          <div className="catalog__main">
            <div className="catalog__toolbar">
              {!isDesktop ? <Button variant="secondary" size="sm" icon="filter" onClick={() => setFiltersOpen(true)}>Filtrar{chips.length ? ` (${chips.length})` : ''}</Button> : null}
              <p className="catalog__count" aria-live="polite">{data ? `${data.total} ${data.total === 1 ? 'produto' : 'produtos'}` : ' '}</p>
              <label className="sort">
                <span>Ordenar</span>
                <select value={sp.get('ordem') ?? ''} onChange={(e) => update((n) => (e.target.value ? n.set('ordem', e.target.value) : n.delete('ordem')))}>
                  <option value="">Relevância</option>
                  <option value="menor-preco">Menor preço</option>
                  <option value="maior-preco">Maior preço</option>
                  <option value="recentes">Mais recentes</option>
                </select>
                <Icon name="chevronDown" size={14} />
              </label>
            </div>
            {chips.length ? (
              <div className="active-filters" aria-label="Filtros ativos">
                {chips.map((c) => <button key={c.key} className="chip chip--removable" onClick={c.remove} aria-label={`Remover filtro ${c.label}`}>{c.label} <Icon name="close" size={14} /></button>)}
                <button className="link-btn" onClick={clearAll}>Limpar tudo</button>
              </div>
            ) : null}
            {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <ProductGridSkeleton count={8} /> : data && data.items.length === 0 ? (
              <EmptyState
                title={chips.length ? 'Nenhum produto com esses filtros' : search ? 'Nenhum produto encontrado' : 'Ainda não há produtos nesta categoria'}
                text={chips.length ? 'Remova alguns filtros para ver mais opções.' : search ? 'Verifique a ortografia ou tente termos mais gerais.' : 'Volte em breve — novas peças estão a caminho.'}
                action={chips.length ? <Button variant="secondary" size="sm" onClick={clearAll}>Limpar filtros</Button> : <Link to="/categoria/novidades" className="btn btn--secondary btn--sm">Ver novidades</Link>}
              />
            ) : data ? (
              <div className={loading ? 'is-refreshing' : ''} aria-busy={loading}>
                <ProductGrid products={data.items} priorityCount={4} className="product-grid--catalog" />
                <Pagination page={data.page} pages={data.pages} onPage={(pg) => { const n = new URLSearchParams(sp); n.set('pagina', String(pg)); setSp(n, { scroll: true }); }} />
              </div>
            ) : null}
          </div>
        </div>
      )}

      {!isDesktop ? (
        <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} variant="drawer-right" title="Filtrar" className="filter-drawer">
          <div className="filter-drawer__body">{filters}</div>
          <div className="filter-drawer__foot">
            <Button variant="secondary" onClick={clearAll}>Limpar</Button>
            <Button onClick={() => setFiltersOpen(false)}>Ver {data?.total ?? ''} produtos</Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function SearchBox({ initial, onSearch }: { initial: string; onSearch: (v: string) => void }) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <form role="search" className="search-inline" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSearch(v.trim()); }}>
      <Icon name="search" />
      <input type="search" value={v} onChange={(e) => setV(e.target.value)} placeholder="Buscar produtos" aria-label="Buscar produtos" maxLength={80} />
      <Button size="sm">Buscar</Button>
    </form>
  );
}
