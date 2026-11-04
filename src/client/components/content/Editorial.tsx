import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { Link } from '../../lib/router';
import { useStore } from '../../lib/store';
import { getConsent, onConsentChange, setConsent, track } from '../../lib/analytics';
import { localViewed } from '../../lib/recent';
import { formatDate } from '../../../shared/format';
import type { ArticleCardDTO, CollectionCardDTO, LookbookCardDTO, LookbookImageDTO, ProductCardDTO, QuickProductDTO } from '../../../shared/types';
import { ProductGrid } from '../catalog/ProductCard';
import { Icon } from '../ui/Icon';
import { Button, Checkbox, DemoTag, Price } from '../ui/ui';

// ---------------------------------------------------------------------------------------------
// Cartões editoriais
// ---------------------------------------------------------------------------------------------
export function CollectionCard({ c, large }: { c: CollectionCardDTO; large?: boolean }) {
  return (
    <Link to={`/colecao/${c.slug}`} className={`ed-card${large ? ' ed-card--large' : ''}`}>
      <span className="ed-card__media">{c.coverUrl ? <img src={c.coverUrl} alt={c.coverAlt ?? ''} loading="lazy" decoding="async" /> : <span className="ed-card__ph" aria-hidden="true">GAZU</span>}</span>
      <span className="ed-card__body">
        {c.season ? <span className="eyebrow">{c.season}</span> : null}
        <span className="ed-card__title">{c.name}</span>
        <span className="ed-card__meta">{c.productCount} {c.productCount === 1 ? 'peça' : 'peças'}{c.isDemo ? ' · demonstração' : ''}</span>
      </span>
    </Link>
  );
}

export function ArticleCard({ a }: { a: ArticleCardDTO }) {
  return (
    <Link to={`/journal/${a.slug}`} className="ed-card ed-card--article">
      <span className="ed-card__media">{a.coverUrl ? <img src={a.coverUrl} alt={a.coverAlt ?? ''} loading="lazy" decoding="async" /> : <span className="ed-card__ph" aria-hidden="true">Journal</span>}</span>
      <span className="ed-card__body">
        <span className="eyebrow">{a.category}{a.publishedAt ? ` · ${formatDate(a.publishedAt)}` : ''}</span>
        <span className="ed-card__title">{a.title}</span>
        <span className="ed-card__excerpt">{a.excerpt}</span>
        {a.isDemo ? <DemoTag>Conteúdo de demonstração</DemoTag> : null}
      </span>
    </Link>
  );
}

export function LookbookCard({ l }: { l: LookbookCardDTO }) {
  return (
    <Link to={`/lookbook/${l.slug}`} className="ed-card ed-card--look">
      <span className="ed-card__media">{l.coverUrl ? <img src={l.coverUrl} alt="" loading="lazy" decoding="async" /> : <span className="ed-card__ph" aria-hidden="true">Look</span>}</span>
      <span className="ed-card__body">
        <span className="eyebrow">Lookbook</span>
        <span className="ed-card__title">{l.title}</span>
        <span className="ed-card__meta">{l.productCount} {l.productCount === 1 ? 'produto' : 'produtos'} para comprar{l.isDemo ? ' · demonstração' : ''}</span>
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------
// Compra rápida (cor + tamanho) — preço e estoque vêm do servidor e são revalidados no carrinho
// ---------------------------------------------------------------------------------------------
export function QuickAdd({ product, compact, onAdded }: { product: QuickProductDTO; compact?: boolean; onAdded?: () => void }) {
  const { addToCart, notify } = useStore();
  const colors = useMemo(() => [...new Map(product.variants.map((v) => [v.colorName, v.colorHex])).entries()], [product]);
  const [color, setColor] = useState(() => product.variants.find((v) => v.stock > 0)?.colorName ?? colors[0]?.[0] ?? '');
  const sizes = product.variants.filter((v) => v.colorName === color);
  const [size, setSize] = useState<number | null>(() => (sizes.length === 1 && sizes[0]!.stock > 0 ? sizes[0]!.id : null));
  const v = product.variants.find((x) => x.id === size) ?? null;
  const add = () => {
    if (!v) { notify('Escolha um tamanho.', 'error'); return; }
    addToCart(v.id, 1);
    track({ event: 'add_to_cart', productId: product.id, valueCents: v.promoPriceCents ?? v.priceCents });
    notify(`${product.name} (${v.colorName}, ${v.size}) adicionado à sacola.`, 'success', { label: 'Ver sacola', href: '/carrinho' });
    onAdded?.();
  };
  return (
    <div className={`quick-add${compact ? ' quick-add--compact' : ''}`}>
      {colors.length > 1 ? (
        <div className="quick-add__colors" role="radiogroup" aria-label={`Cor de ${product.name}`}>
          {colors.map(([name, hex]) => (
            <button key={name} role="radio" aria-checked={color === name} className={`swatch-btn${color === name ? ' is-selected' : ''}`} onClick={() => { setColor(name); setSize(null); }} title={name}>
              <span style={{ background: hex ?? '#ccc' }} aria-hidden="true" /><span className="sr-only">{name}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="quick-add__sizes" role="radiogroup" aria-label={`Tamanho de ${product.name}`}>
        {sizes.map((s) => (
          <button key={s.id} role="radio" aria-checked={size === s.id} aria-disabled={s.stock <= 0} className={`size-chip${size === s.id ? ' is-selected' : ''}${s.stock <= 0 ? ' is-out' : ''}`} onClick={() => s.stock > 0 && setSize(s.id)}>
            {s.size}{s.stock <= 0 ? <span className="sr-only"> (esgotado)</span> : null}
          </button>
        ))}
      </div>
      <Button size="sm" variant={compact ? 'secondary' : 'primary'} onClick={add} disabled={!product.available}>{product.available ? 'Adicionar' : 'Esgotado'}</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Lookbook comprável: pontos interativos sobre a foto
// ---------------------------------------------------------------------------------------------
export function ShoppableImage({ image, products, title }: { image: LookbookImageDTO; products: QuickProductDTO[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const byId = new Map(products.map((p) => [p.id, p]));
  const spots = image.hotspots.filter((h) => h.x !== null && h.y !== null && byId.has(h.productId));
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <figure className="shoppable">
      <div className="shoppable__frame" style={image.width && image.height ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}>
        <img src={image.url} alt={image.alt || title} loading="lazy" decoding="async" />
        {spots.map((h, i) => {
          const p = byId.get(h.productId)!;
          return (
            <div key={h.id} className={`hotspot${open === h.id ? ' is-open' : ''}${h.x! > 60 ? ' hotspot--left' : ''}`} style={{ left: `${h.x}%`, top: `${h.y}%` }}>
              <button className="hotspot__dot" aria-expanded={open === h.id} aria-label={`${h.label ?? p.name}: ver produto ${i + 1} de ${spots.length}`} onClick={() => { setOpen(open === h.id ? null : h.id); track({ event: 'select_item', productId: p.id, props: { source: 'lookbook' } }); }}>
                <span aria-hidden="true">{i + 1}</span>
              </button>
              {open === h.id ? (
                <div className="hotspot__card" role="dialog" aria-label={p.name}>
                  <Link to={`/produto/${p.slug}`} className="hotspot__product">
                    {p.image ? <img src={p.image.url} alt="" loading="lazy" style={{ objectPosition: p.image.position }} /> : null}
                    <span><strong>{p.name}</strong><Price cents={p.priceCents} promoCents={p.promoPriceCents} size="sm" /></span>
                  </Link>
                  <QuickAdd product={p} compact onAdded={() => setOpen(null)} />
                  <button className="icon-btn hotspot__close" onClick={() => setOpen(null)} aria-label="Fechar"><Icon name="close" size={16} /></button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {spots.length ? <figcaption className="muted small">Toque nos pontos numerados para ver e comprar cada peça.</figcaption> : null}
    </figure>
  );
}

export function LookProductList({ products }: { products: QuickProductDTO[] }) {
  return (
    <ol className="look-list">
      {products.map((p, i) => (
        <li key={p.id} className="look-list__item">
          <span className="look-list__n" aria-hidden="true">{i + 1}</span>
          <Link to={`/produto/${p.slug}`} className="look-list__img">{p.image ? <img src={p.image.url} alt="" loading="lazy" style={{ objectPosition: p.image.position }} /> : null}</Link>
          <div className="look-list__info">
            <Link to={`/produto/${p.slug}`}><strong>{p.name}</strong></Link>
            <Price cents={p.priceCents} promoCents={p.promoPriceCents} size="sm" />
            <QuickAdd product={p} compact />
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------
// Newsletter (confirmação dupla) e WhatsApp
// ---------------------------------------------------------------------------------------------
export function NewsletterForm({ source = 'site', dark }: { source?: string; dark?: boolean }) {
  const { config, user } = useStore();
  const n = config.settings.newsletter;
  const [email, setEmail] = useState(user?.email ?? '');
  const [consent, setConsentBox] = useState(false);
  const [state, setState] = useState<{ status: 'idle' | 'sending' | 'pending' | 'confirmed' | 'error'; message?: string }>({ status: 'idle' });
  if (n && !n.enabled) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!consent) { setState({ status: 'error', message: 'Marque a autorização para receber e-mails.' }); return; }
    setState({ status: 'sending' });
    try {
      const r = await api.post<{ status: 'pending' | 'confirmed' }>('/api/newsletter', { email, consent: true, source });
      setState({ status: r.status });
      track({ event: 'newsletter_signup', props: { source } });
    } catch (err) {
      setState({ status: 'error', message: err instanceof ApiError ? (err.fieldErrors.email ?? err.message) : errorMessage(err) });
    }
  };
  return (
    <section className={`newsletter${dark ? ' newsletter--dark on-dark' : ''}`} aria-labelledby={`nl-${source}`}>
      <div className="newsletter__text">
        <p className="eyebrow">Newsletter</p>
        <h2 id={`nl-${source}`}>{n?.title || 'Receba as novidades da GAZU'}</h2>
        <p>{n?.text || 'Lançamentos, coleções e conteúdos do Journal.'}</p>
      </div>
      {state.status === 'pending' ? (
        <p className="newsletter__done" role="status"><Icon name="mail" /> Quase lá! Enviamos um link de confirmação para <strong>{email}</strong>. A inscrição só vale depois da confirmação.</p>
      ) : state.status === 'confirmed' ? (
        <p className="newsletter__done" role="status"><Icon name="check" /> Este e-mail já está inscrito. Obrigado!</p>
      ) : (
        <form className="newsletter__form" onSubmit={submit} noValidate>
          <div className="newsletter__row">
            <label className="sr-only" htmlFor={`nl-email-${source}`}>E-mail</label>
            <input id={`nl-email-${source}`} type="email" required autoComplete="email" placeholder="Seu e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button loading={state.status === 'sending'} variant={dark ? 'secondary' : 'primary'}>Inscrever</Button>
          </div>
          <Checkbox checked={consent} onChange={setConsentBox} label={<>Quero receber e-mails da GAZU. Posso cancelar quando quiser. <Link to="/politica-de-privacidade" className="link-underline">Privacidade</Link></>} />
          {state.status === 'error' ? <p className="field__error" role="alert">{state.message}</p> : null}
        </form>
      )}
    </section>
  );
}

export function whatsappLink(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

/** Botão flutuante "Falar no WhatsApp" (link wa.me) — exibido só com número configurado pela loja. */
export function WhatsAppFloat() {
  const { config } = useStore();
  const w = config.settings.whatsapp;
  const link = whatsappLink(config.settings.contact.whatsapp, w?.defaultMessage ?? 'Olá! Vim pelo site da GAZU.');
  if (!w?.showButton || !link) return null;
  return (
    <a className="wa-float" href={link} target="_blank" rel="noopener noreferrer" aria-label="Falar com a GAZU no WhatsApp (abre o aplicativo)">
      <Icon name="whatsapp" size={24} />
    </a>
  );
}

// ---------------------------------------------------------------------------------------------
// Consentimento de cookies de análise
// ---------------------------------------------------------------------------------------------
export function ConsentBanner() {
  const [decided, setDecided] = useState(() => Boolean(getConsent()));
  const [force, setForce] = useState(false);
  useEffect(() => onConsentChange(() => setDecided(true)), []);
  useEffect(() => {
    const open = () => setForce(true);
    window.addEventListener('gazu:cookie-preferences', open);
    return () => window.removeEventListener('gazu:cookie-preferences', open);
  }, []);
  if (decided && !force) return null;
  const choose = (v: boolean) => { void setConsent(v); setDecided(true); setForce(false); };
  return (
    <div className="consent" role="dialog" aria-live="polite" aria-labelledby="consent-title">
      <div className="consent__text">
        <p id="consent-title"><strong>Cookies e privacidade</strong></p>
        <p>Usamos cookies essenciais para login, sacola e segurança. Com a sua permissão, também registramos dados de navegação anônimos para melhorar a loja — sem e-mail, nome ou IP. <Link to="/politica-de-privacidade" className="link-underline">Saiba mais</Link></p>
      </div>
      <div className="consent__actions">
        <Button size="sm" variant="secondary" onClick={() => choose(false)}>Somente essenciais</Button>
        <Button size="sm" onClick={() => choose(true)}>Permitir análise</Button>
      </div>
    </div>
  );
}

export const openCookiePreferences = () => window.dispatchEvent(new Event('gazu:cookie-preferences'));

// ---------------------------------------------------------------------------------------------
// Vistos recentemente
// ---------------------------------------------------------------------------------------------
export function RecentlyViewed({ exclude, title = 'Vistos recentemente' }: { exclude?: number; title?: string }) {
  const { user } = useStore();
  const [items, setItems] = useState<ProductCardDTO[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const ids = user ? (await api.get<{ ids: number[] }>('/api/account/viewed').catch(() => ({ ids: localViewed() }))).ids : localViewed();
      const wanted = ids.filter((id) => id !== exclude).slice(0, 8);
      if (!wanted.length) { if (alive) setItems([]); return; }
      const r = await api.post<{ items: ProductCardDTO[] }>('/api/products/lookup', { ids: wanted }).catch(() => ({ items: [] as ProductCardDTO[] }));
      if (alive) setItems(wanted.map((id) => r.items.find((p) => p.id === id)).filter((p): p is ProductCardDTO => Boolean(p)).slice(0, 4));
    };
    void load();
    return () => { alive = false; };
  }, [exclude, user]);
  if (!items.length) return null;
  return (
    <section className="container home-products" aria-labelledby="recent-title">
      <div className="section-title"><div><p className="eyebrow">Seu histórico</p><h2 id="recent-title">{title}</h2></div></div>
      <ProductGrid products={items} />
    </section>
  );
}

export function Stars({ value, size = 14, label }: { value: number; size?: number; label?: string }) {
  const full = Math.round(value);
  return (
    <span className="stars" role="img" aria-label={label ?? `${value.toFixed(1).replace('.', ',')} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={size} filled={i <= full} />)}
    </span>
  );
}
