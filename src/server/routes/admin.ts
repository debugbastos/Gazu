import { z } from 'zod';
import { getDb, nowIso } from '../db.ts';
import { HttpError, intParam, requirePermission, type Ctx, type Router } from '../http.ts';
import { moveStock } from '../services/inventory.ts';
import { getOrder, orderIdByNumber } from '../services/orders.ts';
import { getSettings, saveSettings, storeSettingsSchema } from '../services/settings.ts';
import { categoryTree, listCategories } from '../services/catalog.ts';
import { auditProducts, catalogAuditReport, publishBlockers } from '../services/catalog-audit.ts';
import { audit } from '../services/audit.ts';
import { processImageUpload } from '../services/uploads.ts';
import {
  adminCategorySchema, adminCouponSchema, adminProductSchema, adminShippingRuleSchema, adminVariantSchema, stockAdjustSchema,
} from '../validation.ts';

const actorOf = (ctx: Ctx) => `admin:${ctx.user!.id}`;

function productStatus(p: { is_active: number; archived_at: string | null; deleted_at: string | null }): 'published' | 'draft' | 'archived' | 'trash' {
  return p.deleted_at ? 'trash' : p.archived_at ? 'archived' : p.is_active ? 'published' : 'draft';
}

export function productAdminDetail(id: number) {
  const db = getDb();
  const p = db.get<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
  const auditResult = auditProducts([id])[0];
  return {
    id: p.id, slug: p.slug, name: p.name, description: p.description, details: p.details, audience: p.audience, productType: p.product_type,
    priceCents: p.price_cents, promoPriceCents: p.promo_price_cents, promoStartsAt: p.promo_starts_at, promoEndsAt: p.promo_ends_at,
    primaryCategoryId: p.primary_category_id, isActive: Boolean(p.is_active), isFeatured: Boolean(p.is_featured), isDemo: Boolean(p.is_demo), colorConfirmed: Boolean(p.color_confirmed),
    seoTitle: p.seo_title, seoDescription: p.seo_description, createdAt: p.created_at, updatedAt: p.updated_at, publishedAt: p.published_at,
    brand: p.brand, composition: p.composition, careInstructions: p.care_instructions, fitNotes: p.fit_notes, costCents: p.cost_cents,
    weightGrams: p.weight_grams, lengthCm: p.length_cm, widthCm: p.width_cm, heightCm: p.height_cm, sizeGuideId: p.size_guide_id,
    status: productStatus(p as { is_active: number; archived_at: string | null; deleted_at: string | null }),
    issues: auditResult?.issues ?? [],
    soldUnits: db.get<{ n: number }>("SELECT COALESCE(SUM(i.quantity), 0) AS n FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id = ? AND o.status IN ('paid','processing','shipped','delivered')", id)!.n,
    categoryIds: db.all<{ category_id: number }>('SELECT category_id FROM product_categories WHERE product_id = ?', id).map((r) => r.category_id),
    collectionIds: db.all<{ collection_id: number }>('SELECT collection_id FROM collection_products WHERE product_id = ?', id).map((r) => r.collection_id),
    images: db.all<Record<string, unknown>>('SELECT * FROM product_images WHERE product_id = ? ORDER BY position', id).map((i) => ({ id: i.id, url: i.url, srcset: i.srcset, alt: i.alt, colorName: i.color_name, position: i.position, objectPosition: i.object_position, width: i.width, height: i.height })),
    variants: db.all<Record<string, unknown>>('SELECT * FROM product_variants WHERE product_id = ? ORDER BY color_name, size_order', id).map((v) => ({ id: v.id, sku: v.sku, colorName: v.color_name, colorHex: v.color_hex, size: v.size, sizeOrder: v.size_order, priceCents: v.price_cents, costCents: v.cost_cents, stock: v.stock, isActive: Boolean(v.is_active) })),
  };
}

function writeProductCategories(productId: number, ids: number[]): void {
  const db = getDb();
  const valid = db.all<{ id: number }>(`SELECT id FROM categories WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((r) => r.id);
  if (valid.length !== new Set(ids).size) throw new HttpError(400, 'Categoria inexistente.', 'bad_category');
  db.run('DELETE FROM product_categories WHERE product_id = ?', productId);
  for (const c of new Set(valid)) db.run('INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)', productId, c);
}

/** Impede publicar produto com campos obrigatórios ausentes (mostra o que falta). */
function assertPublishable(productId: number): void {
  const blockers = publishBlockers(productId);
  if (blockers.length) {
    throw new HttpError(422, `Não é possível publicar: ${blockers.map((b) => b.message.toLowerCase()).join('; ')}.`, 'publish_requirements', { blockers });
  }
}

type ProductInput = z.infer<typeof adminProductSchema>;
const productCols = (b: ProductInput) => [
  b.slug, b.name, b.description, b.details ?? null, b.audience, b.productType, b.primaryCategoryId, b.priceCents, b.promoPriceCents ?? null, b.promoStartsAt ?? null, b.promoEndsAt ?? null,
  b.isFeatured, b.isDemo, b.colorConfirmed, b.seoTitle ?? null, b.seoDescription ?? null, b.brand ?? null, b.composition ?? null, b.careInstructions ?? null, b.fitNotes ?? null,
  b.costCents ?? null, b.weightGrams ?? null, b.lengthCm ?? null, b.widthCm ?? null, b.heightCm ?? null, b.sizeGuideId ?? null,
] as const;
const PRODUCT_SET = `slug = ?, name = ?, description = ?, details = ?, audience = ?, product_type = ?, primary_category_id = ?, price_cents = ?, promo_price_cents = ?,
  promo_starts_at = ?, promo_ends_at = ?, is_featured = ?, is_demo = ?, color_confirmed = ?, seo_title = ?, seo_description = ?, brand = ?, composition = ?, care_instructions = ?,
  fit_notes = ?, cost_cents = ?, weight_grams = ?, length_cm = ?, width_cm = ?, height_cm = ?, size_guide_id = ?`;

export function registerAdminRoutes(r: Router): void {
  r.get('/api/admin/dashboard', (ctx) => {
    requirePermission(ctx, 'orders.read');
    const db = getDb();
    const one = (sql: string, ...p: (string | number)[]) => db.get<{ n: number }>(sql, ...p)!.n;
    const PAID = "('paid','processing','shipped','delivered')";
    const threshold = getSettings().operations.lowStockThreshold;
    return {
      orders: {
        total: one('SELECT COUNT(*) AS n FROM orders WHERE is_demo = 0'),
        pending: one("SELECT COUNT(*) AS n FROM orders WHERE is_demo = 0 AND status = 'pending_payment'"),
        paid: one(`SELECT COUNT(*) AS n FROM orders WHERE is_demo = 0 AND status IN ${PAID}`),
        toShip: one("SELECT COUNT(*) AS n FROM orders WHERE is_demo = 0 AND status IN ('paid','processing')"),
      },
      // Receita: pedidos com pagamento aprovado (status pagos), excluindo pedidos de demonstração. Ver docs/FORMULAS-FINANCEIRAS.md.
      revenueCents: one(`SELECT COALESCE(SUM(total_cents), 0) AS n FROM orders WHERE is_demo = 0 AND status IN ${PAID}`),
      demoOrders: one('SELECT COUNT(*) AS n FROM orders WHERE is_demo = 1'),
      products: { active: one('SELECT COUNT(*) AS n FROM products WHERE is_active = 1'), demo: one('SELECT COUNT(*) AS n FROM products WHERE is_demo = 1 AND deleted_at IS NULL') },
      lowStock: db.all(`SELECT v.id, v.sku, v.color_name AS colorName, v.size, v.stock, p.name, p.id AS productId FROM product_variants v JOIN products p ON p.id = v.product_id
                         WHERE v.is_active = 1 AND p.is_active = 1 AND v.stock <= ? ORDER BY v.stock, p.name LIMIT 12`, threshold),
      lowStockCount: one('SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.is_active = 1 AND p.is_active = 1 AND v.stock <= ?', threshold),
      recentOrders: db.all('SELECT number, status, total_cents AS totalCents, is_demo AS isDemo, created_at AS createdAt FROM orders ORDER BY created_at DESC LIMIT 8'),
      openTickets: one("SELECT COUNT(*) AS n FROM support_tickets WHERE status IN ('open','in_progress')"),
      pendingReviews: one("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"),
      openReturns: one("SELECT COUNT(*) AS n FROM return_requests WHERE status IN ('requested','approved','awaiting_item','received')"),
      waitlist: one('SELECT COUNT(*) AS n FROM stock_alerts WHERE notified_at IS NULL AND cancelled_at IS NULL'),
      activeCoupons: one('SELECT COUNT(*) AS n FROM coupons WHERE is_active = 1'),
      activeCampaigns: one("SELECT COUNT(*) AS n FROM campaigns WHERE status = 'active'"),
      // Unidades vendidas nos últimos 30 dias (pagamentos aprovados pelo provedor, sem demonstração).
      unitsSold30d: one(`SELECT COALESCE(SUM(i.quantity), 0) AS n FROM order_items i JOIN orders o ON o.id = i.order_id
                          WHERE o.is_demo = 0 AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.provider <> 'demo' AND p.status IN ('approved','partially_refunded','refunded') AND p.approved_at >= ?)`,
                         new Date(Date.now() - 30 * 86400_000).toISOString()),
    };
  });

  // ---------- Produtos ----------
  r.get('/api/admin/products', (ctx) => {
    requirePermission(ctx, 'catalog.read');
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const status = ctx.url.searchParams.get('status');
    const page = Math.max(1, Number(ctx.url.searchParams.get('pagina') ?? 1) || 1);
    const where: string[] = [status === 'lixeira' ? 'p.deleted_at IS NOT NULL' : 'p.deleted_at IS NULL'];
    const params: string[] = [];
    if (q) { where.push("(gz_norm(p.name) LIKE gz_norm(?) OR p.slug LIKE ? OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.sku LIKE ?))"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (status === 'ativos') where.push('p.is_active = 1');
    if (status === 'rascunhos') where.push('p.is_active = 0 AND p.archived_at IS NULL');
    if (status === 'inativos') where.push('p.is_active = 0');
    if (status === 'arquivados') where.push('p.archived_at IS NOT NULL');
    if (status === 'demo') where.push('p.is_demo = 1');
    if (status === 'sem-estoque') where.push('(SELECT COALESCE(SUM(stock),0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) = 0');
    const db = getDb();
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM products p WHERE ${where.join(' AND ')}`, ...params)!.n;
    const items = db.all<Record<string, unknown>>(
      `SELECT p.id, p.slug, p.name, p.price_cents AS priceCents, p.promo_price_cents AS promoPriceCents, p.is_active AS isActive, p.is_featured AS isFeatured, p.is_demo AS isDemo,
              p.archived_at, p.deleted_at,
              (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY position LIMIT 1) AS image,
              (SELECT COALESCE(SUM(stock),0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS stock,
              (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variantCount,
              (SELECT name FROM categories c WHERE c.id = p.primary_category_id) AS category
         FROM products p WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC, p.id DESC LIMIT 30 OFFSET ?`,
      ...params, (page - 1) * 30,
    );
    const issues = new Map(auditProducts(items.map((i) => i.id as number)).map((a) => [a.productId, a]));
    return {
      items: items.map((i) => ({
        ...i, archived_at: undefined, deleted_at: undefined,
        status: productStatus({ is_active: i.isActive as number, archived_at: i.archived_at as string | null, deleted_at: i.deleted_at as string | null }),
        issueCount: issues.get(i.id as number)?.issues.length ?? 0,
        blocking: issues.get(i.id as number)?.blocking.length ?? 0,
      })),
      total, page, pages: Math.max(1, Math.ceil(total / 30)),
    };
  });

  r.get('/api/admin/products/:id', (ctx) => {
    requirePermission(ctx, 'catalog.read');
    return productAdminDetail(intParam(ctx.params.id));
  });

  r.post('/api/admin/products', async (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const b = await ctx.body(adminProductSchema);
    const db = getDb();
    if (db.get('SELECT 1 FROM products WHERE slug = ?', b.slug)) throw new HttpError(409, 'Já existe um produto com este slug.', 'slug_taken', { fieldErrors: { slug: ['Slug em uso.'] } });
    const id = db.tx(() => {
      // Produto novo nasce como rascunho; a publicação passa pela validação de campos obrigatórios.
      const { lastInsertRowid } = db.run(
        `INSERT INTO products (slug, name, description, details, audience, product_type, primary_category_id, price_cents, promo_price_cents, promo_starts_at, promo_ends_at,
           is_featured, is_demo, color_confirmed, seo_title, seo_description, brand, composition, care_instructions, fit_notes, cost_cents, weight_grams, length_cm, width_cm, height_cm,
           size_guide_id, is_active) VALUES (${Array(26).fill('?').join(', ')}, 0)`,
        ...productCols(b),
      );
      writeProductCategories(lastInsertRowid, b.categoryIds);
      audit({ actor: actorOf(ctx), action: 'product.create', entity: 'product', entityId: lastInsertRowid, data: { slug: b.slug, priceCents: b.priceCents }, ip: ctx.ip });
      return lastInsertRowid;
    });
    return productAdminDetail(id);
  });

  r.put('/api/admin/products/:id', async (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const id = intParam(ctx.params.id);
    const b = await ctx.body(adminProductSchema);
    const db = getDb();
    const clash = db.get<{ id: number }>('SELECT id FROM products WHERE slug = ? AND id <> ?', b.slug, id);
    if (clash) throw new HttpError(409, 'Já existe um produto com este slug.', 'slug_taken', { fieldErrors: { slug: ['Slug em uso.'] } });
    db.tx(() => {
      const before = db.get<{ price_cents: number; promo_price_cents: number | null; is_active: number; deleted_at: string | null; cost_cents: number | null }>('SELECT price_cents, promo_price_cents, is_active, deleted_at, cost_cents FROM products WHERE id = ?', id);
      if (!before || before.deleted_at) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
      db.run(`UPDATE products SET ${PRODUCT_SET}, updated_at = ? WHERE id = ?`, ...productCols(b), nowIso(), id);
      writeProductCategories(id, b.categoryIds);
      if (b.isActive) {
        assertPublishable(id);
        db.run('UPDATE products SET is_active = 1, archived_at = NULL, published_at = COALESCE(published_at, ?) WHERE id = ?', nowIso(), id);
      } else {
        db.run('UPDATE products SET is_active = 0 WHERE id = ?', id);
      }
      audit({
        actor: actorOf(ctx), action: 'product.update', entity: 'product', entityId: id, ip: ctx.ip,
        data: { priceBefore: before.price_cents, priceAfter: b.priceCents, promoBefore: before.promo_price_cents, promoAfter: b.promoPriceCents ?? null, costBefore: before.cost_cents, costAfter: b.costCents ?? null, published: b.isActive },
      });
    });
    return productAdminDetail(id);
  });

  const lifecycle = (action: 'publish' | 'unpublish' | 'archive' | 'restore' | 'trash') => async (ctx: Ctx) => {
    requirePermission(ctx, 'catalog.write');
    const id = intParam(ctx.params.id);
    const db = getDb();
    db.tx(() => {
      const p = db.get<{ id: number; deleted_at: string | null }>('SELECT id, deleted_at FROM products WHERE id = ?', id);
      if (!p) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
      if (p.deleted_at && action !== 'restore') throw new HttpError(409, 'Restaure o produto da lixeira antes.', 'in_trash');
      const now = nowIso();
      if (action === 'publish') { assertPublishable(id); db.run('UPDATE products SET is_active = 1, archived_at = NULL, published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?', now, now, id); }
      if (action === 'unpublish') db.run('UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?', now, id);
      if (action === 'archive') db.run('UPDATE products SET is_active = 0, is_featured = 0, archived_at = ?, updated_at = ? WHERE id = ?', now, now, id);
      if (action === 'restore') db.run('UPDATE products SET deleted_at = NULL, archived_at = NULL, is_active = 0, updated_at = ? WHERE id = ?', now, id);
      if (action === 'trash') {
        // Exclusão lógica: o histórico de pedidos permanece íntegro (snapshots nos itens).
        db.run('UPDATE products SET deleted_at = ?, is_active = 0, is_featured = 0, updated_at = ? WHERE id = ?', now, now, id);
        db.run('DELETE FROM collection_products WHERE product_id = ?', id);
        db.run('DELETE FROM lookbook_products WHERE product_id = ?', id);
        db.run('DELETE FROM journal_article_products WHERE product_id = ?', id);
      }
      audit({ actor: actorOf(ctx), action: `product.${action}`, entity: 'product', entityId: id, ip: ctx.ip });
    });
    return productAdminDetail(id);
  };
  r.post('/api/admin/products/:id/publish', lifecycle('publish'));
  r.post('/api/admin/products/:id/unpublish', lifecycle('unpublish'));
  r.post('/api/admin/products/:id/archive', lifecycle('archive'));
  r.post('/api/admin/products/:id/restore', lifecycle('restore'));
  r.delete('/api/admin/products/:id', lifecycle('trash'));

  r.post('/api/admin/products/:id/duplicate', (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const id = intParam(ctx.params.id);
    const db = getDb();
    const newId = db.tx(() => {
      const p = db.get<{ slug: string; name: string }>('SELECT slug, name FROM products WHERE id = ? AND deleted_at IS NULL', id);
      if (!p) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
      let slug = `${p.slug}-copia`;
      for (let i = 2; db.get('SELECT 1 FROM products WHERE slug = ?', slug); i++) slug = `${p.slug}-copia-${i}`;
      const cols = 'description, details, audience, product_type, primary_category_id, price_cents, promo_price_cents, promo_starts_at, promo_ends_at, is_demo, color_confirmed, seo_title, seo_description, brand, composition, care_instructions, fit_notes, cost_cents, weight_grams, length_cm, width_cm, height_cm, size_guide_id';
      const nid = db.run(`INSERT INTO products (slug, name, is_active, is_featured, ${cols}) SELECT ?, ?, 0, 0, ${cols} FROM products WHERE id = ?`, slug, `${p.name} (cópia)`, id).lastInsertRowid;
      db.run('INSERT INTO product_categories (product_id, category_id) SELECT ?, category_id FROM product_categories WHERE product_id = ?', nid, id);
      db.run('INSERT INTO product_images (product_id, url, srcset, width, height, alt, color_name, object_position, position) SELECT ?, url, srcset, width, height, alt, color_name, object_position, position FROM product_images WHERE product_id = ?', nid, id);
      // Variantes copiadas com novo SKU e estoque zero (estoque é sempre lançado com histórico).
      for (const v of db.all<{ sku: string; color_name: string; color_hex: string | null; size: string; size_order: number; price_cents: number | null; cost_cents: number | null; is_active: number }>('SELECT * FROM product_variants WHERE product_id = ?', id)) {
        let sku = `${v.sku}-C`;
        for (let i = 2; db.get('SELECT 1 FROM product_variants WHERE sku = ?', sku); i++) sku = `${v.sku}-C${i}`;
        db.run('INSERT INTO product_variants (product_id, sku, color_name, color_hex, size, size_order, price_cents, cost_cents, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)', nid, sku, v.color_name, v.color_hex, v.size, v.size_order, v.price_cents, v.cost_cents, v.is_active);
      }
      audit({ actor: actorOf(ctx), action: 'product.duplicate', entity: 'product', entityId: nid, data: { from: id }, ip: ctx.ip });
      return nid;
    });
    return productAdminDetail(newId);
  });

  r.get('/api/admin/catalog-audit', (ctx) => {
    requirePermission(ctx, 'catalog.read');
    return catalogAuditReport();
  });

  // ---------- Variantes e estoque ----------
  r.post('/api/admin/products/:id/variants', async (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const productId = intParam(ctx.params.id);
    const b = await ctx.body(adminVariantSchema);
    const db = getDb();
    if (!db.get('SELECT 1 FROM products WHERE id = ? AND deleted_at IS NULL', productId)) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
    if (db.get('SELECT 1 FROM product_variants WHERE sku = ?', b.sku)) throw new HttpError(409, 'SKU já utilizado.', 'sku_taken', { fieldErrors: { sku: ['SKU em uso.'] } });
    if (db.get('SELECT 1 FROM product_variants WHERE product_id = ? AND color_name = ? AND size = ?', productId, b.colorName, b.size)) throw new HttpError(409, 'Esta combinação de cor e tamanho já existe.', 'variant_exists');
    db.tx(() => {
      const { lastInsertRowid } = db.run(
        'INSERT INTO product_variants (product_id, sku, color_name, color_hex, size, size_order, price_cents, cost_cents, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
        productId, b.sku, b.colorName, b.colorHex ?? null, b.size, b.sizeOrder, b.priceCents ?? null, b.costCents ?? null, b.isActive,
      );
      if (b.initialStock) moveStock(lastInsertRowid, b.initialStock, 'initial', actorOf(ctx), null, 'Estoque inicial');
      audit({ actor: actorOf(ctx), action: 'variant.create', entity: 'variant', entityId: lastInsertRowid, data: b, ip: ctx.ip });
    });
    return productAdminDetail(productId);
  });

  r.put('/api/admin/variants/:id', async (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const id = intParam(ctx.params.id);
    const b = await ctx.body(adminVariantSchema.omit({ initialStock: true }));
    const db = getDb();
    const v = db.get<{ product_id: number; price_cents: number | null; cost_cents: number | null }>('SELECT product_id, price_cents, cost_cents FROM product_variants WHERE id = ?', id);
    if (!v) throw new HttpError(404, 'Variante não encontrada.', 'not_found');
    if (db.get('SELECT 1 FROM product_variants WHERE sku = ? AND id <> ?', b.sku, id)) throw new HttpError(409, 'SKU já utilizado.', 'sku_taken');
    if (db.get('SELECT 1 FROM product_variants WHERE product_id = ? AND color_name = ? AND size = ? AND id <> ?', v.product_id, b.colorName, b.size, id)) throw new HttpError(409, 'Esta combinação de cor e tamanho já existe.', 'variant_exists');
    db.run('UPDATE product_variants SET sku = ?, color_name = ?, color_hex = ?, size = ?, size_order = ?, price_cents = ?, cost_cents = ?, is_active = ? WHERE id = ?', b.sku, b.colorName, b.colorHex ?? null, b.size, b.sizeOrder, b.priceCents ?? null, b.costCents ?? null, b.isActive, id);
    audit({ actor: actorOf(ctx), action: 'variant.update', entity: 'variant', entityId: id, data: { ...b, priceBefore: v.price_cents, costBefore: v.cost_cents }, ip: ctx.ip });
    return productAdminDetail(v.product_id);
  });

  r.post('/api/admin/variants/:id/stock', async (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const id = intParam(ctx.params.id);
    const b = await ctx.body(stockAdjustSchema);
    const db = getDb();
    const v = db.get<{ product_id: number; stock: number }>('SELECT product_id, stock FROM product_variants WHERE id = ?', id);
    if (!v) throw new HttpError(404, 'Variante não encontrada.', 'not_found');
    try {
      db.tx(() => moveStock(id, b.delta, b.reason, actorOf(ctx), null, b.note ?? null));
      audit({ actor: actorOf(ctx), action: 'stock.adjust', entity: 'variant', entityId: id, data: { delta: b.delta, reason: b.reason, before: v.stock, note: b.note }, ip: ctx.ip });
    } catch (e) {
      audit({ actor: actorOf(ctx), action: 'stock.adjust', entity: 'variant', entityId: id, data: { delta: b.delta, before: v.stock }, result: 'failed', ip: ctx.ip });
      throw e;
    }
    return productAdminDetail(v.product_id);
  });

  r.get('/api/admin/variants/:id/movements', (ctx) => {
    requirePermission(ctx, 'catalog.read');
    return { movements: getDb().all('SELECT id, delta, reason, order_id AS orderId, actor, note, created_at AS createdAt FROM inventory_movements WHERE variant_id = ? ORDER BY id DESC LIMIT 100', intParam(ctx.params.id)) };
  });

  // Relatório de estoque: esgotados, abaixo do mínimo, reservas em pedidos não pagos e lista de espera.
  r.get('/api/admin/inventory', (ctx) => {
    requirePermission(ctx, 'catalog.read');
    const db = getDb();
    const threshold = getSettings().operations.lowStockThreshold;
    const variants = db.all(
      `SELECT v.id, v.sku, v.color_name AS colorName, v.size, v.stock, v.cost_cents AS costCents, p.id AS productId, p.name, p.is_active AS isActive,
              (SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.variant_id = v.id AND o.status = 'pending_payment') AS reserved,
              (SELECT COUNT(*) FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL AND a.cancelled_at IS NULL) AS waiting,
              (SELECT MAX(created_at) FROM inventory_movements m WHERE m.variant_id = v.id) AS lastMovement
         FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.deleted_at IS NULL AND v.is_active = 1 AND (v.stock <= ? OR EXISTS (SELECT 1 FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL AND a.cancelled_at IS NULL))
        ORDER BY v.stock, waiting DESC, p.name LIMIT 300`, threshold,
    );
    return {
      threshold,
      variants,
      totals: {
        outOfStock: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.is_active = 1 AND p.is_active = 1 AND v.stock = 0')!.n,
        low: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.is_active = 1 AND p.is_active = 1 AND v.stock > 0 AND v.stock <= ?', threshold)!.n,
        reservedUnits: db.get<{ n: number }>("SELECT COALESCE(SUM(i.quantity), 0) AS n FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status = 'pending_payment'")!.n,
        units: db.get<{ n: number }>('SELECT COALESCE(SUM(v.stock), 0) AS n FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.deleted_at IS NULL AND v.is_active = 1')!.n,
      },
    };
  });

  // ---------- Imagens de produto ----------
  r.post('/api/admin/products/:id/images', async (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const productId = intParam(ctx.params.id);
    const db = getDb();
    const product = db.get<{ slug: string; name: string }>('SELECT slug, name FROM products WHERE id = ?', productId);
    if (!product) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
    const img = await processImageUpload(ctx.rawBody, 'products', product.slug);
    const alt = (ctx.url.searchParams.get('alt') ?? product.name).slice(0, 160);
    const colorName = ctx.url.searchParams.get('cor')?.slice(0, 60) || null;
    const pos = db.get<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM product_images WHERE product_id = ?', productId)!.n;
    db.run('INSERT INTO product_images (product_id, url, srcset, width, height, alt, color_name, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', productId, img.url, img.srcset, img.width, img.height, alt, colorName, pos);
    audit({ actor: actorOf(ctx), action: 'image.upload', entity: 'product', entityId: productId, data: { url: img.url, type: img.type }, ip: ctx.ip });
    return productAdminDetail(productId);
  });

  r.put('/api/admin/images/:id', async (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const id = intParam(ctx.params.id);
    const b = await ctx.body(z.object({ alt: z.string().trim().max(160), colorName: z.string().trim().max(60).nullable(), position: z.number().int().min(0).max(99), objectPosition: z.string().regex(/^[a-z0-9% ]{1,30}$/).default('center') }));
    const img = getDb().get<{ product_id: number }>('SELECT product_id FROM product_images WHERE id = ?', id);
    if (!img) throw new HttpError(404, 'Imagem não encontrada.', 'not_found');
    getDb().run('UPDATE product_images SET alt = ?, color_name = ?, position = ?, object_position = ? WHERE id = ?', b.alt, b.colorName || null, b.position, b.objectPosition, id);
    audit({ actor: actorOf(ctx), action: 'image.update', entity: 'image', entityId: id, data: b, ip: ctx.ip });
    return productAdminDetail(img.product_id);
  });

  r.delete('/api/admin/images/:id', (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const id = intParam(ctx.params.id);
    const img = getDb().get<{ product_id: number; url: string }>('SELECT product_id, url FROM product_images WHERE id = ?', id);
    if (!img) throw new HttpError(404, 'Imagem não encontrada.', 'not_found');
    const p = getDb().get<{ is_active: number; n: number }>('SELECT is_active, (SELECT COUNT(*) FROM product_images WHERE product_id = ?) AS n FROM products WHERE id = ?', img.product_id, img.product_id)!;
    if (p.is_active && p.n <= 1) throw new HttpError(409, 'Produto publicado precisa de ao menos uma imagem. Envie outra foto antes de remover esta.', 'last_image');
    getDb().run('DELETE FROM product_images WHERE id = ?', id);
    audit({ actor: actorOf(ctx), action: 'image.delete', entity: 'image', entityId: id, data: { url: img.url }, ip: ctx.ip });
    return productAdminDetail(img.product_id);
  });

  // ---------- Categorias ----------
  r.get('/api/admin/categories', (ctx) => {
    requirePermission(ctx, 'catalog.read');
    return { categories: listCategories(true), tree: categoryTree(true) };
  });
  const saveCategory = async (ctx: Ctx, id?: number) => {
    requirePermission(ctx, 'catalog.write');
    const b = await ctx.body(adminCategorySchema);
    const db = getDb();
    if (db.get('SELECT 1 FROM categories WHERE slug = ? AND id <> ?', b.slug, id ?? 0)) throw new HttpError(409, 'Slug em uso.', 'slug_taken', { fieldErrors: { slug: ['Slug em uso.'] } });
    if (b.parentId && (b.parentId === id || !db.get('SELECT 1 FROM categories WHERE id = ?', b.parentId))) throw new HttpError(400, 'Categoria-mãe inválida.', 'bad_parent');
    if (id) {
      const r2 = db.run('UPDATE categories SET name = ?, slug = ?, description = ?, parent_id = ?, position = ?, is_active = ?, image_url = ? WHERE id = ?', b.name, b.slug, b.description ?? null, b.parentId ?? null, b.position, b.isActive, b.imageUrl ?? null, id);
      if (!r2.changes) throw new HttpError(404, 'Categoria não encontrada.', 'not_found');
    } else {
      id = db.run('INSERT INTO categories (name, slug, description, parent_id, position, is_active, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)', b.name, b.slug, b.description ?? null, b.parentId ?? null, b.position, b.isActive, b.imageUrl ?? null).lastInsertRowid;
    }
    audit({ actor: actorOf(ctx), action: 'category.save', entity: 'category', entityId: id, data: b, ip: ctx.ip });
    return { categories: listCategories(true) };
  };
  r.post('/api/admin/categories', (ctx) => saveCategory(ctx));
  r.put('/api/admin/categories/:id', (ctx) => saveCategory(ctx, intParam(ctx.params.id)));
  // Exclusão respeitando dependências: subcategorias, produtos e cupons vinculados.
  r.delete('/api/admin/categories/:id', (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const id = intParam(ctx.params.id);
    const db = getDb();
    const children = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?', id)!.n;
    const products = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM product_categories pc JOIN products p ON p.id = pc.product_id WHERE pc.category_id = ? AND p.deleted_at IS NULL', id)!.n;
    const primary = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM products WHERE primary_category_id = ? AND deleted_at IS NULL', id)!.n;
    if (children || products || primary) {
      throw new HttpError(409, `Não é possível excluir: ${[children ? `${children} subcategoria(s)` : '', products ? `${products} produto(s)` : ''].filter(Boolean).join(' e ')} vinculados. Desative a categoria ou mova os itens.`, 'has_dependencies', { children, products });
    }
    db.run('DELETE FROM categories WHERE id = ?', id);
    audit({ actor: actorOf(ctx), action: 'category.delete', entity: 'category', entityId: id, ip: ctx.ip });
    return { categories: listCategories(true) };
  });

  // ---------- Pedidos (lista e detalhe — operações ficam em routes/admin-orders.ts) ----------
  r.get('/api/admin/orders', (ctx) => {
    requirePermission(ctx, 'orders.read');
    const sp = ctx.url.searchParams;
    const where: string[] = ['1=1'];
    const params: string[] = [];
    const status = sp.get('status');
    if (status) { where.push('o.status = ?'); params.push(status); }
    const q = (sp.get('q') ?? '').trim();
    if (q) { where.push('(o.number LIKE ? OR COALESCE(o.customer_email, u.email) LIKE ? OR o.ship_recipient LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const page = Math.max(1, Number(sp.get('pagina') ?? 1) || 1);
    const db = getDb();
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where.join(' AND ')}`, ...params)!.n;
    const items = db.all(
      `SELECT o.number, o.status, o.total_cents AS totalCents, o.is_demo AS isDemo, o.created_at AS createdAt, COALESCE(o.customer_email, u.email) AS email, o.ship_recipient AS recipient,
              u.is_guest AS isGuest,
              (SELECT status FROM payments p WHERE p.order_id = o.id ORDER BY id DESC LIMIT 1) AS paymentStatus,
              (SELECT status FROM shipments s WHERE s.order_id = o.id ORDER BY id DESC LIMIT 1) AS shipmentStatus,
              (SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id) AS items
         FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 30 OFFSET ?`,
      ...params, (page - 1) * 30,
    );
    return { items, total, page, pages: Math.max(1, Math.ceil(total / 30)) };
  });
  r.get('/api/admin/orders/:number', (ctx) => {
    requirePermission(ctx, 'orders.read');
    const id = orderIdByNumber(ctx.params.number!);
    if (!id) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
    return getOrder(id, { withCustomer: true, admin: true });
  });

  // ---------- Cupons ----------
  r.get('/api/admin/coupons', (ctx) => {
    requirePermission(ctx, 'marketing.read');
    const db = getDb();
    const rows = db.all<Record<string, unknown>>(
      `SELECT c.*, (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'confirmed') AS confirmed,
              (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'reserved') AS reserved,
              (SELECT COALESCE(SUM(discount_cents),0) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'confirmed') AS discountTotal,
              (SELECT COALESCE(SUM(o.total_cents),0) FROM coupon_redemptions r JOIN orders o ON o.id = r.order_id WHERE r.coupon_id = c.id AND r.status = 'confirmed') AS revenueTotal
         FROM coupons c ORDER BY c.created_at DESC`,
    );
    return {
      coupons: rows.map((c) => ({
        id: c.id, code: c.code, description: c.description, discountType: c.discount_type, value: c.value, minOrderCents: c.min_order_cents, startsAt: c.starts_at, endsAt: c.ends_at,
        maxUses: c.max_uses, maxUsesPerUser: c.max_uses_per_user, isActive: Boolean(c.is_active), isDemo: Boolean(c.is_demo),
        usage: { confirmed: c.confirmed, reserved: c.reserved, discountTotalCents: c.discountTotal, revenueCents: c.revenueTotal },
        categoryIds: db.all<{ category_id: number }>('SELECT category_id FROM coupon_categories WHERE coupon_id = ?', c.id as number).map((x) => x.category_id),
        productIds: db.all<{ product_id: number }>('SELECT product_id FROM coupon_products WHERE coupon_id = ?', c.id as number).map((x) => x.product_id),
      })),
    };
  });
  const saveCoupon = async (ctx: Ctx, id?: number) => {
    requirePermission(ctx, 'marketing.write');
    const b = await ctx.body(adminCouponSchema);
    const db = getDb();
    if (db.get('SELECT 1 FROM coupons WHERE code = ? AND id <> ?', b.code, id ?? 0)) throw new HttpError(409, 'Código já existe.', 'code_taken', { fieldErrors: { code: ['Código em uso.'] } });
    db.tx(() => {
      if (id) {
        const r2 = db.run('UPDATE coupons SET code = ?, description = ?, discount_type = ?, value = ?, min_order_cents = ?, starts_at = ?, ends_at = ?, max_uses = ?, max_uses_per_user = ?, is_active = ? WHERE id = ?',
          b.code, b.description, b.discountType, b.value, b.minOrderCents, b.startsAt ?? null, b.endsAt ?? null, b.maxUses ?? null, b.maxUsesPerUser ?? null, b.isActive, id);
        if (!r2.changes) throw new HttpError(404, 'Cupom não encontrado.', 'not_found');
      } else {
        id = db.run('INSERT INTO coupons (code, description, discount_type, value, min_order_cents, starts_at, ends_at, max_uses, max_uses_per_user, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          b.code, b.description, b.discountType, b.value, b.minOrderCents, b.startsAt ?? null, b.endsAt ?? null, b.maxUses ?? null, b.maxUsesPerUser ?? null, b.isActive).lastInsertRowid;
      }
      db.run('DELETE FROM coupon_categories WHERE coupon_id = ?', id);
      db.run('DELETE FROM coupon_products WHERE coupon_id = ?', id);
      for (const c of b.categoryIds) db.run('INSERT OR IGNORE INTO coupon_categories (coupon_id, category_id) SELECT ?, id FROM categories WHERE id = ?', id, c);
      for (const p of b.productIds) db.run('INSERT OR IGNORE INTO coupon_products (coupon_id, product_id) SELECT ?, id FROM products WHERE id = ?', id, p);
      audit({ actor: actorOf(ctx), action: 'coupon.save', entity: 'coupon', entityId: id!, data: b, ip: ctx.ip });
    });
    return { ok: true, id };
  };
  r.post('/api/admin/coupons', (ctx) => saveCoupon(ctx));
  r.put('/api/admin/coupons/:id', (ctx) => saveCoupon(ctx, intParam(ctx.params.id)));

  // ---------- Frete (política manual) ----------
  r.get('/api/admin/shipping-rules', (ctx) => {
    requirePermission(ctx, 'orders.read');
    return {
      rules: getDb().all('SELECT id, name, cep_start AS cepStart, cep_end AS cepEnd, price_cents AS priceCents, min_days AS minDays, max_days AS maxDays, free_above_cents AS freeAboveCents, is_active AS isActive, position FROM shipping_rules ORDER BY position, id'),
    };
  });
  const saveRule = async (ctx: Ctx, id?: number) => {
    requirePermission(ctx, 'settings.write');
    const b = await ctx.body(adminShippingRuleSchema);
    const db = getDb();
    if (id) {
      if (!db.run('UPDATE shipping_rules SET name = ?, cep_start = ?, cep_end = ?, price_cents = ?, min_days = ?, max_days = ?, free_above_cents = ?, is_active = ?, position = ? WHERE id = ?',
        b.name, b.cepStart, b.cepEnd, b.priceCents, b.minDays, b.maxDays, b.freeAboveCents ?? null, b.isActive, b.position, id).changes) throw new HttpError(404, 'Regra não encontrada.', 'not_found');
    } else {
      id = db.run('INSERT INTO shipping_rules (name, cep_start, cep_end, price_cents, min_days, max_days, free_above_cents, is_active, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        b.name, b.cepStart, b.cepEnd, b.priceCents, b.minDays, b.maxDays, b.freeAboveCents ?? null, b.isActive, b.position).lastInsertRowid;
    }
    audit({ actor: actorOf(ctx), action: 'shipping.save', entity: 'shipping_rule', entityId: id, data: b, ip: ctx.ip });
    return { ok: true, id };
  };
  r.post('/api/admin/shipping-rules', (ctx) => saveRule(ctx));
  r.put('/api/admin/shipping-rules/:id', (ctx) => saveRule(ctx, intParam(ctx.params.id)));
  r.delete('/api/admin/shipping-rules/:id', (ctx) => {
    requirePermission(ctx, 'settings.write');
    const id = intParam(ctx.params.id);
    getDb().run('DELETE FROM shipping_rules WHERE id = ?', id);
    audit({ actor: actorOf(ctx), action: 'shipping.delete', entity: 'shipping_rule', entityId: id, ip: ctx.ip });
    return { ok: true };
  });

  // ---------- Configurações ----------
  r.get('/api/admin/settings', (ctx) => {
    requirePermission(ctx, 'catalog.read');
    return getSettings();
  });
  r.put('/api/admin/settings', async (ctx) => {
    requirePermission(ctx, 'settings.write');
    const b = await ctx.body(storeSettingsSchema);
    const before = getSettings();
    saveSettings(b);
    audit({ actor: actorOf(ctx), action: 'settings.update', entity: 'settings', entityId: 'store', data: { packagingBefore: before.operations.packagingCostCents, packagingAfter: b.operations.packagingCostCents }, ip: ctx.ip });
    return getSettings();
  });

  // ---------- Clientes (somente dados necessários à operação) ----------
  r.get('/api/admin/customers', (ctx) => {
    requirePermission(ctx, 'customers.read');
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    return {
      customers: getDb().all(
        `SELECT u.id, u.email, u.role, u.staff_role AS staffRole, u.is_guest AS isGuest, u.anonymized_at AS anonymizedAt, u.created_at AS createdAt,
                u.email_verified_at IS NOT NULL AS emailVerified, p.full_name AS name,
                (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders,
                (SELECT COALESCE(SUM(total_cents), 0) FROM orders o WHERE o.user_id = u.id AND o.status IN ('paid','processing','shipped','delivered') AND o.is_demo = 0) AS spentCents
           FROM users u LEFT JOIN profiles p ON p.user_id = u.id
          WHERE (? = '' OR u.email LIKE ? OR p.full_name LIKE ?) ORDER BY u.created_at DESC LIMIT 100`,
        q, `%${q}%`, `%${q}%`,
      ),
    };
  });
}
