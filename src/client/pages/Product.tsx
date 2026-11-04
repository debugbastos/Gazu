import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { Link, useRouter, useSearchParams } from '../lib/router';
import { useStore } from '../lib/store';
import { track } from '../lib/analytics';
import { rememberViewed } from '../lib/recent';
import { formatCep, formatDate, formatPrice, onlyDigits } from '../../shared/format';
import type { ProductDetailDTO, ReviewDTO, ReviewSummaryDTO, ShippingOptionDTO, SizeGuideDTO, VariantDTO } from '../../shared/types';
import { Gallery } from '../components/product/Gallery';
import { ProductGrid } from '../components/catalog/ProductCard';
import { QuantityStepper } from '../components/cart/CartLine';
import { LookbookCard, RecentlyViewed, Stars } from '../components/content/Editorial';
import { Icon } from '../components/ui/Icon';
import { Accordion, Button, DemoTag, Dialog, ErrorState, Field, Loading, Notice, Price, TextareaField } from '../components/ui/ui';
import { NotFoundPage } from './Static';

type BuyState = 'idle' | 'adding' | 'added' | 'error';

function Octagon() {
  return (
    <svg className="octagon" viewBox="0 0 64 64" aria-hidden="true">
      <polygon points="20,2 44,2 62,20 62,44 44,62 20,62 2,44 2,20" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M25 39 39 25m-10 0h10v10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShippingEstimator({ subtotalCents, variantId, qty }: { subtotalCents: number; variantId: number | null; qty: number }) {
  const [cep, setCep] = useState('');
  const [state, setState] = useState<{ loading: boolean; options: ShippingOptionDTO[]; message: string | null; error: string | null }>({ loading: false, options: [], message: null, error: null });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (onlyDigits(cep).length !== 8) { setState({ loading: false, options: [], message: null, error: 'Informe um CEP com 8 dígitos.' }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await api.post<{ options: ShippingOptionDTO[]; message: string | null }>('/api/shipping/quote', { cep, subtotalCents, ...(variantId ? { items: [{ variantId, quantity: qty }] } : {}) });
      setState({ loading: false, options: r.options, message: r.message, error: null });
    } catch (err) {
      setState({ loading: false, options: [], message: null, error: errorMessage(err) });
    }
  };
  return (
    <form className="ship-est" onSubmit={submit}>
      <label htmlFor="pdp-cep">Calcular entrega</label>
      <div className="ship-est__row">
        <input id="pdp-cep" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" value={formatCep(cep)} onChange={(e) => setCep(e.target.value)} maxLength={9} />
        <Button variant="secondary" size="sm" loading={state.loading}>Calcular</Button>
      </div>
      {state.error ? <p className="field__error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="ship-est__msg">{state.message}</p> : null}
      {state.options.length ? (
        <ul className="ship-est__list">
          {state.options.map((o) => (
            <li key={o.id}><span>{o.label}<small>{o.minDays === o.maxDays ? `${o.maxDays} dias úteis` : `${o.minDays} a ${o.maxDays} dias úteis`}</small></span><strong>{o.priceCents === 0 ? 'Grátis' : formatPrice(o.priceCents)}</strong></li>
          ))}
        </ul>
      ) : null}
      <p className="muted small"><a href="https://buscacepinter.correios.com.br/" target="_blank" rel="noopener noreferrer" className="link-underline">Não sei meu CEP</a></p>
    </form>
  );
}

// Tabelas de referência usadas apenas quando o produto não tem guia cadastrado no painel.
const FALLBACK_GUIDE: Record<string, Omit<SizeGuideDTO, 'id' | 'isDemo'>> = {
  A: { name: 'Referência geral', head: ['Tamanho', 'Tórax (cm)', 'Cintura (cm)', 'Quadril (cm)'], rows: [['PP', '82–86', '66–70', '88–92'], ['P', '87–92', '71–76', '93–97'], ['M', '93–98', '77–82', '98–102'], ['G', '99–104', '83–88', '103–108'], ['GG', '105–112', '89–96', '109–116']], note: 'Referência geral de medidas corporais. A modelagem de cada peça pode variar.' },
  K: { name: 'Referência geral', head: ['Tamanho', 'Idade aprox.', 'Altura (cm)'], rows: [['2', '2 anos', '86–92'], ['4', '3–4 anos', '98–104'], ['6', '5–6 anos', '110–116'], ['8', '7–8 anos', '122–128'], ['10', '9–10 anos', '134–140'], ['12', '11–12 anos', '146–152']], note: 'Referência geral. Prefira escolher pela altura da criança.' },
  S: { name: 'Referência geral', head: ['Numeração BR', 'Comprimento do pé (cm)'], rows: [['34', '22,0'], ['35', '22,7'], ['36', '23,3'], ['37', '24,0'], ['38', '24,7'], ['39', '25,3'], ['40', '26,0'], ['41', '26,7'], ['42', '27,3'], ['43', '28,0']], note: 'Meça o pé do calcanhar ao dedo mais longo. A forma pode variar conforme o modelo.' },
};

function profileOf(variants: VariantDTO[]): 'A' | 'K' | 'S' | 'U' {
  const s = variants[0]?.size ?? '';
  if (s === 'Único') return 'U';
  if (/^\d+$/.test(s)) return Number(s) >= 30 ? 'S' : 'K';
  return 'A';
}

function SizeTable({ guide }: { guide: Omit<SizeGuideDTO, 'id'> & { isDemo?: boolean } }) {
  return (
    <div className="size-table">
      <p className="eyebrow">{guide.name}</p>
      <div className="size-table__scroll">
        <table>
          <thead><tr>{guide.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{guide.rows.map((r) => <tr key={r[0]}>{r.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i}>{c}</td>))}</tr>)}</tbody>
        </table>
      </div>
      {guide.note ? <p className="muted small">{guide.note}</p> : null}
      {guide.isDemo ? <p className="muted small"><DemoTag>Tabela de referência</DemoTag> As medidas reais da peça devem ser confirmadas com o fornecedor.</p> : null}
    </div>
  );
}

function Waitlist({ variant, productName }: { variant: VariantDTO; productName: string }) {
  const { user, notify } = useStore();
  const [email, setEmail] = useState(user?.email ?? '');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      await api.post('/api/stock-alerts', { variantId: variant.id, email: user ? undefined : email });
      setState('done');
    } catch (err) {
      notify(errorMessage(err), 'error');
      setState('idle');
    }
  };
  if (state === 'done') return <p className="waitlist__done" role="status"><Icon name="bell" size={16} /> Pronto! Avisaremos {user ? 'no seu e-mail' : email} quando {productName} ({variant.colorName}, {variant.size}) voltar.</p>;
  return (
    <form className="waitlist" onSubmit={submit}>
      <p><Icon name="bell" size={16} /> <strong>Avise-me quando chegar</strong> — {variant.colorName}, tamanho {variant.size}.</p>
      <div className="waitlist__row">
        {!user ? <><label className="sr-only" htmlFor="wl-email">E-mail</label><input id="wl-email" type="email" required placeholder="Seu e-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></> : null}
        <Button size="sm" variant="secondary" loading={state === 'sending'}>Avisar-me</Button>
      </div>
      <p className="muted small">Enviamos um único e-mail na reposição. Não reservamos unidades.</p>
    </form>
  );
}

interface ReviewsData { enabled: boolean; summary: ReviewSummaryDTO; reviews: ReviewDTO[]; eligibility: { eligible: boolean; reason: string | null; existing: boolean } | null }

function Reviews({ productId }: { productId: number }) {
  const { user, notify } = useStore();
  const { data, reload } = useApi<ReviewsData>(`/api/products/${productId}/reviews`, [user?.id]);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ rating: 5, title: '', body: '' });
  const [sending, setSending] = useState(false);
  if (!data || !data.enabled) return null;
  const s = data.summary;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const r = await api.post<{ status: string }>(`/api/products/${productId}/reviews`, v);
      notify(r.status === 'pending' ? 'Obrigado! Sua avaliação será publicada após a moderação.' : 'Obrigado pela avaliação!', 'success');
      setOpen(false);
      reload();
    } catch (err) { notify(errorMessage(err), 'error'); } finally { setSending(false); }
  };
  return (
    <section className="pdp-reviews container" id="avaliacoes" aria-labelledby="rev-title">
      <div className="section-title">
        <div><p className="eyebrow">Compras verificadas</p><h2 id="rev-title">Avaliações</h2></div>
        {data.eligibility?.eligible ? <Button variant="secondary" size="sm" icon="star" onClick={() => setOpen(true)}>Avaliar este produto</Button> : null}
      </div>
      {s.count ? (
        <div className="reviews">
          <div className="reviews__summary">
            <p className="reviews__avg">{s.average?.toFixed(1).replace('.', ',')}</p>
            <Stars value={s.average ?? 0} size={18} />
            <p className="muted small">{s.count} {s.count === 1 ? 'avaliação' : 'avaliações'} de quem comprou</p>
            <ul className="reviews__dist">
              {([5, 4, 3, 2, 1] as const).map((n) => <li key={n}><span>{n}</span><span className="reviews__bar"><span style={{ width: `${(s.distribution[n] / s.count) * 100}%` }} /></span><span>{s.distribution[n]}</span></li>)}
            </ul>
          </div>
          <ul className="reviews__list">
            {data.reviews.map((r) => (
              <li key={r.id} className="review">
                <Stars value={r.rating} />
                {r.title ? <p className="review__title">{r.title}</p> : null}
                <p>{r.body}</p>
                <p className="muted small">{r.authorName} · {formatDate(r.createdAt)}{r.verified ? ' · Compra verificada' : ''}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="muted">Este produto ainda não tem avaliações. Somente quem comprou e recebeu o produto pode avaliar.</p>}
      {user && data.eligibility && !data.eligibility.eligible && data.eligibility.reason && !s.count ? <p className="muted small">{data.eligibility.reason}</p> : null}
      <Dialog open={open} onClose={() => setOpen(false)} title="Avaliar produto">
        <form className="dialog__body form-stack" onSubmit={submit}>
          <fieldset>
            <legend className="field-legend">Nota</legend>
            <div className="rating-input" role="radiogroup" aria-label="Nota de 1 a 5">
              {[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} role="radio" aria-checked={v.rating === n} aria-label={`${n} estrela${n > 1 ? 's' : ''}`} className={n <= v.rating ? 'is-on' : ''} onClick={() => setV({ ...v, rating: n })}><Icon name="star" filled={n <= v.rating} size={26} /></button>)}
            </div>
          </fieldset>
          <Field label="Título" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} optional maxLength={80} />
          <TextareaField label="Comentário" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} required rows={5} maxLength={2000} />
          <p className="muted small">Sua avaliação mostra apenas seu primeiro nome e a inicial do sobrenome.</p>
          <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={sending}>Enviar avaliação</Button></div>
        </form>
      </Dialog>
    </section>
  );
}

function InstallmentsLine({ cents }: { cents: number }) {
  const { config } = useStore();
  const [info, setInfo] = useState<{ available: boolean; maxNoInterest: number; maxInstallments: number } | null>(null);
  useEffect(() => {
    if (!config.payments.creditCard) return;
    const t = window.setTimeout(() => { api.get<typeof info>(`/api/checkout/installments?amount=${cents}`).then(setInfo).catch(() => setInfo(null)); }, 200);
    return () => window.clearTimeout(t);
  }, [cents, config.payments.creditCard]);
  if (!info?.available) return config.payments.pix ? <p className="pdp-installments">Pagamento com Pix{config.payments.creditCard ? ' ou cartão' : ''}{config.payments.boleto ? ' e boleto' : ''}.</p> : null;
  return (
    <p className="pdp-installments">
      {info.maxNoInterest > 1 ? <>ou <strong>{info.maxNoInterest}x de {formatPrice(Math.ceil(cents / info.maxNoInterest))}</strong> sem juros no cartão</> : info.maxInstallments > 1 ? <>Parcele em até {info.maxInstallments}x no cartão (juros do provedor)</> : <>Cartão de crédito à vista</>}
      {config.payments.pix ? ' · Pix' : ''}{config.payments.boleto ? ' · Boleto' : ''}
    </p>
  );
}

export function ProductPage({ slug }: { slug: string }) {
  const { data: p, error, loading, reload } = useApi<ProductDetailDTO>(`/api/products/${encodeURIComponent(slug)}`);
  const { addToCart, notify, toggleFavorite, isFavorite, user, config } = useStore();
  const { navigate } = useRouter();
  const [sp] = useSearchParams();
  const colors = useMemo(() => [...new Map((p?.variants ?? []).map((v) => [v.colorName, { name: v.colorName, hex: v.colorHex }])).values()], [p]);
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [imgIndex, setImgIndex] = useState(0);
  const [buy, setBuy] = useState<BuyState>('idle');
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  useDocumentTitle(p ? p.name : null);

  useEffect(() => {
    if (!p) return;
    const wanted = sp.get('cor');
    const firstAvailable = (wanted ? p.variants.find((v) => v.colorName === wanted && v.stock > 0) : null) ?? p.variants.find((v) => v.stock > 0);
    setColor(wanted && p.variants.some((v) => v.colorName === wanted) ? wanted : firstAvailable?.colorName ?? p.variants[0]?.colorName ?? null);
    const onlySize = new Set(p.variants.map((v) => v.size)).size === 1 ? p.variants[0]?.size ?? null : null;
    setSize(onlySize);
    setQty(1);
    setImgIndex(0);
    setBuy('idle');
    track({ event: 'product_view', productId: p.id, valueCents: p.promoPriceCents ?? p.priceCents });
    rememberViewed(p.id, Boolean(user));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  if (loading && !p) return <div className="container page-pad"><Loading label="Carregando produto…" /></div>;
  if (error && !p) return error.includes('não encontrado') ? <NotFoundPage /> : <div className="container page-pad"><ErrorState message={error} onRetry={reload} /></div>;
  if (!p) return null;

  const variantsOfColor = p.variants.filter((v) => v.colorName === color);
  const variant = variantsOfColor.find((v) => v.size === size) ?? null;
  const images = p.images.filter((im) => !im.colorName || im.colorName === color);
  const gallery = images.length ? images : p.images;
  const profile = profileOf(p.variants);
  const stock = variant?.stock ?? 0;
  const allOut = p.variants.every((v) => v.stock <= 0);
  const priceCents = variant?.priceCents ?? p.priceCents;
  const promoCents = variant ? variant.promoPriceCents : p.promoPriceCents;
  const backCrumb = p.breadcrumbs[p.breadcrumbs.length - 2];
  const fav = isFavorite(p.id);
  const guideData = p.sizeGuide ?? (profile !== 'U' ? { ...FALLBACK_GUIDE[profile]!, isDemo: false } : null);
  const sku = variant?.sku ?? p.variants.find((v) => v.colorName === color)?.sku ?? p.variants[0]?.sku;
  const policies = config.settings.policies;

  const selectColor = (c: string) => {
    setColor(c);
    setImgIndex(0);
    const v = p.variants.find((x) => x.colorName === c && x.size === size);
    if (!v) setSize(new Set(p.variants.map((x) => x.size)).size === 1 ? size : null);
    setQty(1);
  };

  const add = (goCheckout = false) => {
    if (!variant) { setSizeError('Selecione um tamanho para continuar.'); document.getElementById('pdp-sizes')?.focus(); return; }
    if (variant.stock <= 0) return;
    setBuy('adding');
    window.setTimeout(() => {
      try {
        addToCart(variant.id, Math.min(qty, variant.stock));
        track({ event: 'add_to_cart', productId: p.id, valueCents: (promoCents ?? priceCents) * qty });
        setBuy('added');
        if (goCheckout) { navigate('/checkout'); return; }
        notify(`${p.name} (${variant.colorName}, ${variant.size}) foi adicionado à sacola.`, 'success', { label: 'Ver sacola', href: '/carrinho' });
        window.setTimeout(() => setBuy('idle'), 2200);
      } catch {
        setBuy('error');
      }
    }, 250);
  };

  const share = async () => {
    const url = `${window.location.origin}/produto/${p.slug}`;
    try {
      if (navigator.share) { await navigator.share({ title: p.name, text: `${p.name} na GAZU`, url }); return; }
      await navigator.clipboard.writeText(url);
      notify('Link do produto copiado.', 'success');
    } catch { /* compartilhamento cancelado */ }
  };

  const buyLabel = allOut || (variant && variant.stock <= 0) ? 'Indisponível' : buy === 'adding' ? 'Adicionando…' : buy === 'added' ? 'Adicionado à sacola' : buy === 'error' ? 'Tentar novamente' : 'Adicionar à sacola';
  const waitVariant = variant && variant.stock <= 0 ? variant : null;

  return (
    <div className="pdp-page">
      <div className="pdp container">
        <div className="pdp-info">
          <div className="pdp-info__top">
            {backCrumb ? <Link to={backCrumb.href} className="pdp-back"><Icon name="arrowLeft" size={16} /> {backCrumb.name}</Link> : null}
            <a href="#detalhes" className="pdp-back" onClick={(e) => { e.preventDefault(); document.getElementById('detalhes')?.scrollIntoView({ behavior: 'smooth' }); }}><Icon name="plus" size={16} /> Detalhes</a>
          </div>
          <h1 className="pdp-title">{p.name}</h1>
          {p.reviews?.count ? <a href="#avaliacoes" className="pdp-rating"><Stars value={p.reviews.average ?? 0} /> <span>{p.reviews.average?.toFixed(1).replace('.', ',')} ({p.reviews.count})</span></a> : null}
          {p.isDemo ? <p className="pdp-demo-note"><DemoTag /> Preço e estoque ilustrativos.</p> : null}

          <div className="pdp-opt">
            <span className="pdp-opt__label" id="lbl-size">Tamanho</span>
            <div className="pdp-opt__values">
              <div className="pdp-sizes" role="radiogroup" aria-labelledby="lbl-size" id="pdp-sizes" tabIndex={-1}>
                {variantsOfColor.map((v) => (
                  <button
                    key={v.id}
                    role="radio"
                    aria-checked={size === v.size}
                    className={`pdp-size${size === v.size ? ' is-selected' : ''}${v.stock <= 0 ? ' is-out' : ''}`}
                    onClick={() => { setSize(v.size); setSizeError(null); if (v.stock > 0) setQty((q) => Math.min(q, v.stock)); }}
                    aria-label={`${v.size}${v.stock <= 0 ? ' — esgotado, avise-me' : ''}`}
                  >
                    {v.size}
                  </button>
                ))}
              </div>
              {guideData ? <button className="pdp-opt__guide" onClick={() => setGuide(true)}><Icon name="ruler" size={15} /> Guia de medidas</button> : null}
              {sizeError ? <p className="field__error" role="alert">{sizeError}</p> : null}
            </div>
          </div>

          <div className="pdp-opt">
            <span className="pdp-opt__label" id="lbl-color">Cor</span>
            <div className="pdp-opt__values">
              <div className="pdp-colors" role="radiogroup" aria-labelledby="lbl-color">
                {colors.map((c) => {
                  const out = p.variants.filter((v) => v.colorName === c.name).every((v) => v.stock <= 0);
                  return (
                    <button key={c.name} role="radio" aria-checked={color === c.name} className={`pdp-color${color === c.name ? ' is-selected' : ''}${out ? ' is-out' : ''}`} onClick={() => selectColor(c.name)}>
                      <span className="pdp-color__dot" style={{ background: c.hex ?? '#ccc' }} aria-hidden="true" />
                      {c.name}{out ? <span className="sr-only"> (esgotada)</span> : null}
                    </button>
                  );
                })}
              </div>
              {!p.colorConfirmed ? <p className="pdp-opt__note">Cor descrita a partir da fotografia.</p> : null}
            </div>
          </div>

          <div className="pdp-opt">
            <span className="pdp-opt__label">Qtd.</span>
            <div className="pdp-opt__values pdp-opt__values--row">
              <QuantityStepper value={qty} max={variant ? Math.max(1, variant.stock) : 1} onChange={(v) => setQty(Math.max(1, v))} label="Quantidade" disabled={!variant || stock <= 0} />
              <p className={`pdp-stock${(variant && stock <= 0) || allOut ? ' is-out' : !variant ? ' is-pending' : stock <= 3 ? ' is-low' : ''}`} aria-live="polite">
                {allOut ? 'Produto esgotado' : !variant ? 'Selecione um tamanho' : stock <= 0 ? 'Tamanho esgotado' : stock <= 3 ? `Últimas ${stock} unidades` : 'Em estoque'}
              </p>
            </div>
          </div>

          <div className="pdp-buy">
            <button className={`pdp-buy__btn is-${buy}`} onClick={() => add(false)} disabled={allOut || (variant !== null && variant.stock <= 0) || buy === 'adding'}>
              <Octagon />
              <span className="pdp-buy__text">
                <span className="pdp-buy__label" aria-live="polite">{buyLabel}</span>
                <Price cents={priceCents} promoCents={promoCents} size="lg" />
              </span>
            </button>
            <InstallmentsLine cents={promoCents ?? priceCents} />
            {waitVariant ? <Waitlist variant={waitVariant} productName={p.name} /> : null}
            <div className="pdp-buy__row">
              <Button variant="secondary" onClick={() => add(true)} disabled={allOut || (variant !== null && variant.stock <= 0)}>Comprar agora</Button>
              <button className={`icon-btn pdp-fav${fav ? ' is-active' : ''}`} onClick={() => { if (!fav) track({ event: 'favorite_add', productId: p.id }); void toggleFavorite(p.id, p.name); }} aria-pressed={fav} aria-label={fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}>
                <Icon name="heart" filled={fav} />
              </button>
              <button className="icon-btn pdp-fav" onClick={() => void share()} aria-label="Compartilhar produto"><Icon name="share" /></button>
            </div>
            {qty > 1 && variant ? <p className="pdp-buy__total">Total para {qty} unidades: <strong>{formatPrice((promoCents ?? priceCents) * qty)}</strong></p> : null}
          </div>
        </div>

        <Gallery images={gallery} name={p.name} index={imgIndex} onIndex={setImgIndex} related={p.related} />
      </div>

      <section className="pdp-details container" id="detalhes" aria-label="Detalhes do produto">
        <div className="pdp-details__grid">
          <div>
            <Accordion title="Descrição" defaultOpen>
              <p>{p.description}</p>
              {p.details ? <p style={{ whiteSpace: 'pre-line' }}>{p.details}</p> : null}
              <dl className="pdp-specs">
                <div><dt>Tipo</dt><dd>{p.type}</dd></div>
                {p.brand ? <div><dt>Marca</dt><dd>{p.brand}</dd></div> : null}
                <div><dt>SKU</dt><dd>{sku}</dd></div>
              </dl>
            </Accordion>
            <Accordion title="Composição">
              {p.composition ? <p style={{ whiteSpace: 'pre-line' }}>{p.composition}</p> : <p className="muted">Composição ainda não informada pelo fornecedor. Fale com o <Link to={`/atendimento?assunto=produto`} className="link-underline">atendimento</Link> se precisar dessa informação antes da compra.</p>}
            </Accordion>
            <Accordion title="Cuidados">
              {p.careInstructions ? <p style={{ whiteSpace: 'pre-line' }}>{p.careInstructions}</p> : <p className="muted">Siga as instruções da etiqueta da peça. Cuidados específicos ainda não informados pelo fornecedor.</p>}
            </Accordion>
            {guideData || p.fitNotes ? (
              <Accordion title="Medidas e caimento">
                {p.fitNotes ? <p style={{ whiteSpace: 'pre-line' }}>{p.fitNotes}</p> : null}
                {guideData ? <SizeTable guide={guideData} /> : null}
              </Accordion>
            ) : null}
            <Accordion title="Entrega e trocas">
              <p>O prazo e o valor da entrega são calculados pelo CEP no carrinho e no checkout. Você pode desistir da compra em até {policies?.withdrawalDays ?? 7} dias após o recebimento (art. 49 do Código de Defesa do Consumidor) e solicitar troca por defeito em até {policies?.defectDays ?? 90} dias.{policies?.exchangeDays ? ` Trocas de tamanho ou cor: até ${policies.exchangeDays} dias após o recebimento.` : ''}</p>
              <p><Link to="/trocas-e-devolucoes" className="link-underline">Trocas e devoluções</Link> · <Link to="/entrega" className="link-underline">Entrega</Link> · <Link to="/pagamento" className="link-underline">Pagamento</Link></p>
            </Accordion>
            {p.faq?.length ? (
              <Accordion title="Perguntas frequentes">
                {p.faq.map((f) => <div key={f.id} className="pdp-faq"><p><strong>{f.question}</strong></p><div className="prose" dangerouslySetInnerHTML={{ __html: f.html }} /></div>)}
                <p><Link to="/ajuda" className="link-underline">Central de ajuda</Link></p>
              </Accordion>
            ) : null}
          </div>
          <div className="pdp-details__side">
            <ShippingEstimator subtotalCents={(promoCents ?? priceCents) * qty} variantId={variant && variant.stock > 0 ? variant.id : null} qty={qty} />
            {p.isDemo ? <Notice tone="info" title="Modo demonstração">Este produto foi cadastrado a partir das fotografias fornecidas para apresentar o layout. Preço, cores e estoque devem ser confirmados antes da venda.</Notice> : null}
          </div>
        </div>
      </section>

      {p.looks?.length ? (
        <section className="container home-products" aria-labelledby="look-title">
          <div className="section-title"><div><p className="eyebrow">Shop the look</p><h2 id="look-title">Compre o look</h2></div><Link to="/lookbook" className="link-underline">Ver lookbook</Link></div>
          <div className="ed-grid">{p.looks.map((l) => <LookbookCard key={l.id} l={l} />)}</div>
        </section>
      ) : null}

      {p.related.length ? (
        <section className="container home-products" aria-labelledby="rel-title">
          <div className="section-title"><div><p className="eyebrow">Combine com</p><h2 id="rel-title">Você também pode gostar</h2></div></div>
          <ProductGrid products={p.related} />
        </section>
      ) : null}

      <Reviews productId={p.id} />
      <RecentlyViewed exclude={p.id} />

      <Dialog open={guide} onClose={() => setGuide(false)} title="Guia de medidas">
        <div className="dialog__body">{guideData ? <SizeTable guide={guideData} /> : null}{p.fitNotes ? <p className="muted small" style={{ whiteSpace: 'pre-line' }}>{p.fitNotes}</p> : null}</div>
      </Dialog>
    </div>
  );
}
