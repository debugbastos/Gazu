import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { Link, useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { formatCep, formatPrice, onlyDigits } from '../../shared/format';
import type { ProductDetailDTO, ShippingOptionDTO, VariantDTO } from '../../shared/types';
import { Gallery } from '../components/product/Gallery';
import { ProductGrid } from '../components/catalog/ProductCard';
import { QuantityStepper } from '../components/cart/CartLine';
import { Icon } from '../components/ui/Icon';
import { Accordion, Button, DemoTag, Dialog, ErrorState, Loading, Notice, Price } from '../components/ui/ui';
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

function ShippingEstimator({ subtotalCents }: { subtotalCents: number }) {
  const [cep, setCep] = useState('');
  const [state, setState] = useState<{ loading: boolean; options: ShippingOptionDTO[]; message: string | null; error: string | null }>({ loading: false, options: [], message: null, error: null });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (onlyDigits(cep).length !== 8) { setState({ loading: false, options: [], message: null, error: 'Informe um CEP com 8 dígitos.' }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await api.post<{ options: ShippingOptionDTO[]; message: string | null }>('/api/shipping/quote', { cep, subtotalCents });
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
    </form>
  );
}

const SIZE_GUIDE: Record<string, { head: string[]; rows: string[][]; note: string }> = {
  A: { head: ['Tamanho', 'Tórax (cm)', 'Cintura (cm)', 'Quadril (cm)'], rows: [['PP', '82–86', '66–70', '88–92'], ['P', '87–92', '71–76', '93–97'], ['M', '93–98', '77–82', '98–102'], ['G', '99–104', '83–88', '103–108'], ['GG', '105–112', '89–96', '109–116']], note: 'Referência geral de medidas corporais. A modelagem de cada peça pode variar; medidas específicas serão informadas pelo fornecedor.' },
  K: { head: ['Tamanho', 'Idade aprox.', 'Altura (cm)'], rows: [['2', '2 anos', '86–92'], ['4', '3–4 anos', '98–104'], ['6', '5–6 anos', '110–116'], ['8', '7–8 anos', '122–128'], ['10', '9–10 anos', '134–140'], ['12', '11–12 anos', '146–152']], note: 'Referência geral. Prefira escolher pela altura da criança.' },
  S: { head: ['Numeração BR', 'Comprimento do pé (cm)'], rows: [['34', '22,0'], ['35', '22,7'], ['36', '23,3'], ['37', '24,0'], ['38', '24,7'], ['39', '25,3'], ['40', '26,0'], ['41', '26,7'], ['42', '27,3'], ['43', '28,0']], note: 'Meça o pé do calcanhar ao dedo mais longo. A forma pode variar conforme o modelo.' },
};

function profileOf(variants: VariantDTO[]): 'A' | 'K' | 'S' | 'U' {
  const s = variants[0]?.size ?? '';
  if (s === 'Único') return 'U';
  if (/^\d+$/.test(s)) return Number(s) >= 30 ? 'S' : 'K';
  return 'A';
}

export function ProductPage({ slug }: { slug: string }) {
  const { data: p, error, loading, reload } = useApi<ProductDetailDTO>(`/api/products/${encodeURIComponent(slug)}`);
  const { addToCart, setCartOpen, notify, toggleFavorite, isFavorite } = useStore();
  const { navigate } = useRouter();
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
    const firstAvailable = p.variants.find((v) => v.stock > 0);
    setColor(firstAvailable?.colorName ?? p.variants[0]?.colorName ?? null);
    const onlySize = new Set(p.variants.map((v) => v.size)).size === 1 ? p.variants[0]?.size ?? null : null;
    setSize(onlySize);
    setQty(1);
    setImgIndex(0);
    setBuy('idle');
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

  const selectColor = (c: string) => {
    setColor(c);
    setImgIndex(0);
    const v = p.variants.find((x) => x.colorName === c && x.size === size);
    if (!v || v.stock <= 0) setSize(new Set(p.variants.map((x) => x.size)).size === 1 ? size : null);
    setQty(1);
  };

  const add = (goCheckout = false) => {
    if (!variant) { setSizeError('Selecione um tamanho para continuar.'); document.getElementById('pdp-sizes')?.focus(); return; }
    if (variant.stock <= 0) return;
    setBuy('adding');
    window.setTimeout(() => {
      try {
        addToCart(variant.id, Math.min(qty, variant.stock));
        setBuy('added');
        if (goCheckout) { navigate('/checkout'); return; }
        notify(`${p.name} (${variant.colorName}, ${variant.size}) foi adicionado à sacola.`, 'success', { label: 'Ver sacola', href: '/carrinho' });
        window.setTimeout(() => setBuy('idle'), 2200);
      } catch {
        setBuy('error');
      }
    }, 250);
  };

  const buyLabel = allOut || (variant && variant.stock <= 0) ? 'Indisponível' : buy === 'adding' ? 'Adicionando…' : buy === 'added' ? 'Adicionado à sacola' : buy === 'error' ? 'Tentar novamente' : 'Adicionar à sacola';

  return (
    <div className="pdp-page">
      <div className="pdp container">
        <div className="pdp-info">
          <div className="pdp-info__top">
            {backCrumb ? <Link to={backCrumb.href} className="pdp-back"><Icon name="arrowLeft" size={16} /> {backCrumb.name}</Link> : null}
            <a href="#detalhes" className="pdp-back" onClick={(e) => { e.preventDefault(); document.getElementById('detalhes')?.scrollIntoView({ behavior: 'smooth' }); }}><Icon name="plus" size={16} /> Detalhes</a>
          </div>
          <h1 className="pdp-title">{p.name}</h1>
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
                    onClick={() => { if (v.stock > 0) { setSize(v.size); setSizeError(null); setQty((q) => Math.min(q, v.stock)); } }}
                    aria-disabled={v.stock <= 0}
                    aria-label={`${v.size}${v.stock <= 0 ? ' — esgotado' : ''}`}
                  >
                    {v.size}
                  </button>
                ))}
              </div>
              {profile !== 'U' ? <button className="pdp-opt__guide" onClick={() => setGuide(true)}><Icon name="ruler" size={15} /> Guia de medidas</button> : null}
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
              <QuantityStepper value={qty} max={variant ? variant.stock : 1} onChange={(v) => setQty(Math.max(1, v))} label="Quantidade" disabled={!variant || stock <= 0} />
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
            <div className="pdp-buy__row">
              <Button variant="secondary" onClick={() => add(true)} disabled={allOut || (variant !== null && variant.stock <= 0)}>Comprar agora</Button>
              <button className={`icon-btn pdp-fav${fav ? ' is-active' : ''}`} onClick={() => void toggleFavorite(p.id, p.name)} aria-pressed={fav} aria-label={fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}>
                <Icon name="heart" filled={fav} />
              </button>
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
              <dl className="pdp-specs">
                <div><dt>Tipo</dt><dd>{p.type}</dd></div>
                <div><dt>Referência</dt><dd>{variant?.sku ?? p.variants[0]?.sku}</dd></div>
              </dl>
            </Accordion>
            {p.details ? <Accordion title="Composição e cuidados"><p style={{ whiteSpace: 'pre-line' }}>{p.details}</p></Accordion> : null}
            {profile !== 'U' ? <Accordion title="Tabela de medidas"><SizeTable profile={profile} /></Accordion> : null}
            <Accordion title="Entrega e trocas">
              <p>O prazo e o valor da entrega são calculados pelo CEP no carrinho e no checkout. Você pode desistir da compra em até 7 dias após o recebimento (art. 49 do Código de Defesa do Consumidor).</p>
              <p><Link to="/trocas-e-devolucoes" className="link-underline">Política de trocas e devoluções</Link> · <Link to="/entrega" className="link-underline">Informações de entrega</Link></p>
            </Accordion>
          </div>
          <div className="pdp-details__side">
            <ShippingEstimator subtotalCents={(promoCents ?? priceCents) * qty} />
            {p.isDemo ? <Notice tone="info" title="Modo demonstração">Este produto foi cadastrado a partir das fotografias fornecidas para apresentar o layout. Preço, cores e estoque devem ser confirmados antes da venda.</Notice> : null}
          </div>
        </div>
      </section>

      {p.related.length ? (
        <section className="container home-products" aria-labelledby="rel-title">
          <div className="section-title"><div><p className="eyebrow">Combine com</p><h2 id="rel-title">Você também pode gostar</h2></div></div>
          <ProductGrid products={p.related} />
        </section>
      ) : null}

      <Dialog open={guide} onClose={() => setGuide(false)} title="Guia de medidas">
        <div className="dialog__body"><SizeTable profile={profile} /></div>
      </Dialog>
    </div>
  );
}

function SizeTable({ profile }: { profile: 'A' | 'K' | 'S' | 'U' }) {
  const g = SIZE_GUIDE[profile];
  if (!g) return null;
  return (
    <div className="size-table">
      <table>
        <thead><tr>{g.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{g.rows.map((r) => <tr key={r[0]}>{r.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i}>{c}</td>))}</tr>)}</tbody>
      </table>
      <p className="muted small">{g.note}</p>
    </div>
  );
}
