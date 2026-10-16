import { getDb, normalizeText, nowIso, type Param } from '../db.ts';
import type {
  BreadcrumbDTO, CatalogQuery, CatalogResultDTO, CategoryDTO, ColorDTO, FacetValue, ImageDTO, ProductCardDTO, ProductDetailDTO, VariantDTO, Audience,
} from '../../shared/types.ts';
import { AUDIENCE_LABEL } from '../../shared/format.ts';

interface ProductRow {
  id: number; slug: string; name: string; description: string; details: string | null; audience: Audience; product_type: string;
  primary_category_id: number | null; price_cents: number; promo_price_cents: number | null; promo_starts_at: string | null; promo_ends_at: string | null;
  is_active: number; is_featured: number; is_demo: number; color_confirmed: number; seo_title: string | null; seo_description: string | null; created_at: string;
}
interface ImageRow { id: number; product_id: number; url: string; srcset: string | null; width: number | null; height: number | null; alt: string; color_name: string | null; object_position: string; position: number }
interface VariantRow { id: number; product_id: number; sku: string; color_name: string; color_hex: string | null; size: string; size_order: number; price_cents: number | null; stock: number; is_active: number }
interface CategoryRow { id: number; slug: string; name: string; description: string | null; parent_id: number | null; position: number; is_active: number; image_url: string | null }

/** Preço promocional vigente (null = sem promoção ativa). */
export function activePromo(p: Pick<ProductRow, 'promo_price_cents' | 'promo_starts_at' | 'promo_ends_at' | 'price_cents'>, now = nowIso()): number | null {
  if (!p.promo_price_cents || p.promo_price_cents >= p.price_cents) return null;
  if (p.promo_starts_at && p.promo_starts_at > now) return null;
  if (p.promo_ends_at && p.promo_ends_at < now) return null;
  return p.promo_price_cents;
}

/** Preço unitário efetivo de uma variante (sobrescrita da variante > promoção > preço base). */
export function variantUnitPrice(p: ProductRow | Pick<ProductRow, 'promo_price_cents' | 'promo_starts_at' | 'promo_ends_at' | 'price_cents'>, v: Pick<VariantRow, 'price_cents'>): { unit: number; original: number } {
  if (v.price_cents) return { unit: v.price_cents, original: v.price_cents };
  const promo = activePromo(p);
  return { unit: promo ?? p.price_cents, original: p.price_cents };
}

const toImage = (r: ImageRow): ImageDTO => ({ url: r.url, srcset: r.srcset, width: r.width, height: r.height, alt: r.alt, position: r.object_position, colorName: r.color_name });

const toCategory = (r: CategoryRow): CategoryDTO => ({ id: r.id, slug: r.slug, name: r.name, description: r.description, imageUrl: r.image_url, parentId: r.parent_id, position: r.position, isActive: Boolean(r.is_active) });

export function listCategories(includeInactive = false): CategoryDTO[] {
  const rows = getDb().all<CategoryRow & { product_count: number }>(
    `SELECT c.*, (SELECT COUNT(*) FROM product_categories pc JOIN products p ON p.id = pc.product_id AND p.is_active = 1 WHERE pc.category_id = c.id) AS product_count
       FROM categories c ${includeInactive ? '' : 'WHERE c.is_active = 1'} ORDER BY c.position, c.name`,
  );
  return rows.map((r) => ({ ...toCategory(r), productCount: r.product_count }));
}

export function categoryTree(includeInactive = false): CategoryDTO[] {
  const flat = listCategories(includeInactive);
  const byId = new Map(flat.map((c) => [c.id, { ...c, children: [] as CategoryDTO[] }]));
  const roots: CategoryDTO[] = [];
  for (const c of byId.values()) {
    if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId)!.children!.push(c);
    else if (!c.parentId) roots.push(c);
  }
  // contagem agregada (produtos distintos na árvore)
  for (const root of roots) {
    const ids = [root.id, ...(root.children ?? []).map((c) => c.id)];
    root.productCount = getDb().get<{ n: number }>(
      `SELECT COUNT(DISTINCT pc.product_id) AS n FROM product_categories pc JOIN products p ON p.id = pc.product_id AND p.is_active = 1 WHERE pc.category_id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    )!.n;
  }
  return roots;
}

function categoryChain(id: number | null): CategoryRow[] {
  const chain: CategoryRow[] = [];
  let cur = id;
  for (let guard = 0; cur && guard < 6; guard++) {
    const row = getDb().get<CategoryRow>('SELECT * FROM categories WHERE id = ?', cur);
    if (!row) break;
    chain.unshift(row);
    cur = row.parent_id;
  }
  return chain;
}

const crumbs = (chain: CategoryRow[]): BreadcrumbDTO[] => [{ name: 'Início', href: '/' }, ...chain.map((c) => ({ name: c.name, href: `/categoria/${c.slug}` }))];

function descendantIds(rootId: number): number[] {
  const rows = getDb().all<{ id: number }>(
    `WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id WHERE c.is_active = 1) SELECT id FROM t`,
    rootId,
  );
  return rows.map((r) => r.id);
}

/** Monta os cartões de produto em lote (imagem principal, cores e disponibilidade). */
export function cardsFor(rows: ProductRow[]): ProductCardDTO[] {
  if (!rows.length) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  const images = db.all<ImageRow>(`SELECT * FROM product_images WHERE product_id IN (${ph}) ORDER BY product_id, position`, ...ids);
  const variants = db.all<VariantRow>(`SELECT * FROM product_variants WHERE is_active = 1 AND product_id IN (${ph}) ORDER BY size_order`, ...ids);
  const firstImage = new Map<number, ImageRow>();
  for (const im of images) if (!firstImage.has(im.product_id)) firstImage.set(im.product_id, im);
  const colors = new Map<number, Map<string, ColorDTO>>();
  const stock = new Map<number, number>();
  for (const v of variants) {
    if (!colors.has(v.product_id)) colors.set(v.product_id, new Map());
    colors.get(v.product_id)!.set(v.color_name, { name: v.color_name, hex: v.color_hex });
    stock.set(v.product_id, (stock.get(v.product_id) ?? 0) + v.stock);
  }
  return rows.map((r) => {
    const im = firstImage.get(r.id);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      type: r.product_type,
      audience: r.audience,
      priceCents: r.price_cents,
      promoPriceCents: activePromo(r),
      image: im ? toImage(im) : null,
      colors: [...(colors.get(r.id)?.values() ?? [])],
      available: (stock.get(r.id) ?? 0) > 0,
      isDemo: Boolean(r.is_demo),
      createdAt: r.created_at,
    };
  });
}

const EFFECTIVE_PRICE = `(CASE WHEN p.promo_price_cents IS NOT NULL AND p.promo_price_cents < p.price_cents
  AND (p.promo_starts_at IS NULL OR p.promo_starts_at <= :now) AND (p.promo_ends_at IS NULL OR p.promo_ends_at >= :now)
  THEN p.promo_price_cents ELSE p.price_cents END)`;

export function searchCatalog(q: CatalogQuery): CatalogResultDTO {
  const db = getDb();
  const now = nowIso();
  const perPage = Math.min(Math.max(q.perPage ?? 24, 1), 60);
  const page = Math.max(q.page ?? 1, 1);

  let category: CatalogResultDTO['category'] = null;
  const baseWhere: string[] = ['p.is_active = 1'];
  const baseParams: Param[] = [];

  if (q.category && q.category !== 'novidades') {
    const cat = db.get<CategoryRow>('SELECT * FROM categories WHERE slug = ? AND is_active = 1', q.category);
    if (!cat) return emptyResult(page, perPage);
    const ids = descendantIds(cat.id);
    baseWhere.push(`p.id IN (SELECT product_id FROM product_categories WHERE category_id IN (${ids.map(() => '?').join(',')}))`);
    baseParams.push(...ids);
    const subs = db.all<CategoryRow>('SELECT * FROM categories WHERE parent_id = ? AND is_active = 1 ORDER BY position', cat.id);
    category = { ...toCategory(cat), breadcrumbs: crumbs(categoryChain(cat.id)), subcategories: subs.map(toCategory) };
  } else if (q.category === 'novidades') {
    category = {
      id: 0, slug: 'novidades', name: 'Novidades', description: 'As peças mais recentes da GAZU.', imageUrl: null, parentId: null, position: 0, isActive: true,
      breadcrumbs: [{ name: 'Início', href: '/' }, { name: 'Novidades', href: '/categoria/novidades' }], subcategories: [],
    };
  }

  const tokens = q.q ? normalizeText(q.q).split(/\s+/).filter((t) => t.length > 0).slice(0, 8) : [];
  for (const t of tokens) {
    const like = `%${t.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    baseWhere.push(`(gz_norm(p.name) LIKE ? ESCAPE '\\' OR gz_norm(p.description) LIKE ? ESCAPE '\\' OR gz_norm(p.product_type) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = p.id AND gz_norm(c.name) LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (gz_norm(v.color_name) LIKE ? ESCAPE '\\' OR gz_norm(v.sku) LIKE ? ESCAPE '\\')))`);
    baseParams.push(like, like, like, like, like, like);
  }

  // Filtros adicionais (não aplicados às facetas, para que o usuário veja as alternativas)
  const where = [...baseWhere];
  const params: Param[] = [...baseParams];
  if (q.audience?.length) {
    where.push(`p.audience IN (${q.audience.map(() => '?').join(',')})`);
    params.push(...q.audience);
  }
  if (q.type?.length) {
    where.push(`p.product_type IN (${q.type.map(() => '?').join(',')})`);
    params.push(...q.type);
  }
  const vConds: string[] = ['v.is_active = 1'];
  const vParams: Param[] = [];
  if (q.size?.length) { vConds.push(`v.size IN (${q.size.map(() => '?').join(',')})`); vParams.push(...q.size); }
  if (q.color?.length) { vConds.push(`v.color_name IN (${q.color.map(() => '?').join(',')})`); vParams.push(...q.color); }
  if (q.inStock) vConds.push('v.stock > 0');
  if (vConds.length > 1) {
    where.push(`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND ${vConds.join(' AND ')})`);
    params.push(...vParams);
  }
  const eff = EFFECTIVE_PRICE.replaceAll(':now', '?');
  const effParams = [now, now];
  if (q.minPrice !== undefined) { where.push(`${eff} >= ?`); params.push(...effParams, q.minPrice); }
  if (q.maxPrice !== undefined) { where.push(`${eff} <= ?`); params.push(...effParams, q.maxPrice); }

  const order =
    q.sort === 'price_asc' ? `${eff} ASC, p.id ASC`
    : q.sort === 'price_desc' ? `${eff} DESC, p.id ASC`
    : q.sort === 'newest' || q.category === 'novidades' ? 'p.created_at DESC, p.id DESC'
    : 'p.is_featured DESC, p.id ASC';
  const orderParams = q.sort === 'price_asc' || q.sort === 'price_desc' ? effParams : [];

  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM products p WHERE ${where.join(' AND ')}`, ...params)!.n;
  const rows = db.all<ProductRow>(
    `SELECT p.* FROM products p WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params, ...orderParams, perPage, (page - 1) * perPage,
  );

  // Facetas sobre o conjunto base (categoria + busca)
  const bw = baseWhere.join(' AND ');
  const audience = db.all<{ value: string; count: number }>(`SELECT p.audience AS value, COUNT(*) AS count FROM products p WHERE ${bw} GROUP BY p.audience ORDER BY count DESC`, ...baseParams)
    .map((r): FacetValue => ({ value: r.value, label: AUDIENCE_LABEL[r.value] ?? r.value, count: r.count }));
  const type = db.all<{ value: string; count: number }>(`SELECT p.product_type AS value, COUNT(*) AS count FROM products p WHERE ${bw} GROUP BY p.product_type ORDER BY p.product_type`, ...baseParams)
    .map((r): FacetValue => ({ value: r.value, label: r.value, count: r.count }));
  const size = db.all<{ value: string; count: number; ord: number }>(
    `SELECT v.size AS value, COUNT(DISTINCT p.id) AS count, MIN(v.size_order) AS ord FROM products p JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1 WHERE ${bw} GROUP BY v.size ORDER BY ord`, ...baseParams,
  ).map((r): FacetValue => ({ value: r.value, label: r.value, count: r.count }));
  const color = db.all<{ value: string; count: number; hex: string | null }>(
    `SELECT v.color_name AS value, COUNT(DISTINCT p.id) AS count, MAX(v.color_hex) AS hex FROM products p JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1 WHERE ${bw} GROUP BY v.color_name ORDER BY count DESC, value LIMIT 40`, ...baseParams,
  ).map((r): FacetValue => ({ value: r.value, label: r.value, count: r.count, hex: r.hex }));
  const pr = db.get<{ min: number | null; max: number | null }>(`SELECT MIN(${eff}) AS min, MAX(${eff}) AS max FROM products p WHERE ${bw}`, ...effParams, ...effParams, ...baseParams);

  return {
    items: cardsFor(rows),
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    facets: { audience, size, color, type, price: { min: pr?.min ?? 0, max: pr?.max ?? 0 } },
    category,
  };
}

function emptyResult(page: number, perPage: number): CatalogResultDTO {
  return { items: [], total: 0, page, perPage, pages: 1, facets: { audience: [], size: [], color: [], type: [], price: { min: 0, max: 0 } }, category: null };
}

export function productBySlug(slug: string): (ProductDetailDTO & { seoTitle: string | null; seoDescription: string | null }) | null {
  const db = getDb();
  const p = db.get<ProductRow>('SELECT * FROM products WHERE slug = ? AND is_active = 1', slug);
  if (!p) return null;
  const card = cardsFor([p])[0]!;
  const images = db.all<ImageRow>('SELECT * FROM product_images WHERE product_id = ? ORDER BY position', p.id).map(toImage);
  const variants = db.all<VariantRow>('SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY color_name, size_order', p.id).map((v): VariantDTO => {
    const price = variantUnitPrice(p, v);
    return { id: v.id, sku: v.sku, colorName: v.color_name, colorHex: v.color_hex, size: v.size, sizeOrder: v.size_order, priceCents: price.original, promoPriceCents: price.unit < price.original ? price.unit : null, stock: v.stock };
  });
  const catSlugs = db.all<{ slug: string }>('SELECT c.slug FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = ?', p.id).map((r) => r.slug);
  const chain = categoryChain(p.primary_category_id);
  // Relacionados: mesma subcategoria primeiro, depois o restante do departamento (ex.: Masculino),
  // priorizando itens com estoque. Evita lista vazia quando a subcategoria tem um único produto.
  const rootId = chain[0]?.id ?? p.primary_category_id ?? 0;
  const related = db.all<ProductRow>(
    `SELECT p.* FROM products p
      WHERE p.is_active = 1 AND p.id <> ?
        AND p.id IN (SELECT pc.product_id FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE c.id = ? OR c.parent_id = ?)
      ORDER BY EXISTS (SELECT 1 FROM product_categories x WHERE x.product_id = p.id AND x.category_id = ?) DESC,
               (SELECT SUM(stock) FROM product_variants v WHERE v.product_id = p.id) > 0 DESC, p.is_featured DESC, p.id LIMIT 6`,
    p.id, rootId, rootId, p.primary_category_id ?? 0,
  );
  return {
    ...card,
    description: p.description,
    details: p.details,
    images,
    variants,
    breadcrumbs: [...crumbs(chain), { name: p.name, href: `/produto/${p.slug}` }],
    categorySlugs: catSlugs,
    colorConfirmed: Boolean(p.color_confirmed),
    related: cardsFor(related),
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
  };
}

export function productsBySlugs(slugs: string[]): ProductCardDTO[] {
  if (!slugs.length) return [];
  const rows = getDb().all<ProductRow>(`SELECT * FROM products WHERE is_active = 1 AND slug IN (${slugs.map(() => '?').join(',')})`, ...slugs);
  const map = new Map(cardsFor(rows).map((c) => [c.slug, c]));
  return slugs.map((s) => map.get(s)).filter((c): c is ProductCardDTO => Boolean(c));
}

export function productsByIds(ids: number[]): ProductCardDTO[] {
  if (!ids.length) return [];
  const rows = getDb().all<ProductRow>(`SELECT * FROM products WHERE is_active = 1 AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const map = new Map(cardsFor(rows).map((c) => [c.id, c]));
  return ids.map((s) => map.get(s)).filter((c): c is ProductCardDTO => Boolean(c));
}

export function homeSections(): Record<string, ProductCardDTO[]> {
  const db = getDb();
  const take = (sql: string, ...params: Param[]) => cardsFor(db.all<ProductRow>(sql, ...params));
  const inCat = (slug: string, limit: number, order = 'p.is_featured DESC, p.id') =>
    take(
      `SELECT p.* FROM products p WHERE p.is_active = 1 AND p.id IN (
         SELECT pc.product_id FROM product_categories pc WHERE pc.category_id IN (
           WITH RECURSIVE t(id) AS (SELECT id FROM categories WHERE slug = ? UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id) SELECT id FROM t))
       ORDER BY ${order} LIMIT ?`, slug, limit);
  // Cada vitrine exclui produtos já exibidos nas anteriores (a home não repete peças).
  const shown = new Set<number>();
  const fresh = (list: ProductCardDTO[], n: number): ProductCardDTO[] => {
    const out = list.filter((p) => !shown.has(p.id)).slice(0, n);
    for (const p of out) shown.add(p.id);
    return out;
  };
  const featured = fresh(take('SELECT p.* FROM products p WHERE p.is_active = 1 AND p.is_featured = 1 ORDER BY p.id LIMIT 8'), 8);
  const newest = fresh(take('SELECT p.* FROM products p WHERE p.is_active = 1 ORDER BY p.created_at DESC, p.id DESC LIMIT 24'), 8);
  const clothing = fresh(take(`SELECT p.* FROM products p WHERE p.is_active = 1 AND p.product_type NOT IN ('Tênis','Boné','Chapéu','Colar','Pulseira','Relógio','Anel','Bolsa')
                                ORDER BY p.audience = 'feminino' DESC, p.id DESC LIMIT 40`), 8);
  const sneakers = fresh(inCat('tenis', 24), 8);
  const accessories = fresh(inCat('acessorios', 24), 8);
  return { featured, newest, clothing, sneakers, accessories };
}
