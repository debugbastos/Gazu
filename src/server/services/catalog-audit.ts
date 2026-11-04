import fs from 'node:fs';
import path from 'node:path';
import { ROOT, env } from '../config.ts';
import { getDb, normalizeText, nowIso } from '../db.ts';

/**
 * Auditoria de qualidade do catálogo.
 * Classificação dos campos:
 *  - OBRIGATÓRIOS (bloqueiam a publicação): nome, descrição, categoria, imagem principal, preço válido, variante ativa com SKU.
 *  - CONDICIONAIS (dependem do tipo de produto): guia de medidas para vestuário e calçados; composição/cuidados para vestuário;
 *    dimensões e peso quando o frete é cotado por transportadora (Melhor Envio).
 *  - RECOMENDADOS: 2+ fotos, foto por cor, SEO, medidas e caimento, cores confirmadas, custo de aquisição (para margem).
 * Nada é corrigido automaticamente: o painel aponta o problema e abre o cadastro para correção.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export interface CatalogIssue { code: string; severity: Severity; message: string; field?: string }
export interface ProductAudit { productId: number; name: string; slug: string; status: string; issues: CatalogIssue[]; blocking: CatalogIssue[] }

const APPAREL = new Set(['Camiseta', 'Camisa', 'Blusa', 'Calça', 'Short', 'Bermuda', 'Saia', 'Vestido', 'Jaqueta', 'Casaco', 'Moletom', 'Conjunto', 'Suéter', 'Jardineira', 'Regata', 'Cropped']);
const SHOES = new Set(['Tênis', 'Sandália', 'Bota', 'Sapato']);

export const ISSUE_LABEL: Record<string, string> = {
  no_name: 'Nome ausente ou curto', no_description: 'Descrição ausente', no_category: 'Sem categoria', no_image: 'Sem imagem principal',
  bad_price: 'Preço inválido', no_variant: 'Sem variante ativa', broken_image: 'Imagem quebrada', stock_undefined: 'Estoque nunca definido',
  stock_mismatch: 'Estoque inconsistente', promo_expired: 'Promoção vencida ainda cadastrada', promo_invalid: 'Promoção maior ou igual ao preço',
  color_without_photo: 'Cor sem foto correspondente', gallery_incomplete: 'Galeria com uma única foto', no_size_guide: 'Sem guia de medidas',
  no_composition: 'Composição/cuidados ausentes', no_fit: 'Medidas e caimento não informados', no_seo: 'SEO ausente', duplicate: 'Possível duplicado',
  unconfirmed_color: 'Cores não confirmadas', no_cost: 'Custo de aquisição não informado', no_dimensions: 'Dimensões/peso ausentes',
  demo_data: 'Dados de demonstração', soldout_featured: 'Esgotado em vitrine/coleção ativa',
};

function imageExists(url: string): boolean {
  if (/^https?:\/\//.test(url) || url.startsWith('data:')) return true; // externas não são verificadas aqui
  const file = path.join(ROOT, 'public', url.split('?')[0]!);
  return file.startsWith(path.join(ROOT, 'public')) && fs.existsSync(file);
}

interface Row {
  id: number; slug: string; name: string; description: string; product_type: string; price_cents: number; promo_price_cents: number | null; promo_ends_at: string | null;
  is_active: number; is_featured: number; is_demo: number; color_confirmed: number; seo_title: string | null; seo_description: string | null; composition: string | null;
  care_instructions: string | null; details: string | null; fit_notes: string | null; size_guide_id: number | null; cost_cents: number | null; weight_grams: number | null;
  length_cm: number | null; archived_at: string | null; deleted_at: string | null;
}

export function auditProducts(productIds?: number[]): ProductAudit[] {
  const db = getDb();
  const rows = productIds?.length
    ? db.all<Row>(`SELECT * FROM products WHERE deleted_at IS NULL AND id IN (${productIds.map(() => '?').join(',')})`, ...productIds)
    : db.all<Row>('SELECT * FROM products WHERE deleted_at IS NULL ORDER BY id');
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  const images = db.all<{ product_id: number; url: string; color_name: string | null }>(`SELECT product_id, url, color_name FROM product_images WHERE product_id IN (${ph})`, ...ids);
  const variants = db.all<{ id: number; product_id: number; sku: string; color_name: string; stock: number; is_active: number; cost_cents: number | null; moves: number; sum: number }>(
    `SELECT v.*, (SELECT COUNT(*) FROM inventory_movements m WHERE m.variant_id = v.id) AS moves, (SELECT COALESCE(SUM(delta), 0) FROM inventory_movements m WHERE m.variant_id = v.id) AS sum
       FROM product_variants v WHERE v.product_id IN (${ph})`, ...ids);
  const cats = new Map(db.all<{ product_id: number; n: number }>(`SELECT product_id, COUNT(*) AS n FROM product_categories WHERE product_id IN (${ph}) GROUP BY product_id`, ...ids).map((r) => [r.product_id, r.n]));
  const inActiveCollections = new Set(db.all<{ product_id: number }>(`SELECT cp.product_id FROM collection_products cp JOIN collections c ON c.id = cp.collection_id WHERE c.status = 'active' AND c.is_featured = 1`).map((r) => r.product_id));
  // Duplicados: mesmo nome normalizado ou mesma foto principal
  const allNames = db.all<{ id: number; name: string }>('SELECT id, name FROM products WHERE deleted_at IS NULL');
  const byName = new Map<string, number[]>();
  for (const p of allNames) { const k = normalizeText(p.name).replace(/\s+/g, ' ').trim(); byName.set(k, [...(byName.get(k) ?? []), p.id]); }
  const firstImg = db.all<{ product_id: number; url: string }>('SELECT product_id, url FROM product_images WHERE position = 0');
  const byImg = new Map<string, number[]>();
  for (const i of firstImg) byImg.set(i.url, [...(byImg.get(i.url) ?? []), i.product_id]);
  const now = nowIso();

  return rows.map((p) => {
    const issues: CatalogIssue[] = [];
    const add = (code: string, severity: Severity, message?: string, field?: string) => issues.push({ code, severity, message: message ?? ISSUE_LABEL[code] ?? code, field });
    const imgs = images.filter((i) => i.product_id === p.id);
    const vars = variants.filter((v) => v.product_id === p.id);
    const active = vars.filter((v) => v.is_active);

    if (!p.name || p.name.trim().length < 3) add('no_name', 'critical', undefined, 'name');
    if (!p.description || p.description.trim().length < 10) add('no_description', 'critical', undefined, 'description');
    if (!cats.get(p.id)) add('no_category', 'critical', undefined, 'categoryIds');
    if (!imgs.length) add('no_image', 'critical', undefined, 'images');
    if (!(p.price_cents > 0)) add('bad_price', 'critical', undefined, 'priceCents');
    if (!active.length) add('no_variant', 'critical', undefined, 'variants');

    const broken = imgs.filter((i) => !imageExists(i.url));
    if (broken.length) add('broken_image', 'high', `${broken.length} imagem(ns) não encontrada(s) no servidor`, 'images');
    if (active.length && active.every((v) => v.moves === 0 && v.stock === 0)) add('stock_undefined', 'high', undefined, 'variants');
    const mismatch = vars.filter((v) => v.stock !== v.sum);
    if (mismatch.length) add('stock_mismatch', 'high', `Estoque diverge do histórico em ${mismatch.map((v) => v.sku).join(', ')}`, 'variants');
    if (p.promo_price_cents && p.promo_price_cents >= p.price_cents) add('promo_invalid', 'high', undefined, 'promoPriceCents');
    if (p.promo_price_cents && p.promo_ends_at && p.promo_ends_at < now) add('promo_expired', 'medium', undefined, 'promoPriceCents');

    const colors = [...new Set(active.map((v) => v.color_name))];
    if (colors.length > 1) {
      const withPhoto = new Set(imgs.map((i) => i.color_name).filter(Boolean));
      const missing = colors.filter((c) => !withPhoto.has(c));
      if (missing.length) add('color_without_photo', 'medium', `Cores sem foto: ${missing.join(', ')}`, 'images');
    }
    if (imgs.length === 1) add('gallery_incomplete', 'low', undefined, 'images');
    const apparel = APPAREL.has(p.product_type);
    if ((apparel || SHOES.has(p.product_type)) && !p.size_guide_id) add('no_size_guide', 'medium', undefined, 'sizeGuideId');
    if (apparel && !p.composition && !p.care_instructions && !p.details) add('no_composition', 'medium', undefined, 'composition');
    if (apparel && !p.fit_notes) add('no_fit', 'low', undefined, 'fitNotes');
    if (!p.seo_title || !p.seo_description) add('no_seo', 'low', undefined, 'seoTitle');
    if (!p.color_confirmed) add('unconfirmed_color', 'medium', undefined, 'colorConfirmed');
    if (p.cost_cents === null && active.some((v) => v.cost_cents === null)) add('no_cost', 'low', 'Custo não informado: a margem deste produto não pode ser calculada', 'costCents');
    if (env.SHIPPING_PROVIDER === 'melhorenvio' && (!p.weight_grams || !p.length_cm)) add('no_dimensions', 'medium', undefined, 'weightGrams');
    if (p.is_demo) add('demo_data', 'medium', 'Preço/estoque/cores de demonstração — substituir antes de vender', 'isDemo');
    const totalStock = active.reduce((s, v) => s + v.stock, 0);
    if (p.is_active && totalStock === 0 && (p.is_featured || inActiveCollections.has(p.id))) add('soldout_featured', 'medium', undefined, 'isFeatured');
    const dupName = byName.get(normalizeText(p.name).replace(/\s+/g, ' ').trim())?.filter((x) => x !== p.id) ?? [];
    const dupImg = imgs[0] ? byImg.get(imgs[0].url)?.filter((x) => x !== p.id) ?? [] : [];
    if (dupName.length || dupImg.length) add('duplicate', 'medium', `Semelhante aos produtos #${[...new Set([...dupName, ...dupImg])].join(', #')}`, 'name');

    const status = p.deleted_at ? 'trash' : p.archived_at ? 'archived' : p.is_active ? 'published' : 'draft';
    return { productId: p.id, name: p.name, slug: p.slug, status, issues, blocking: issues.filter((i) => i.severity === 'critical') };
  });
}

export function publishBlockers(productId: number): CatalogIssue[] {
  return auditProducts([productId])[0]?.blocking ?? [{ code: 'not_found', severity: 'critical', message: 'Produto não encontrado' }];
}

export interface CatalogAuditReport {
  generatedAt: string;
  totals: Record<Severity, number>;
  byCode: { code: string; label: string; severity: Severity; count: number }[];
  products: ProductAudit[];
  emptyCategories: { id: number; name: string; slug: string }[];
  invalidLinks: { source: string; id: number; url: string }[];
}

export function catalogAuditReport(): CatalogAuditReport {
  const db = getDb();
  const products = auditProducts().filter((p) => p.issues.length);
  const totals: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCode = new Map<string, { code: string; label: string; severity: Severity; count: number }>();
  for (const p of products) for (const i of p.issues) {
    totals[i.severity]++;
    const e = byCode.get(i.code) ?? { code: i.code, label: ISSUE_LABEL[i.code] ?? i.code, severity: i.severity, count: 0 };
    e.count++;
    byCode.set(i.code, e);
  }
  const emptyCategories = db.all<{ id: number; name: string; slug: string }>(
    `SELECT c.id, c.name, c.slug FROM categories c WHERE c.is_active = 1 AND NOT EXISTS (
       SELECT 1 FROM product_categories pc JOIN products p ON p.id = pc.product_id AND p.is_active = 1
        WHERE pc.category_id IN (WITH RECURSIVE t(id) AS (SELECT c.id UNION ALL SELECT x.id FROM categories x JOIN t ON x.parent_id = t.id) SELECT id FROM t))`,
  );
  const links = [
    ...db.all<{ id: number; url: string }>("SELECT id, link_url AS url FROM banners WHERE is_active = 1 AND link_url LIKE '/%'").map((l) => ({ source: 'banner', ...l })),
    ...db.all<{ id: number; url: string }>("SELECT id, link_url AS url FROM announcements WHERE is_active = 1 AND link_url LIKE '/%'").map((l) => ({ source: 'anúncio', ...l })),
    ...db.all<{ id: number; url: string }>("SELECT id, landing_path AS url FROM campaigns WHERE status = 'active'").map((l) => ({ source: 'campanha', ...l })),
  ];
  const invalidLinks = links.filter((l) => !internalLinkExists(l.url));
  const sev: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  products.sort((a, b) => Math.min(...a.issues.map((i) => sev[i.severity])) - Math.min(...b.issues.map((i) => sev[i.severity])) || b.issues.length - a.issues.length);
  return { generatedAt: nowIso(), totals, byCode: [...byCode.values()].sort((a, b) => sev[a.severity] - sev[b.severity] || b.count - a.count), products, emptyCategories, invalidLinks };
}

/** Verifica se um caminho interno aponta para algo existente (produto, categoria, coleção, lookbook, artigo). */
export function internalLinkExists(url: string): boolean {
  const db = getDb();
  const p = url.split(/[?#]/)[0]!.replace(/\/$/, '') || '/';
  const m = (re: RegExp) => re.exec(p)?.[1];
  if (m(/^\/produto\/([a-z0-9-]+)$/)) return Boolean(db.get("SELECT 1 FROM products WHERE slug = ? AND is_active = 1", m(/^\/produto\/([a-z0-9-]+)$/)!));
  if (m(/^\/categoria\/([a-z0-9-]+)$/)) { const s = m(/^\/categoria\/([a-z0-9-]+)$/)!; return s === 'novidades' || Boolean(db.get('SELECT 1 FROM categories WHERE slug = ? AND is_active = 1', s)); }
  if (m(/^\/colecao\/([a-z0-9-]+)$/)) return Boolean(db.get("SELECT 1 FROM collections WHERE slug = ? AND status IN ('active','archived')", m(/^\/colecao\/([a-z0-9-]+)$/)!));
  if (m(/^\/lookbook\/([a-z0-9-]+)$/)) return Boolean(db.get("SELECT 1 FROM lookbooks WHERE slug = ? AND status = 'published'", m(/^\/lookbook\/([a-z0-9-]+)$/)!));
  if (m(/^\/journal\/([a-z0-9-]+)$/)) return Boolean(db.get("SELECT 1 FROM journal_articles WHERE slug = ? AND status = 'published'", m(/^\/journal\/([a-z0-9-]+)$/)!));
  return ['/', '/colecoes', '/archive', '/lookbook', '/journal', '/monte-seu-look', '/ajuda', '/atendimento', '/entrega', '/pagamento', '/trocas-e-devolucoes',
    '/cancelamento', '/politica-de-privacidade', '/termos-de-uso', '/rastrear-pedido', '/busca', '/favoritos', '/carrinho'].includes(p);
}
