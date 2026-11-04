import { z } from 'zod';
import { env, features } from '../config.ts';
import { HttpError, type Router } from '../http.ts';
import { categoryTree, homeSections, popularSearches, productBySlug, productsByIds, productsBySlugs, searchCatalog } from '../services/catalog.ts';
import { getSettings } from '../services/settings.ts';
import { activeAnnouncements } from '../services/content.ts';
import { DEFECT_DAYS, WITHDRAWAL_DAYS } from '../services/returns.ts';
import { recordZeroResultSearch } from '../services/analytics.ts';
import { getDb, normalizeText } from '../db.ts';
import { rateLimit } from '../security.ts';
import type { CatalogQuery, PublicConfigDTO } from '../../shared/types.ts';

const list = (v: string | null): string[] | undefined => (v ? v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) : undefined);
const num = (v: string | null): number | undefined => (v && /^\d+$/.test(v) ? Number(v) : undefined);

export function parseCatalogQuery(sp: URLSearchParams): CatalogQuery {
  const sort = sp.get('ordem');
  return {
    category: sp.get('categoria') ?? undefined,
    q: sp.get('q')?.slice(0, 80) ?? undefined,
    audience: list(sp.get('publico')),
    size: list(sp.get('tamanho')),
    color: list(sp.get('cor')),
    type: list(sp.get('tipo')),
    minPrice: num(sp.get('min')),
    maxPrice: num(sp.get('max')),
    inStock: sp.get('estoque') === '1',
    newOnly: sp.get('novidades') === '1',
    collection: sp.get('colecao')?.slice(0, 120) || undefined,
    sort: sort === 'menor-preco' ? 'price_asc' : sort === 'maior-preco' ? 'price_desc' : sort === 'recentes' ? 'newest' : 'relevance',
    page: num(sp.get('pagina')),
    perPage: num(sp.get('por_pagina')),
  };
}

export function publicConfig(): PublicConfigDTO {
  const shippingRules = getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM shipping_rules WHERE is_active = 1')!.n;
  const s = getSettings();
  const announcements = activeAnnouncements();
  return {
    demoMode: env.DEMO_MODE,
    googleAuth: features.googleAuth,
    guestCheckout: true,
    payments: {
      provider: env.PAYMENT_PROVIDER,
      pix: features.mercadoPagoPix,
      creditCard: features.mercadoPagoCard,
      boleto: features.mercadoPagoBoleto,
      demo: features.demoPayments,
      mpPublicKey: features.mercadoPagoCard ? env.MP_PUBLIC_KEY ?? null : null,
      maxInstallments: env.MP_MAX_INSTALLMENTS,
      boletoDays: env.BOLETO_DAYS,
      pixMinutes: env.PIX_EXPIRATION_MINUTES,
    },
    shipping: { provider: env.SHIPPING_PROVIDER, configured: features.demoShipping || features.melhorEnvio || (env.SHIPPING_PROVIDER === 'manual' && shippingRules > 0) },
    announcements,
    // Somente campos públicos: custos operacionais (ex.: embalagem) nunca saem do servidor.
    settings: {
      announcements: announcements.map((a) => a.message),
      heroTagline: s.heroTagline, heroCollectionLabel: s.heroCollectionLabel, showAccessoriesOnHome: s.showAccessoriesOnHome,
      contact: s.contact, company: s.company, social: s.social, home: s.home, whatsapp: s.whatsapp, newsletter: s.newsletter,
      reviews: { enabled: s.reviews.enabled },
      policies: { exchangeDays: s.operations.exchangeDays, withdrawalDays: WITHDRAWAL_DAYS, defectDays: DEFECT_DAYS, newArrivalsDays: s.operations.newArrivalsDays },
    },
    categories: categoryTree(),
  };
}

export function registerPublicRoutes(r: Router): void {
  r.get('/api/config', () => publicConfig());
  r.get('/api/categories', () => ({ categories: categoryTree() }));
  r.get('/api/home', () => homeSections());
  r.get('/api/catalog', (ctx) => {
    const q = parseCatalogQuery(ctx.url.searchParams);
    const res = searchCatalog(q);
    // Buscas sem resultado alimentam o relatório de melhoria do catálogo (registro agregado, sem dados pessoais).
    if (q.q && res.total === 0 && (q.page ?? 1) === 1) { try { recordZeroResultSearch(q.q); } catch { /* não bloqueia a busca */ } }
    return res;
  });
  r.get('/api/products/:slug', (ctx) => {
    const p = productBySlug(ctx.params.slug!);
    if (!p) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
    return p;
  });
  r.get('/api/search/suggest', (ctx) => {
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    if (q.length < 2) return { items: [], total: 0, popular: popularSearches(6), categories: [] };
    const res = searchCatalog({ q, perPage: 6 });
    // Categorias cujo nome combina com o termo (atalhos na busca).
    const nq = normalizeText(q);
    const categories = getDb().all<{ slug: string; name: string }>('SELECT slug, name FROM categories WHERE is_active = 1 ORDER BY parent_id IS NOT NULL, position')
      .filter((c) => normalizeText(c.name).includes(nq) || nq.includes(normalizeText(c.name))).slice(0, 4);
    return { items: res.items, total: res.total, correctedQuery: res.correctedQuery ?? null, suggestions: res.suggestions ?? [], categories };
  });
  // Preenchimento de endereço por CEP (ViaCEP). Se o serviço falhar, o formulário segue manual.
  r.get('/api/cep/:cep', async (ctx) => {
    rateLimit(`cep:${ctx.ip}`, 40, 60_000);
    const cep = (ctx.params.cep ?? '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(cep)) throw new HttpError(400, 'CEP inválido.', 'invalid_cep');
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(4000) });
      const j = (await resp.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (!resp.ok || j.erro) return { found: false };
      return { found: true, street: j.logradouro ?? '', district: j.bairro ?? '', city: j.localidade ?? '', state: j.uf ?? '' };
    } catch {
      return { found: false, unavailable: true };
    }
  });
  // Usado pelos favoritos de visitantes (guardados no navegador) para obter os dados atuais dos produtos.
  r.post('/api/products/lookup', async (ctx) => {
    const body = await ctx.body(z.object({ slugs: z.array(z.string().max(120)).max(100).optional(), ids: z.array(z.number().int().positive()).max(100).optional() }));
    return { items: body.ids ? productsByIds(body.ids) : productsBySlugs(body.slugs ?? []) };
  });
}
