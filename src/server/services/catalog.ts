import { getDb, normalizeText, nowIso, type Param } from '../db.ts';
import type {
  BreadcrumbDTO, CatalogQuery, CatalogResultDTO, CategoryDTO, ColorDTO, FacetValue, ImageDTO, ProductCardDTO, ProductDetailDTO, VariantDTO, Audience,
} from '../../shared/types.ts';
import { AUDIENCE_LABEL } from '../../shared/format.ts';
import type { FaqItemDTO, LookbookCardDTO, QuickProductDTO, QuickVariantDTO, ReviewSummaryDTO, SizeGuideDTO } from '../../shared/types.ts';
import { renderMarkdown } from '../../shared/markdown.ts';
import { getSettings } from './settings.ts';

interface ProductRow {
  id: number; slug: string; name: string; description: string; details: string | null; audience: Audience; product_type: string;
  primary_category_id: number | null; price_cents: number; promo_price_cents: number | null; promo_starts_at: string | null; promo_ends_at: string | null;
  is_active: number; is_featured: number; is_demo: number; color_confirmed: number; seo_title: string | null; seo_description: string | null; created_at: string;
  published_at?: string | null; brand?: string | null; composition?: string | null; care_instructions?: string | null; fit_notes?: string | null; size_guide_id?: number | null;
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
  const secondImage = new Map<number, ImageRow>();
  const byColor = new Map<number, Record<string, ImageDTO>>();
  for (const im of images) {
    if (!firstImage.has(im.product_id)) firstImage.set(im.product_id, im);
    else if (!secondImage.has(im.product_id) && !im.color_name) secondImage.set(im.product_id, im);
    if (im.color_name) {
      const m = byColor.get(im.product_id) ?? {};
      if (!m[im.color_name]) m[im.color_name] = toImage(im);
      byColor.set(im.product_id, m);
    }
  }
  const settings = getSettings();
  const newSince = new Date(Date.now() - settings.operations.newArrivalsDays * 86400_000).toISOString();
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
      hoverImage: secondImage.has(r.id) ? toImage(secondImage.get(r.id)!) : null,
      colorImages: byColor.get(r.id),
      isNew: (r.published_at ?? r.created_at) >= newSince,
      lowStock: (stock.get(r.id) ?? 0) > 0 && (stock.get(r.id) ?? 0) <= 3,
    };
  });
}

/** Produtos com variantes resumidas (lookbook comprável, "Monte seu look", "Compre o visual"). */
export function quickProducts(ids: number[]): QuickProductDTO[] {
  if (!ids.length) return [];
  const db = getDb();
  const rows = db.all<ProductRow>(`SELECT * FROM products WHERE is_active = 1 AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const cards = new Map(cardsFor(rows).map((c) => [c.id, c]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const variants = db.all<VariantRow>(`SELECT * FROM product_variants WHERE is_active = 1 AND product_id IN (${ids.map(() => '?').join(',')}) ORDER BY color_name, size_order`, ...ids);
  const vmap = new Map<number, QuickVariantDTO[]>();
  for (const v of variants) {
    const p = byId.get(v.product_id);
    if (!p) continue;
    const price = variantUnitPrice(p, v);
    const list = vmap.get(v.product_id) ?? [];
    list.push({ id: v.id, colorName: v.color_name, colorHex: v.color_hex, size: v.size, stock: v.stock, priceCents: price.original, promoPriceCents: price.unit < price.original ? price.unit : null });
    vmap.set(v.product_id, list);
  }
  return ids.map((id) => cards.get(id)).filter((c): c is ProductCardDTO => Boolean(c)).map((c) => ({ ...c, variants: vmap.get(c.id) ?? [] }));
}

export function reviewSummary(productId: number): ReviewSummaryDTO {
  const rows = getDb().all<{ rating: number; n: number }>("SELECT rating, COUNT(*) AS n FROM reviews WHERE product_id = ? AND status = 'approved' GROUP BY rating", productId);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as ReviewSummaryDTO['distribution'];
  let count = 0, sum = 0;
  for (const r of rows) { distribution[r.rating as 1] = r.n; count += r.n; sum += r.rating * r.n; }
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : null, distribution };
}

export function sizeGuideById(id: number | null | undefined): SizeGuideDTO | null {
  if (!id) return null;
  const g = getDb().get<{ id: number; name: string; table_json: string; note: string | null; is_demo: number }>('SELECT * FROM size_guides WHERE id = ?', id);
  if (!g) return null;
  try {
    const t = JSON.parse(g.table_json) as { head: string[]; rows: string[][] };
    return { id: g.id, name: g.name, head: t.head ?? [], rows: t.rows ?? [], note: g.note, isDemo: Boolean(g.is_demo) };
  } catch {
    return null;
  }
}

export function lookbooksForProduct(productId: number): LookbookCardDTO[] {
  return getDb().all<{ id: number; slug: string; title: string; description: string; cover_url: string | null; is_demo: number; published_at: string | null; n: number }>(
    `SELECT l.*, (SELECT COUNT(DISTINCT product_id) FROM lookbook_products x WHERE x.lookbook_id = l.id) AS n FROM lookbooks l
      WHERE l.status = 'published' AND EXISTS (SELECT 1 FROM lookbook_products lp WHERE lp.lookbook_id = l.id AND lp.product_id = ?) ORDER BY l.position, l.id DESC LIMIT 3`, productId,
  ).map((l) => ({ id: l.id, slug: l.slug, title: l.title, description: l.description, coverUrl: l.cover_url, productCount: l.n, isDemo: Boolean(l.is_demo), publishedAt: l.published_at }));
}

export function faqFor(productId: number | null, category?: string): FaqItemDTO[] {
  const db = getDb();
  const rows = productId
    ? db.all<{ id: number; category: string; question: string; answer: string }>('SELECT * FROM faq_items WHERE is_active = 1 AND product_id = ? ORDER BY position, id', productId)
    : db.all<{ id: number; category: string; question: string; answer: string }>(`SELECT * FROM faq_items WHERE is_active = 1 AND product_id IS NULL ${category ? 'AND category = ?' : ''} ORDER BY category, position, id`, ...(category ? [category] : []));
  return rows.map((f) => ({ id: f.id, category: f.category, question: f.question, html: renderMarkdown(f.answer) }));
}

const EFFECTIVE_PRICE = `(CASE WHEN p.promo_price_cents IS NOT NULL AND p.promo_price_cents < p.price_cents
  AND (p.promo_starts_at IS NULL OR p.promo_starts_at <= :now) AND (p.promo_ends_at IS NULL OR p.promo_ends_at >= :now)
  THEN p.promo_price_cents ELSE p.price_cents END)`;

/** Normaliza um termo de busca: sem acentos, minúsculo, singular aproximado ("camisetas" → "camiseta"). */
export function searchTokens(q: string): string[] {
  return normalizeText(q).replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((t) => t.length > 0).slice(0, 8)
    .map((t) => (t.length >= 5 && t.endsWith('s') ? t.slice(0, -1) : t));
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

let vocab: { at: number; words: string[] } | null = null;
/** Vocabulário do catálogo (nomes, tipos, categorias, cores) para corrigir erros de digitação. */
function catalogVocabulary(): string[] {
  if (vocab && Date.now() - vocab.at < 5 * 60_000) return vocab.words;
  const db = getDb();
  const texts = [
    ...db.all<{ t: string }>('SELECT name || \' \' || product_type AS t FROM products WHERE is_active = 1'),
    ...db.all<{ t: string }>('SELECT name AS t FROM categories WHERE is_active = 1'),
    ...db.all<{ t: string }>('SELECT DISTINCT color_name AS t FROM product_variants WHERE is_active = 1'),
  ];
  const words = new Set<string>();
  for (const { t } of texts) for (const w of normalizeText(t).split(/[^a-z0-9]+/)) if (w.length >= 3) words.add(w);
  vocab = { at: Date.now(), words: [...words] };
  return vocab.words;
}

/** Sugere uma grafia alternativa para termos sem resultado (ex.: "camiseya" → "camiseta"). */
export function correctQuery(q: string): string | null {
  const words = catalogVocabulary();
  let changed = false;
  const out = normalizeText(q).split(/\s+/).filter(Boolean).map((t) => {
    if (t.length < 3 || words.some((w) => w.includes(t) || t.includes(w))) return t;
    let best: string | null = null;
    let bestD = t.length > 5 ? 3 : 2;
    for (const w of words) {
      const d = levenshtein(t, w);
      if (d < bestD) { bestD = d; best = w; }
    }
    if (best) { changed = true; return best; }
    return t;
  });
  return changed ? out.join(' ') : null;
}

export function searchCatalog(q: CatalogQuery): CatalogResultDTO {
  const first = runSearch(q);
  if (first.total > 0 || !q.q) return first;
  const corrected = correctQuery(q.q);
  if (corrected && corrected !== normalizeText(q.q)) {
    const second = runSearch({ ...q, q: corrected });
    if (second.total > 0) return { ...second, correctedQuery: corrected };
  }
  return { ...first, suggestions: popularSearches(5) };
}

/** Termos mais buscados (com resultados) nos últimos 30 dias — dados reais de analytics, quando houver. */
export function popularSearches(limit = 6): string[] {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  return getDb().all<{ t: string }>(
    `SELECT lower(search_term) AS t, COUNT(*) AS n FROM analytics_events WHERE event = 'search' AND results_count > 0 AND created_at >= ? AND search_term IS NOT NULL
      GROUP BY lower(search_term) ORDER BY n DESC LIMIT ?`, since, limit,
  ).map((r) => r.t);
}

function runSearch(q: CatalogQuery): CatalogResultDTO {
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

  if (q.collection) {
    baseWhere.push(`p.id IN (SELECT cp.product_id FROM collection_products cp JOIN collections col ON col.id = cp.collection_id WHERE col.slug = ? AND col.status IN ('active', 'archived'))`);
    baseParams.push(q.collection);
  }
  const tokens = q.q ? searchTokens(q.q) : [];
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
  const newSince = new Date(Date.now() - getSettings().operations.newArrivalsDays * 86400_000).toISOString();
  if (q.newOnly || q.category === 'novidades') {
    where.push('COALESCE(p.published_at, p.created_at) >= ?');
    params.push(newSince);
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
  const collections = db.all<{ value: string; label: string; count: number }>(
    `SELECT col.slug AS value, col.name AS label, COUNT(DISTINCT p.id) AS count FROM products p JOIN collection_products cp ON cp.product_id = p.id
       JOIN collections col ON col.id = cp.collection_id AND col.status = 'active' WHERE ${bw} GROUP BY col.id ORDER BY col.position, col.name`, ...baseParams,
  ).map((r): FacetValue => ({ value: r.value, label: r.label, count: r.count }));
  const newCount = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM products p WHERE ${bw} AND COALESCE(p.published_at, p.created_at) >= ?`, ...baseParams, newSince)!.n;

  return {
    items: cardsFor(rows),
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    facets: { audience, size, color, type, price: { min: pr?.min ?? 0, max: pr?.max ?? 0 }, collections, newCount },
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
    brand: p.brand ?? null,
    composition: p.composition ?? null,
    careInstructions: p.care_instructions ?? null,
    fitNotes: p.fit_notes ?? null,
    sizeGuide: sizeGuideById(p.size_guide_id),
    reviews: reviewSummary(p.id),
    looks: lookbooksForProduct(p.id),
    faq: faqFor(p.id),
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
