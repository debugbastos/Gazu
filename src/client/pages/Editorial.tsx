import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { Link, useRouter, useSearchParams } from '../lib/router';
import { useStore } from '../lib/store';
import { track } from '../lib/analytics';
import { formatDate, formatPrice } from '../../shared/format';
import type {
  ArticleCardDTO, ArticleDetailDTO, CollectionCardDTO, CollectionDetailDTO, FaqItemDTO, LookbookCardDTO, LookbookDetailDTO, PageDTO, QuickProductDTO,
} from '../../shared/types';
import { ProductGrid } from '../components/catalog/ProductCard';
import { ArticleCard, CollectionCard, LookbookCard, LookProductList, NewsletterForm, QuickAdd, ShoppableImage } from '../components/content/Editorial';
import { Icon } from '../components/ui/Icon';
import { Breadcrumbs, Button, DemoTag, EmptyState, ErrorState, Loading, Notice, Price } from '../components/ui/ui';
import { NotFoundPage } from './Static';

function Shell({ title, eyebrow, intro, crumbs, children, wide }: { title: string; eyebrow?: string; intro?: ReactNode; crumbs?: { name: string; href: string }[]; children: ReactNode; wide?: boolean }) {
  useDocumentTitle(title);
  return (
    <div className={`ed-page container${wide ? ' ed-page--wide' : ''}`}>
      <Breadcrumbs items={[{ name: 'Início', href: '/' }, ...(crumbs ?? [{ name: title, href: '#' }])]} />
      <header className="ed-page__head">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {intro ? <div className="ed-page__intro">{intro}</div> : null}
      </header>
      {children}
    </div>
  );
}

const notFound = (e: string | null) => Boolean(e && /não encontrad/i.test(e));

// ---------------------------------------------------------------------------------------------
// Coleções e Archive
// ---------------------------------------------------------------------------------------------
export function CollectionsPage() {
  const { data, error, loading, reload } = useApi<{ collections: CollectionCardDTO[] }>('/api/collections');
  return (
    <Shell title="Coleções" eyebrow="GAZU" intro={<p>Cápsulas e coleções com peças pensadas para combinar entre si.</p>}>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.collections.length ? (
        <EmptyState title="Nenhuma coleção publicada" text="As coleções aparecem aqui assim que forem publicadas." action={<Link to="/categoria/novidades" className="btn btn--secondary btn--sm">Ver novidades</Link>} />
      ) : (
        <div className="ed-grid ed-grid--collections">{data.collections.map((c, i) => <CollectionCard key={c.id} c={c} large={i === 0} />)}</div>
      )}
      <p className="ed-page__foot"><Link to="/archive" className="link-underline">Ver coleções anteriores no Archive</Link></p>
    </Shell>
  );
}

export function ArchivePage() {
  const { data, error, loading, reload } = useApi<{ collections: CollectionCardDTO[] }>('/api/archive');
  return (
    <Shell title="Archive" eyebrow="Coleções anteriores" intro={<p>O histórico das coleções GAZU. Algumas peças podem não estar mais disponíveis.</p>}>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.collections.length ? (
        <EmptyState title="O Archive ainda está vazio" text="Coleções encerradas passam a ficar disponíveis aqui." />
      ) : (
        <div className="ed-grid ed-grid--archive">{data.collections.map((c) => <CollectionCard key={c.id} c={c} />)}</div>
      )}
    </Shell>
  );
}

export function CollectionPage({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useApi<CollectionDetailDTO>(`/api/collections/${encodeURIComponent(slug)}`);
  if (loading && !data) return <div className="container page-pad"><Loading /></div>;
  if (notFound(error)) return <NotFoundPage />;
  if (error || !data) return <div className="container page-pad"><ErrorState message={error ?? 'Erro'} onRetry={reload} /></div>;
  const archived = data.status === 'archived';
  return (
    <Shell title={data.name} eyebrow={archived ? 'Archive' : data.season ?? 'Coleção'} crumbs={[{ name: archived ? 'Archive' : 'Coleções', href: archived ? '/archive' : '/colecoes' }, { name: data.name, href: `/colecao/${data.slug}` }]}
      intro={<>{data.description ? <p>{data.description}</p> : null}{data.isDemo ? <p><DemoTag>Coleção de demonstração</DemoTag></p> : null}</>}>
      {data.coverUrl ? <div className="ed-hero"><img src={data.coverUrl} alt={data.coverAlt ?? ''} /></div> : null}
      {archived ? <Notice tone="info">Coleção do Archive: peças marcadas como indisponíveis não podem mais ser compradas.</Notice> : null}
      {data.products.length ? <ProductGrid products={data.products} /> : <EmptyState title="Nenhuma peça nesta coleção ainda" />}
      {data.lookbooks.length ? (
        <section className="ed-section" aria-labelledby="col-looks">
          <h2 id="col-looks" className="ed-section__title">Looks da coleção</h2>
          <div className="ed-grid">{data.lookbooks.map((l) => <LookbookCard key={l.id} l={l} />)}</div>
        </section>
      ) : null}
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------
// Lookbook comprável
// ---------------------------------------------------------------------------------------------
export function LookbooksPage() {
  const { data, error, loading, reload } = useApi<{ lookbooks: LookbookCardDTO[] }>('/api/lookbooks');
  return (
    <Shell title="Lookbook" eyebrow="Looks completos" intro={<p>Composições para inspirar — compre cada peça direto da foto.</p>}>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.lookbooks.length ? (
        <EmptyState title="Nenhum lookbook publicado" action={<Link to="/monte-seu-look" className="btn btn--secondary btn--sm">Monte seu look</Link>} />
      ) : <div className="ed-grid">{data.lookbooks.map((l) => <LookbookCard key={l.id} l={l} />)}</div>}
    </Shell>
  );
}

export function LookbookPage({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useApi<LookbookDetailDTO>(`/api/lookbooks/${encodeURIComponent(slug)}`);
  const { addToCart, notify } = useStore();
  useEffect(() => { if (data) track({ event: 'lookbook_view', props: { slug: data.slug } }); }, [data]);
  if (loading && !data) return <div className="container page-pad"><Loading /></div>;
  if (notFound(error)) return <NotFoundPage />;
  if (error || !data) return <div className="container page-pad"><ErrorState message={error ?? 'Erro'} onRetry={reload} /></div>;
  const addAll = () => {
    // Adiciona a primeira variante disponível de cada peça (o cliente ajusta tamanhos na sacola).
    let n = 0;
    for (const p of data.products) {
      const v = p.variants.find((x) => x.stock > 0);
      if (v) { addToCart(v.id, 1); n++; }
    }
    notify(n ? `${n} peças do look adicionadas. Confira cores e tamanhos na sacola.` : 'As peças deste look estão esgotadas.', n ? 'success' : 'error', n ? { label: 'Ver sacola', href: '/carrinho' } : undefined);
  };
  const total = data.products.reduce((s, p) => s + (p.promoPriceCents ?? p.priceCents), 0);
  return (
    <Shell title={data.title} eyebrow="Lookbook" wide crumbs={[{ name: 'Lookbook', href: '/lookbook' }, { name: data.title, href: `/lookbook/${data.slug}` }]}
      intro={<>{data.description ? <p>{data.description}</p> : null}{data.collection ? <p><Link to={`/colecao/${data.collection.slug}`} className="link-underline">Coleção {data.collection.name}</Link></p> : null}</>}>
      <div className="look-layout">
        <div className="look-layout__media">{data.images.map((im) => <ShoppableImage key={im.id} image={im} products={data.products} title={data.title} />)}</div>
        <aside className="look-layout__side">
          <h2 className="ed-section__title">Peças do look</h2>
          {data.products.length ? (
            <>
              <LookProductList products={data.products} />
              <div className="look-total"><span>Look completo a partir de</span><strong>{formatPrice(total)}</strong></div>
              <Button block onClick={addAll}>Adicionar o look à sacola</Button>
              <p className="muted small">Adicionamos a primeira cor e tamanho disponíveis de cada peça. Ajuste na sacola antes de finalizar.</p>
            </>
          ) : <p className="muted">As peças deste look não estão disponíveis no momento.</p>}
        </aside>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------
// Monte seu look
// ---------------------------------------------------------------------------------------------
interface BuilderGroup { key: string; label: string; products: QuickProductDTO[] }
const AUDIENCES = [['', 'Todos'], ['feminino', 'Feminino'], ['masculino', 'Masculino'], ['menina', 'Menina'], ['menino', 'Menino']] as const;

export function LookBuilderPage() {
  const [sp, setSp] = useSearchParams();
  const audience = sp.get('publico') ?? '';
  const { data, error, loading, reload } = useApi<{ groups: BuilderGroup[] }>(`/api/looks/builder?publico=${encodeURIComponent(audience)}`);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const { addToCart, notify } = useStore();
  const [variantOf, setVariantOf] = useState<Record<number, number>>({});
  useEffect(() => { setPicked({}); setVariantOf({}); }, [audience]);
  const chosen = useMemo(() => (data?.groups ?? []).map((g) => g.products.find((p) => p.id === picked[g.key])).filter((p): p is QuickProductDTO => Boolean(p)), [data, picked]);
  const total = chosen.reduce((s, p) => s + (p.promoPriceCents ?? p.priceCents), 0);
  const addLook = () => {
    const missing = chosen.filter((p) => !variantOf[p.id]);
    if (missing.length) { notify(`Escolha o tamanho de: ${missing.map((m) => m.name).join(', ')}.`, 'error'); return; }
    for (const p of chosen) addToCart(variantOf[p.id]!, 1);
    notify(`Look com ${chosen.length} peças adicionado à sacola.`, 'success', { label: 'Ver sacola', href: '/carrinho' });
  };
  return (
    <Shell title="Monte seu look" eyebrow="Combine peças" intro={<p>Escolha uma peça de cada grupo, confira o total e leve o look completo. Preços e estoque são confirmados na sacola.</p>}>
      <div className="chips-row" role="radiogroup" aria-label="Público">
        {AUDIENCES.map(([v, l]) => <button key={v} role="radio" aria-checked={audience === v} className={`chip${audience === v ? ' is-selected' : ''}`} onClick={() => { const n = new URLSearchParams(sp); if (v) n.set('publico', v); else n.delete('publico'); setSp(n); }}>{l}</button>)}
      </div>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.groups.length ? <EmptyState title="Nenhuma peça disponível para montar looks agora" /> : (
        <div className="builder">
          <div className="builder__groups">
            {data.groups.map((g) => (
              <section key={g.key} className="builder__group" aria-labelledby={`bg-${g.key}`}>
                <h2 id={`bg-${g.key}`} className="ed-section__title">{g.label}</h2>
                <ul className="builder__row">
                  {g.products.map((p) => (
                    <li key={p.id}>
                      <button className={`builder__pick${picked[g.key] === p.id ? ' is-selected' : ''}`} aria-pressed={picked[g.key] === p.id} onClick={() => setPicked((s) => ({ ...s, [g.key]: s[g.key] === p.id ? 0 : p.id }))}>
                        {p.image ? <img src={p.image.url} alt="" loading="lazy" style={{ objectPosition: p.image.position }} /> : null}
                        <span>{p.name}</span>
                        <Price cents={p.priceCents} promoCents={p.promoPriceCents} size="sm" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <aside className="builder__summary" aria-live="polite">
            <h2 className="ed-section__title">Seu look</h2>
            {!chosen.length ? <p className="muted">Selecione as peças ao lado.</p> : (
              <ul className="builder__chosen">
                {chosen.map((p) => (
                  <li key={p.id}>
                    <strong>{p.name}</strong>
                    <div className="quick-add__sizes" role="radiogroup" aria-label={`Tamanho de ${p.name}`}>
                      {p.variants.filter((v) => v.stock > 0).slice(0, 12).map((v) => (
                        <button key={v.id} role="radio" aria-checked={variantOf[p.id] === v.id} className={`size-chip${variantOf[p.id] === v.id ? ' is-selected' : ''}`} onClick={() => setVariantOf((s) => ({ ...s, [p.id]: v.id }))} title={v.colorName}>
                          {v.size}{new Set(p.variants.map((x) => x.colorName)).size > 1 ? ` · ${v.colorName}` : ''}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="look-total"><span>Total do look</span><strong>{formatPrice(total)}</strong></div>
            <Button block disabled={!chosen.length} onClick={addLook}>Adicionar look à sacola</Button>
          </aside>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------
// GAZU Journal
// ---------------------------------------------------------------------------------------------
export function JournalPage() {
  const [sp, setSp] = useSearchParams();
  const cat = sp.get('categoria') ?? '';
  const { data, error, loading, reload } = useApi<{ articles: ArticleCardDTO[] }>(`/api/journal${cat ? `?categoria=${encodeURIComponent(cat)}` : ''}`);
  const all = useApi<{ articles: ArticleCardDTO[] }>('/api/journal');
  const cats = [...new Set((all.data?.articles ?? []).map((a) => a.category))];
  return (
    <Shell title="Journal" eyebrow="Editorial GAZU" intro={<p>Estilo, cuidados com as peças e bastidores da marca.</p>}>
      {cats.length > 1 ? (
        <div className="chips-row" role="radiogroup" aria-label="Categorias do Journal">
          <button role="radio" aria-checked={!cat} className={`chip${!cat ? ' is-selected' : ''}`} onClick={() => setSp(new URLSearchParams())}>Todos</button>
          {cats.map((c) => <button key={c} role="radio" aria-checked={cat === c} className={`chip${cat === c ? ' is-selected' : ''}`} onClick={() => setSp(new URLSearchParams({ categoria: c }))}>{c}</button>)}
        </div>
      ) : null}
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.articles.length ? <EmptyState title="Nenhum artigo publicado ainda" /> : (
        <div className="ed-grid ed-grid--journal">{data.articles.map((a) => <ArticleCard key={a.id} a={a} />)}</div>
      )}
    </Shell>
  );
}

export function ArticlePage({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useApi<ArticleDetailDTO>(`/api/journal/${encodeURIComponent(slug)}`);
  if (loading && !data) return <div className="container page-pad"><Loading /></div>;
  if (notFound(error)) return <NotFoundPage />;
  if (error || !data) return <div className="container page-pad"><ErrorState message={error ?? 'Erro'} onRetry={reload} /></div>;
  return (
    <Shell title={data.title} eyebrow={`Journal · ${data.category}`} crumbs={[{ name: 'Journal', href: '/journal' }, { name: data.title, href: `/journal/${data.slug}` }]}
      intro={<p className="muted">{data.author}{data.publishedAt ? ` · ${formatDate(data.publishedAt)}` : ''}{data.isDemo ? ' · conteúdo de demonstração' : ''}</p>}>
      <article className="article">
        {data.coverUrl ? <img className="article__cover" src={data.coverUrl} alt={data.coverAlt ?? ''} /> : null}
        <div className="prose" dangerouslySetInnerHTML={{ __html: data.html }} />
      </article>
      {data.products.length ? (
        <section className="ed-section" aria-labelledby="art-products">
          <h2 id="art-products" className="ed-section__title">Peças citadas</h2>
          <ProductGrid products={data.products} />
        </section>
      ) : null}
      <NewsletterForm source="journal" />
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------
// Páginas institucionais administráveis e Central de ajuda
// ---------------------------------------------------------------------------------------------
export function ContentPage({ slug, fallbackTitle }: { slug: string; fallbackTitle?: string }) {
  const { data, error, loading, reload } = useApi<PageDTO>(`/api/pages/${encodeURIComponent(slug)}`);
  if (loading && !data) return <div className="container page-pad"><Loading /></div>;
  if (notFound(error)) return <NotFoundPage />;
  if (error || !data) return <div className="container page-pad"><ErrorState message={error ?? 'Erro'} onRetry={reload} /></div>;
  return (
    <Shell title={data.title || fallbackTitle || ''}>
      <div className="prose doc__body" dangerouslySetInnerHTML={{ __html: data.html }} />
      <p className="muted small">Atualizado em {formatDate(data.updatedAt)}.</p>
    </Shell>
  );
}

const FAQ_LABEL: Record<string, string> = { geral: 'Geral', pedidos: 'Pedidos', pagamento: 'Pagamento', entrega: 'Entrega', trocas: 'Trocas e devoluções', produtos: 'Produtos e tamanhos', conta: 'Conta', privacidade: 'Privacidade' };

export function HelpPage() {
  const { data, error, loading, reload } = useApi<{ items: FaqItemDTO[] }>('/api/faq');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const items = (data?.items ?? []).filter((f) => !q.trim() || norm(`${f.question} ${f.html}`).includes(norm(q.trim())));
  const groups = [...new Set(items.map((f) => f.category))];
  return (
    <Shell title="Central de ajuda" eyebrow="Atendimento GAZU" intro={<p>Respostas rápidas sobre pedidos, pagamento, entrega, trocas e privacidade.</p>}>
      <nav className="help-links" aria-label="Atalhos de ajuda">
        {[['/rastreio', 'truck', 'Rastrear pedido'], ['/pagamento', 'wallet', 'Pagamento'], ['/entrega', 'truck', 'Entrega'], ['/trocas-e-devolucoes', 'returns', 'Trocas e devoluções'], ['/cancelamento', 'close', 'Cancelamento'], ['/atendimento', 'chat', 'Fale conosco']].map(([href, icon, label]) => (
          <Link key={href} to={href!} className="help-link"><Icon name={icon as 'truck'} size={22} /><span>{label}</span></Link>
        ))}
      </nav>
      <div className="search-inline help-search">
        <Icon name="search" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar na ajuda (ex.: prazo, Pix, troca)" aria-label="Buscar na ajuda" />
      </div>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !items.length ? (
        <EmptyState title="Nada encontrado" text="Tente outras palavras ou fale com a gente." action={<Link to="/atendimento" className="btn btn--secondary btn--sm">Abrir atendimento</Link>} />
      ) : groups.map((g) => (
        <section key={g} className="faq-group" aria-labelledby={`faq-${g}`}>
          <h2 id={`faq-${g}`} className="ed-section__title">{FAQ_LABEL[g] ?? g}</h2>
          {items.filter((f) => f.category === g).map((f) => (
            <div key={f.id} className={`accordion${open === f.id ? ' is-open' : ''}`}>
              <h3><button aria-expanded={open === f.id} aria-controls={`faq-a-${f.id}`} onClick={() => setOpen(open === f.id ? null : f.id)}><span>{f.question}</span><Icon name={open === f.id ? 'minus' : 'plus'} size={18} /></button></h3>
              <div id={`faq-a-${f.id}`} className="accordion__panel prose" hidden={open !== f.id} dangerouslySetInnerHTML={{ __html: f.html }} />
            </div>
          ))}
        </section>
      ))}
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------
// Newsletter: confirmação e descadastro (links do e-mail)
// ---------------------------------------------------------------------------------------------
export function NewsletterActionPage({ action }: { action: 'confirm' | 'unsubscribe' }) {
  const [sp] = useSearchParams();
  const { navigate } = useRouter();
  const token = action === 'confirm' ? sp.get('token') : sp.get('token') ?? sp.get('sair');
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; message?: string; email?: string }>({ status: 'loading' });
  useDocumentTitle(action === 'confirm' ? 'Confirmar inscrição' : 'Cancelar inscrição');
  useEffect(() => {
    if (!token) { setState({ status: 'error', message: 'Link incompleto.' }); return; }
    api.post<{ email: string }>(action === 'confirm' ? '/api/newsletter/confirm' : '/api/newsletter/unsubscribe', { token })
      .then((r) => setState({ status: 'ok', email: r.email }))
      .catch((e: unknown) => setState({ status: 'error', message: errorMessage(e) }));
  }, [action, token]);
  const unsubToken = sp.get('sair');
  return (
    <div className="container page-pad narrow-page">
      {state.status === 'loading' ? <Loading /> : state.status === 'error' ? <Notice tone="error" title="Não foi possível concluir">{state.message}</Notice> : action === 'confirm' ? (
        <>
          <h1 className="page-title">Inscrição confirmada</h1>
          <p>Pronto! <strong>{state.email}</strong> vai receber as novidades da GAZU.</p>
          {unsubToken ? <p className="muted small">Mudou de ideia? <button className="link-btn" onClick={() => navigate(`/newsletter/sair?token=${encodeURIComponent(unsubToken)}`)}>Cancelar inscrição</button></p> : null}
          <Link to="/" className="btn btn--primary btn--md">Ir para a loja</Link>
        </>
      ) : (
        <>
          <h1 className="page-title">Inscrição cancelada</h1>
          <p><strong>{state.email}</strong> não vai mais receber a newsletter da GAZU. E-mails sobre seus pedidos continuam sendo enviados.</p>
          <Link to="/" className="btn btn--secondary btn--md">Voltar à loja</Link>
        </>
      )}
    </div>
  );
}

export { QuickAdd };
