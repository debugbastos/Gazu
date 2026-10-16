import { useApi, useDocumentTitle, useReveal } from '../lib/hooks';
import { Link } from '../lib/router';
import { useStore } from '../lib/store';
import type { ProductCardDTO } from '../../shared/types';
import { Hero } from '../components/home/Hero';
import { ProductGrid, ProductGridSkeleton } from '../components/catalog/ProductCard';
import { Icon, type IconName } from '../components/ui/Icon';
import { ErrorState } from '../components/ui/ui';
import { NAV_ORDER } from '../components/layout/Header';
import { asset } from '../lib/asset';

type HomeData = Record<'featured' | 'newest' | 'clothing' | 'sneakers' | 'accessories', ProductCardDTO[]>;

const CATEGORY_COPY: Record<string, { text: string; cta: string }> = {
  masculino: { text: 'Essenciais elevados para o dia a dia.', cta: 'Comprar' },
  feminino: { text: 'Estilo sem esforço para você.', cta: 'Comprar' },
  infantil: { text: 'Conforto que acompanha cada brincadeira.', cta: 'Comprar' },
  tenis: { text: 'Pares para caminhar com personalidade.', cta: 'Comprar' },
  acessorios: { text: 'Detalhes que completam o visual.', cta: 'Comprar' },
};

function CategoryBand() {
  const { config } = useStore();
  const ref = useReveal<HTMLElement>();
  const cats = NAV_ORDER.map((s) => config.categories.find((c) => c.slug === s)).filter((c) => c && (c.productCount ?? 0) > 0);
  return (
    <section className="cat-band reveal" ref={ref} aria-label="Categorias">
      <div className="cat-band__inner container">
        {cats.map((c, i) => (
          <Link key={c!.slug} to={`/categoria/${c!.slug}`} className="cat-band__item" style={{ ['--i' as string]: i }}>
            <span className="cat-band__img">{c!.imageUrl ? <img src={c!.imageUrl} alt="" loading="lazy" decoding="async" /> : null}</span>
            <span className="cat-band__text">
              <span className="cat-band__title">{c!.name}</span>
              <span className="cat-band__desc">{CATEGORY_COPY[c!.slug]?.text ?? c!.description}</span>
              <span className="cat-band__cta">{CATEGORY_COPY[c!.slug]?.cta ?? 'Comprar'} <Icon name="arrowRight" size={14} /></span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function EditorialBanner() {
  const ref = useReveal<HTMLElement>();
  return (
    <section className="editorial reveal" ref={ref} aria-labelledby="editorial-title">
      <div className="editorial__inner container">
        <div className="editorial__text">
          <p className="eyebrow">Nova estação</p>
          <h2 id="editorial-title">Novos<br />olhares</h2>
          <p>Descubra tudo o que é novo,<br />agora.</p>
          <Link to="/categoria/novidades" className="btn btn--primary btn--lg">Explorar coleção</Link>
        </div>
        <div className="editorial__media">
          <img src={asset('/assets/products/clothing/camiseta-basica-branca-masculina/camiseta-basica-branca-masculina-735.webp')} alt="Modelo masculino de camiseta branca e boné preto em retrato editorial" loading="lazy" decoding="async" />
        </div>
      </div>
    </section>
  );
}

const TRUST: { icon: IconName; title: string; text: string; href: string }[] = [
  { icon: 'truck', title: 'Entrega rastreada', text: 'Acompanhe cada etapa', href: '/entrega' },
  { icon: 'returns', title: 'Trocas e devoluções', text: '7 dias para arrependimento', href: '/trocas-e-devolucoes' },
  { icon: 'badge', title: 'Curadoria GAZU', text: 'Peças selecionadas', href: '/categoria/novidades' },
  { icon: 'lock', title: 'Pagamento protegido', text: 'Processado pelo provedor', href: '/atendimento' },
];

function TrustRow() {
  const ref = useReveal<HTMLElement>();
  return (
    <section className="trust reveal" ref={ref} aria-label="Informações de compra">
      <ul className="trust__inner container">
        {TRUST.map((t) => (
          <li key={t.title}>
            <Link to={t.href} className="trust__item">
              <Icon name={t.icon} size={30} />
              <span><strong>{t.title}</strong><span>{t.text}</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Lookbook() {
  const ref = useReveal<HTMLElement>();
  const tiles = [
    { href: '/categoria/feminino-vestidos', img: '/assets/products/clothing/vestido-longo-branco-floral/vestido-longo-branco-floral-736.webp', label: 'Vestidos', pos: 'center 30%' },
    { href: '/categoria/masculino-conjuntos', img: '/assets/products/clothing/conjunto-moletom-masculino-cinza/conjunto-moletom-masculino-cinza-649.webp', label: 'Conjuntos', pos: 'center 30%' },
    { href: '/categoria/infantil', img: '/assets/products/clothing/sueter-infantil-listrado/sueter-infantil-listrado-736.webp', label: 'Infantil', pos: 'center 35%' },
  ];
  return (
    <section className="lookbook container reveal" ref={ref} aria-labelledby="lookbook-title">
      <div className="lookbook__intro">
        <p className="eyebrow">Lookbook</p>
        <h2 id="lookbook-title">Para cada<br />momento</h2>
        <p className="muted">Composições da coleção para inspirar o seu próximo visual.</p>
      </div>
      <div className="lookbook__tiles">
        {tiles.map((t) => (
          <Link key={t.href} to={t.href} className="lookbook__tile">
            <img src={asset(t.img)} alt="" loading="lazy" decoding="async" style={{ objectPosition: t.pos }} />
            <span>{t.label} <Icon name="arrowUpRight" size={16} /></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ProductSection({ id, eyebrow, title, href, items, loading, cols = 4 }: { id: string; eyebrow?: string; title: string; href: string; items: ProductCardDTO[] | undefined; loading: boolean; cols?: number }) {
  const ref = useReveal<HTMLElement>();
  if (!loading && (!items || items.length === 0)) return null;
  return (
    <section className={`home-products container reveal home-products--${cols}`} ref={ref} aria-labelledby={id}>
      <div className="section-title">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 id={id}>{title}</h2>
        </div>
        <Link to={href} className="link-underline">Ver tudo</Link>
      </div>
      {loading ? <ProductGridSkeleton count={cols} /> : <ProductGrid products={items!.slice(0, cols === 4 ? 8 : cols)} />}
    </section>
  );
}

export function HomePage() {
  useDocumentTitle('GAZU — Moda que se move com você');
  const { config } = useStore();
  const { data, error, loading, reload } = useApi<HomeData>('/api/home');
  return (
    <div className="home">
      <Hero />
      <CategoryBand />
      <EditorialBanner />
      <TrustRow />
      {error ? <div className="container"><ErrorState message={error} onRetry={reload} /></div> : null}
      <ProductSection id="best-title" title="O melhor da GAZU" href="/categoria/novidades" items={data?.featured} loading={loading} />
      <ProductSection id="new-title" eyebrow="Acabou de chegar" title="Novidades" href="/categoria/novidades" items={data?.newest.slice(0, 4)} loading={loading} />
      <Lookbook />
      <ProductSection id="clothing-title" eyebrow="Seleção" title="Roupas" href="/categoria/feminino" items={data?.clothing.slice(0, 4)} loading={loading} />
      <ProductSection id="sneakers-title" eyebrow="Seleção" title="Tênis" href="/categoria/tenis" items={data?.sneakers.slice(0, 4)} loading={loading} />
      {config.settings.showAccessoriesOnHome ? (
        <ProductSection id="acc-title" eyebrow="Detalhes" title="Acessórios" href="/categoria/acessorios" items={data?.accessories.slice(0, 4)} loading={loading} />
      ) : null}
    </div>
  );
}
