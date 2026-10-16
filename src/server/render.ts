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
  status: number;
  preload?: string[];
}

const SITE = 'GAZU';
const DEFAULT_DESC = 'GAZU — moda masculina, feminina e infantil, tênis e acessórios com curadoria editorial.';
const PRIVATE_PREFIXES = ['/carrinho', '/checkout', '/conta', '/pedidos', '/admin', '/entrar', '/cadastro', '/recuperar-senha', '/redefinir-senha', '/favoritos', '/busca'];

export function metaFor(pathname: string): Meta {
  const base: Meta = { title: `${SITE} — Moda que se move com você`, description: DEFAULT_DESC, status: 200 };
  if (pathname === '/') {
    return { ...base, preload: ['/assets/hero/male/male-700.webp'], jsonLd: { '@context': 'https://schema.org', '@type': 'OnlineStore', name: SITE, url: env.APP_URL } };
  }
  if (PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return { ...base, title: `${SITE}`, noindex: true };
  const cat = /^\/categoria\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (cat) {
    if (cat[1] === 'novidades') return { ...base, title: `Novidades — ${SITE}`, description: 'As peças mais recentes da GAZU.' };
    const c = getDb().get<{ name: string; description: string | null }>('SELECT name, description FROM categories WHERE slug = ? AND is_active = 1', cat[1]!);
    if (!c) return { ...base, title: `Página não encontrada — ${SITE}`, noindex: true, status: 404 };
    return { ...base, title: `${c.name} — ${SITE}`, description: c.description ?? `${c.name} na GAZU.` };
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
    return { ...base, title: `${p.seoTitle || p.name} — ${SITE}`, description: p.seoDescription || p.description.slice(0, 160), image, jsonLd, preload: p.images[0] ? [p.images[0].url] : [] };
  }
  const known = ['/politica-de-privacidade', '/termos-de-uso', '/trocas-e-devolucoes', '/entrega', '/atendimento', '/rastrear-pedido'];
  if (known.includes(pathname.replace(/\/$/, ''))) return base;
  return { ...base, title: `Página não encontrada — ${SITE}`, noindex: true, status: 404 };
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
<meta property="og:type" content="${pathname.startsWith('/produto/') ? 'product' : 'website'}">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
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
    '/trocas-e-devolucoes', '/entrega', '/atendimento', '/politica-de-privacidade', '/termos-de-uso',
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(new URL(u, env.APP_URL).toString())}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export function robotsTxt(): string {
  return `User-agent: *\nDisallow: /api/\nDisallow: /admin\nDisallow: /conta\nDisallow: /checkout\nDisallow: /carrinho\nDisallow: /busca\nSitemap: ${new URL('/sitemap.xml', env.APP_URL).toString()}\n`;
}
