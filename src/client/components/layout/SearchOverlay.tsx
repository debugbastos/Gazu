import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Link, useRouter } from '../../lib/router';
import { useStore } from '../../lib/store';
import type { ProductCardDTO } from '../../../shared/types';
import { Icon } from '../ui/Icon';
import { Dialog, Price } from '../ui/ui';

// Atalhos iniciais (termos do catálogo atual). Substituídos pelas buscas mais frequentes quando houver dados reais.
const SUGGESTIONS = ['Camiseta oversized', 'Tênis branco', 'Vestido longo', 'Conjunto infantil', 'Boné', 'Calça wide'];
interface SuggestResult { items: ProductCardDTO[]; total: number; correctedQuery?: string | null; suggestions?: string[]; categories?: { slug: string; name: string }[]; popular?: string[] }

export function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useStore();
  const { navigate } = useRouter();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 220);
  const [state, setState] = useState<SuggestResult & { loading: boolean; error: boolean }>({ items: [], total: 0, loading: false, error: false });
  const [popular, setPopular] = useState<string[]>([]);

  useEffect(() => {
    if (!searchOpen) return;
    api.get<SuggestResult>('/api/search/suggest?q=').then((r) => setPopular(r.popular ?? [])).catch(() => undefined);
  }, [searchOpen]);

  useEffect(() => {
    if (dq.length < 2) { setState({ items: [], total: 0, loading: false, error: false }); return; }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: false }));
    api.get<SuggestResult>(`/api/search/suggest?q=${encodeURIComponent(dq)}`, { signal: ctrl.signal })
      .then((r) => setState({ ...r, loading: false, error: false }))
      .catch(() => { if (!ctrl.signal.aborted) setState({ items: [], total: 0, loading: false, error: true }); });
    return () => ctrl.abort();
  }, [dq]);

  const close = () => setSearchOpen(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    close();
    navigate(`/busca?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <Dialog open={searchOpen} onClose={close} variant="fullscreen" labelledBy="search-title" className="search-overlay">
      <div className="search-overlay__inner container">
        <div className="search-overlay__top">
          <h2 id="search-title" className="eyebrow">Buscar na GAZU</h2>
          <button className="icon-btn" onClick={close} aria-label="Fechar busca"><Icon name="close" /></button>
        </div>
        <form role="search" onSubmit={submit} className="search-overlay__form">
          <Icon name="search" size={26} />
          <input data-autofocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="O que você procura?" aria-label="Buscar produtos" maxLength={80} autoComplete="off" />
          {q ? <button type="button" className="link-btn" onClick={() => setQ('')}>Limpar</button> : null}
        </form>
        <div className="search-overlay__results" aria-live="polite">
          {dq.length < 2 ? (
            <div className="search-overlay__suggest">
              <p className="eyebrow">{popular.length ? 'Mais buscados' : 'Sugestões'}</p>
              <ul>{(popular.length ? popular : SUGGESTIONS).map((s) => <li key={s}><button className="chip" onClick={() => setQ(s)}>{s}</button></li>)}</ul>
            </div>
          ) : state.loading && !state.items.length ? (
            <p className="muted">Buscando…</p>
          ) : state.error ? (
            <p className="muted">Não foi possível buscar agora. Tente novamente.</p>
          ) : state.items.length === 0 ? (
            <div className="search-overlay__suggest">
              <p className="muted">Nenhum produto encontrado para “{dq}”. Tente outro termo.</p>
              {state.suggestions?.length ? <ul>{state.suggestions.map((s) => <li key={s}><button className="chip" onClick={() => setQ(s)}>{s}</button></li>)}</ul> : null}
            </div>
          ) : (
            <>
              {state.correctedQuery ? <p className="muted small">Mostrando resultados para <strong>“{state.correctedQuery}”</strong>.</p> : null}
              {state.categories?.length ? <ul className="search-overlay__cats">{state.categories.map((c) => <li key={c.slug}><Link className="chip" to={`/categoria/${c.slug}`} onClick={close}>{c.name} <Icon name="arrowRight" size={14} /></Link></li>)}</ul> : null}
              <ul className="search-overlay__list">
                {state.items.map((p) => (
                  <li key={p.id}>
                    <Link to={`/produto/${p.slug}`} onClick={close}>
                      {p.image ? <img src={p.image.url} alt="" loading="lazy" style={{ objectPosition: p.image.position }} /> : <span />}
                      <span className="search-overlay__name">{p.name}{!p.available ? <em> · Esgotado</em> : null}</span>
                      <Price cents={p.priceCents} promoCents={p.promoPriceCents} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Link className="btn btn--secondary btn--md" to={`/busca?q=${encodeURIComponent(dq)}`} onClick={close}>Ver todos os {state.total} resultados</Link>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
