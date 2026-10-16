import { z } from 'zod';
import { env, features } from '../config.ts';
import { HttpError, type Router } from '../http.ts';
import { categoryTree, homeSections, productBySlug, productsByIds, productsBySlugs, searchCatalog } from '../services/catalog.ts';
import { getSettings } from '../services/settings.ts';
import { getDb } from '../db.ts';
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
    sort: sort === 'menor-preco' ? 'price_asc' : sort === 'maior-preco' ? 'price_desc' : sort === 'recentes' ? 'newest' : 'relevance',
    page: num(sp.get('pagina')),
    perPage: num(sp.get('por_pagina')),
  };
}

export function publicConfig(): PublicConfigDTO {
  const shippingRules = getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM shipping_rules WHERE is_active = 1')!.n;
  return {
    demoMode: env.DEMO_MODE,
    googleAuth: features.googleAuth,
    payments: {
      provider: env.PAYMENT_PROVIDER,
      pix: features.mercadoPagoPix,
      creditCard: features.mercadoPagoCard,
      demo: features.demoPayments,
      mpPublicKey: features.mercadoPagoCard ? env.MP_PUBLIC_KEY ?? null : null,
      maxInstallments: env.MP_MAX_INSTALLMENTS,
    },
    shipping: { provider: env.SHIPPING_PROVIDER, configured: features.demoShipping || shippingRules > 0 },
    settings: getSettings(),
    categories: categoryTree(),
  };
}

export function registerPublicRoutes(r: Router): void {
  r.get('/api/config', () => publicConfig());
  r.get('/api/categories', () => ({ categories: categoryTree() }));
  r.get('/api/home', () => homeSections());
  r.get('/api/catalog', (ctx) => searchCatalog(parseCatalogQuery(ctx.url.searchParams)));
  r.get('/api/products/:slug', (ctx) => {
    const p = productBySlug(ctx.params.slug!);
    if (!p) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
    return p;
  });
  r.get('/api/search/suggest', (ctx) => {
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    if (q.length < 2) return { items: [], total: 0 };
    const res = searchCatalog({ q, perPage: 6 });
    return { items: res.items, total: res.total };
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
