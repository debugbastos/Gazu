import { HttpError, type Router } from '../http.ts';
import { faqFor, quickProducts, sizeGuideById } from '../services/catalog.ts';
import {
  articleBySlug, collectionBySlug, homeContent, listArticles, listCollections, listLookbooks, lookbookBySlug, pageBySlug,
} from '../services/content.ts';
import { getDb } from '../db.ts';

const FAQ_CATEGORIES = ['geral', 'pedidos', 'pagamento', 'entrega', 'trocas', 'produtos', 'conta', 'privacidade'];

export function registerContentRoutes(r: Router): void {
  r.get('/api/content/home', () => homeContent());

  r.get('/api/collections', () => ({ collections: listCollections('active') }));
  r.get('/api/archive', () => ({ collections: listCollections('archived') }));
  r.get('/api/collections/:slug', (ctx) => {
    const c = collectionBySlug(ctx.params.slug!);
    if (!c) throw new HttpError(404, 'Coleção não encontrada.', 'not_found');
    return c;
  });

  r.get('/api/lookbooks', () => ({ lookbooks: listLookbooks() }));
  r.get('/api/lookbooks/:slug', (ctx) => {
    const l = lookbookBySlug(ctx.params.slug!);
    if (!l) throw new HttpError(404, 'Lookbook não encontrado.', 'not_found');
    return l;
  });

  r.get('/api/journal', (ctx) => {
    const cat = ctx.url.searchParams.get('categoria') ?? undefined;
    return { articles: listArticles({ category: cat, limit: 48 }) };
  });
  r.get('/api/journal/:slug', (ctx) => {
    const a = articleBySlug(ctx.params.slug!);
    if (!a) throw new HttpError(404, 'Artigo não encontrado.', 'not_found');
    return a;
  });

  r.get('/api/pages/:slug', (ctx) => {
    const p = pageBySlug(ctx.params.slug!);
    if (!p) throw new HttpError(404, 'Página não encontrada.', 'not_found');
    return p;
  });

  r.get('/api/faq', (ctx) => {
    const cat = ctx.url.searchParams.get('categoria');
    return { items: faqFor(null, cat && FAQ_CATEGORIES.includes(cat) ? cat : undefined) };
  });

  r.get('/api/size-guides/:id', (ctx) => {
    const g = sizeGuideById(Number(ctx.params.id));
    if (!g) throw new HttpError(404, 'Guia não encontrado.', 'not_found');
    return g;
  });

  // "Monte seu look": produtos com variantes resumidas (preços e estoque sempre do servidor).
  r.get('/api/looks/products', (ctx) => {
    const ids = (ctx.url.searchParams.get('ids') ?? '').split(',').map(Number).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 12);
    return { products: quickProducts(ids) };
  });
  r.get('/api/looks/builder', (ctx) => {
    // Peças sugeridas por grupo (parte de cima, de baixo, calçados, acessórios) dentro do público escolhido.
    const audience = ctx.url.searchParams.get('publico') ?? '';
    const allowed = ['masculino', 'feminino', 'menino', 'menina', 'unissex'];
    const aud = allowed.includes(audience) ? audience : null;
    const db = getDb();
    const group = (types: string[], limit = 12) => {
      const rows = db.all<{ id: number }>(
        `SELECT p.id FROM products p WHERE p.is_active = 1 AND p.product_type IN (${types.map(() => '?').join(',')})
           ${aud ? "AND (p.audience = ? OR p.audience = 'unissex')" : ''}
           AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock > 0)
         ORDER BY p.is_featured DESC, p.id DESC LIMIT ?`, ...types, ...(aud ? [aud] : []), limit,
      );
      return quickProducts(rows.map((r2) => r2.id));
    };
    return {
      groups: [
        { key: 'top', label: 'Parte de cima', products: group(['Camiseta', 'Camisa', 'Blusa', 'Regata', 'Cropped', 'Moletom', 'Jaqueta', 'Casaco', 'Suéter', 'Conjunto', 'Vestido']) },
        { key: 'bottom', label: 'Parte de baixo', products: group(['Calça', 'Short', 'Bermuda', 'Saia', 'Jardineira']) },
        { key: 'shoes', label: 'Calçados', products: group(['Tênis']) },
        { key: 'accessories', label: 'Acessórios', products: group(['Boné', 'Chapéu', 'Colar', 'Pulseira', 'Relógio', 'Anel', 'Bolsa', 'Kit']) },
      ].filter((g) => g.products.length),
    };
  });
}
