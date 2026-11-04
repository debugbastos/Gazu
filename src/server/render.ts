import fs from 'node:fs';
import path from 'node:path';
import { ROOT, env, isProd } from './config.ts';
import { getDb } from './db.ts';
import { productBySlug } from './services/catalog.ts';
import { publicConfig } from './routes/public.ts';

interface Manifest { js: string; css: string }

let manifestCache: Manifest | null = null;
function manifest(): Manifest {
  if (manifestCache && isProd) return manifestCache;
  const file = path.join(ROOT, 'public/build/manifest.json');
  manifestCache = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest) : { js: '/build/app.js', css: '/build/app.css' };
  return manifestCache;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON seguro para <script> (impede fechar a tag e injetar HTML). */
const safeJson = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

interface Meta {
  title: string;
  description: string;
  image?: string;
  noindex?: boolean;
  jsonLd?: unknown;
  ogType?: string;
  status: number;
  preload?: string[];
}

const SITE = 'GAZU';
const DEFAULT_DESC = 'GAZU — moda masculina, feminina e infantil, tênis e acessórios com curadoria editorial.';
const PRIVATE_PREFIXES = ['/carrinho', '/checkout', '/conta', '/pedidos', '/pedido', '/admin', '/entrar', '/cadastro', '/recuperar-senha', '/redefinir-senha', '/favoritos', '/busca', '/newsletter', '/atendimento/AT'];
const abs = (u: string) => new URL(u, env.APP_URL).toString();
const crumbs = (items: [string, string][]) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(url) })),
});

export function metaFor(pathname: string): Meta {
  const base: Meta = { title: `${SITE} — Moda que se move com você`, description: DEFAULT_DESC, status: 200 };
  if (pathname === '/') {
    return { ...base, preload: ['/assets/hero/male/male-1400.webp'], jsonLd: { '@context': 'https://schema.org', '@type': 'OnlineStore', name: SITE, url: env.APP_URL } };
  }
  if (PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/')) || /^\/atendimento\/[A-Z0-9]+/.test(pathname)) return { ...base, title: `${SITE}`, noindex: true };
  const db = getDb();
  const editorial = editorialMeta(pathname, base);
  if (editorial) return editorial;
  const cat = /^\/categoria\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (cat) {
    if (cat[1] === 'novidades') return { ...base, title: `Novidades — ${SITE}`, description: 'As peças mais recentes da GAZU.' };
    const c = getDb().get<{ name: string; description: string | null }>('SELECT name, description FROM categories WHERE slug = ? AND is_active = 1', cat[1]!);
    if (!c) return { ...base, title: `Página não encontrada — ${SITE}`, noindex: true, status: 404 };
    return { ...base, title: `${c.name} — ${SITE}`, description: c.description ?? `${c.name} na GAZU.`, jsonLd: crumbs([['Início', '/'], [c.name, `/categoria/${cat[1]}`]]) };
  }
  const prod = /^\/produto\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (prod) {
    const p = productBySlug(prod[1]!);
    if (!p) return { ...base, title: `Produto não encontrado — ${SITE}`, noindex: true, status: 404 };
    const image = p.images[0]?.url ? new URL(p.images[0].url, env.APP_URL).toString() : undefined;
    const available = p.variants.some((v) => v.stock > 0);
    // Produtos de demonstração não recebem "offers" estruturadas (preço/estoque ilustrativos).
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      description: p.description,
      image: p.images.map((i) => new URL(i.url, env.APP_URL).toString()),
      sku: p.variants[0]?.sku,
      ...(p.isDemo || !p.reviews?.count ? {} : { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.reviews.average, reviewCount: p.reviews.count } }),
      ...(p.isDemo ? {} : {
        offers: {
          '@type': 'AggregateOffer', priceCurrency: 'BRL',
          lowPrice: (Math.min(...p.variants.map((v) => v.promoPriceCents ?? v.priceCents)) / 100).toFixed(2),
          highPrice: (Math.max(...p.variants.map((v) => v.promoPriceCents ?? v.priceCents)) / 100).toFixed(2),
          availability: available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: new URL(`/produto/${p.slug}`, env.APP_URL).toString(),
        },
      }),
    };
    const cat0 = db.get<{ name: string; slug: string }>('SELECT c.name, c.slug FROM categories c JOIN products p ON p.primary_category_id = c.id WHERE p.slug = ?', p.slug);
    return {
      ...base, title: `${p.seoTitle || p.name} — ${SITE}`, description: p.seoDescription || p.description.slice(0, 160), image, preload: p.images[0] ? [p.images[0].url] : [],
      jsonLd: [jsonLd, crumbs([['Início', '/'], ...(cat0 ? [[cat0.name, `/categoria/${cat0.slug}`] as [string, string]] : []), [p.name, `/produto/${p.slug}`]])],
    };
  }
  const STATIC: Record<string, [string, string]> = {
    '/politica-de-privacidade': ['Política de privacidade', 'Como a GAZU trata dados pessoais (LGPD).'],
    '/termos-de-uso': ['Termos de uso', 'Condições de uso do site e das compras na GAZU.'],
    '/trocas-e-devolucoes': ['Trocas e devoluções', 'Desistência em até 7 dias, defeito em até 90 dias e troca de tamanho ou cor.'],
    '/entrega': ['Entrega', 'Como o frete é calculado, prazos e rastreamento.'],
    '/atendimento': ['Atendimento', 'Fale com a GAZU: formulário, e-mail e WhatsApp.'],
    '/rastrear-pedido': ['Rastrear pedido', 'Acompanhe seu pedido com o número e o e-mail da compra.'],
    '/rastreio': ['Rastrear pedido', 'Acompanhe seu pedido com o número e o e-mail da compra.'],
    '/pagamento': ['Pagamento', 'Formas de pagamento, prazos de confirmação e segurança.'],
    '/cancelamento': ['Cancelamento', 'Como cancelar um pedido.'],
    '/monte-seu-look': ['Monte seu look', 'Combine peças da GAZU e adicione o look completo ao carrinho.'],
    '/colecoes': ['Coleções', 'Coleções e cápsulas da GAZU.'],
    '/archive': ['Archive', 'Coleções anteriores da GAZU.'],
    '/lookbook': ['Lookbook', 'Looks completos para comprar peça por peça.'],
    '/journal': ['Journal', 'Editorial GAZU: estilo, cuidados e bastidores.'],
  };
  const st = STATIC[pathname.replace(/\/$/, '')];
  if (st) return { ...base, title: `${st[0]} — ${SITE}`, description: st[1] };
  if (pathname === '/ajuda' || pathname === '/ajuda/') {
    const faq = db.all<{ question: string; answer: string }>('SELECT question, answer FROM faq_items WHERE is_active = 1 AND product_id IS NULL ORDER BY category, position LIMIT 40');
    return {
      ...base, title: `Central de ajuda — ${SITE}`, description: 'Perguntas frequentes sobre pedidos, pagamento, entrega, trocas e privacidade.',
      jsonLd: faq.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) } : undefined,
    };
  }
  return { ...base, title: `Página não encontrada — ${SITE}`, noindex: true, status: 404 };
}

function editorialMeta(pathname: string, base: Meta): Meta | null {
  const db = getDb();
  const notFound = { ...base, title: `Página não encontrada — ${SITE}`, noindex: true, status: 404 };
  const col = /^\/colecao\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (col) {
    const c = db.get<{ name: string; description: string; seo_title: string | null; seo_description: string | null; cover_url: string | null }>("SELECT * FROM collections WHERE slug = ? AND status IN ('active','archived')", col[1]!);
    if (!c) return notFound;
    return { ...base, title: `${c.seo_title || c.name} — ${SITE}`, description: c.seo_description || c.description.slice(0, 160) || base.description, image: c.cover_url ? abs(c.cover_url) : undefined,
      jsonLd: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: c.name, description: c.description, url: abs(pathname) } };
  }
  const lb = /^\/lookbook\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (lb) {
    const l = db.get<{ title: string; description: string; seo_title: string | null; seo_description: string | null; cover_url: string | null }>("SELECT * FROM lookbooks WHERE slug = ? AND status = 'published'", lb[1]!);
    if (!l) return notFound;
    return { ...base, title: `${l.seo_title || l.title} — Lookbook ${SITE}`, description: l.seo_description || l.description.slice(0, 160) || base.description, image: l.cover_url ? abs(l.cover_url) : undefined };
  }
  const jr = /^\/journal\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (jr) {
    const a = db.get<{ title: string; excerpt: string; seo_title: string | null; seo_description: string | null; cover_url: string | null; published_at: string | null; updated_at: string; author: string }>("SELECT * FROM journal_articles WHERE slug = ? AND status = 'published'", jr[1]!);
    if (!a) return notFound;
    return {
      ...base, title: `${a.seo_title || a.title} — Journal ${SITE}`, description: a.seo_description || a.excerpt.slice(0, 160) || base.description, image: a.cover_url ? abs(a.cover_url) : undefined, ogType: 'article',
      jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: a.excerpt, image: a.cover_url ? [abs(a.cover_url)] : undefined, datePublished: a.published_at, dateModified: a.updated_at, author: { '@type': 'Organization', name: a.author }, publisher: { '@type': 'Organization', name: SITE } },
    };
  }
  const pg = /^\/p\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (pg) {
    const p = db.get<{ title: string; seo_description: string | null }>("SELECT title, seo_description FROM pages WHERE slug = ? AND status = 'published'", pg[1]!);
    return p ? { ...base, title: `${p.title} — ${SITE}`, description: p.seo_description ?? base.description } : notFound;
  }
  return null;
}

export function renderHtml(pathname: string, search: string): { status: number; html: string } {
  const m = metaFor(pathname);
  const mf = manifest();
  const canonical = new URL(pathname, env.APP_URL).toString();
  const image = m.image ?? new URL('/assets/branding/og-image.png', env.APP_URL).toString();
  const boot = { config: publicConfig() };
  void search;
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.description)}">
${m.noindex ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${esc(canonical)}">`}
<meta name="theme-color" content="#F7F6F3">
<meta property="og:site_name" content="GAZU">
<meta property="og:type" content="${m.ogType ?? (pathname.startsWith('/produto/') ? 'product' : 'website')}">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#111111">
<link rel="preload" href="/assets/branding/fonts/InterDisplay-Bold.woff" as="font" type="font/woff" crossorigin>
<link rel="preload" href="/assets/branding/fonts/Inter-Regular.woff" as="font" type="font/woff" crossorigin>
${(m.preload ?? []).map((u) => `<link rel="preload" href="${esc(u)}" as="image" fetchpriority="high">`).join('\n')}
<link rel="stylesheet" href="${esc(mf.css)}">
${m.jsonLd ? `<script type="application/ld+json">${safeJson(m.jsonLd)}</script>` : ''}
<script id="gazu-boot" type="application/json">${safeJson(boot)}</script>
</head>
<body>
<div id="root"><noscript><p style="padding:24px;font-family:sans-serif">Ative o JavaScript para navegar na loja GAZU.</p></noscript></div>
<script type="module" src="${esc(mf.js)}"></script>
</body>
</html>`;
  return { status: m.status, html };
}

export function sitemapXml(): string {
  const db = getDb();
  const urls = [
    '/',
    '/categoria/novidades',
    ...db.all<{ slug: string }>('SELECT slug FROM categories WHERE is_active = 1 ORDER BY position').map((c) => `/categoria/${c.slug}`),
    ...db.all<{ slug: string }>('SELECT slug FROM products WHERE is_active = 1 ORDER BY id').map((p) => `/produto/${p.slug}`),
    '/colecoes', '/archive', '/lookbook', '/journal', '/monte-seu-look',
    ...db.all<{ slug: string }>("SELECT slug FROM collections WHERE status IN ('active','archived') ORDER BY position").map((c) => `/colecao/${c.slug}`),
    ...db.all<{ slug: string }>("SELECT slug FROM lookbooks WHERE status = 'published' ORDER BY position").map((l) => `/lookbook/${l.slug}`),
    ...db.all<{ slug: string }>("SELECT slug FROM journal_articles WHERE status = 'published' ORDER BY published_at DESC").map((a) => `/journal/${a.slug}`),
    '/ajuda', '/pagamento', '/cancelamento', '/trocas-e-devolucoes', '/entrega', '/atendimento', '/rastreio', '/politica-de-privacidade', '/termos-de-uso',
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(new URL(u, env.APP_URL).toString())}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export function robotsTxt(): string {
  return `User-agent: *\nDisallow: /api/\nDisallow: /admin\nDisallow: /conta\nDisallow: /checkout\nDisallow: /carrinho\nDisallow: /busca\nDisallow: /pedido/\nDisallow: /newsletter/\nSitemap: ${new URL('/sitemap.xml', env.APP_URL).toString()}\n`;
}
