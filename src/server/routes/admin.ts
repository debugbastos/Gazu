import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { ROOT } from '../config.ts';
import { getDb, nowIso } from '../db.ts';
import { HttpError, intParam, requireAdmin, type Router } from '../http.ts';
import { moveStock } from '../services/inventory.ts';
import { adminUpdateOrder, getOrder, orderIdByNumber } from '../services/orders.ts';
import { getSettings, saveSettings, storeSettingsSchema } from '../services/settings.ts';
import { categoryTree, listCategories } from '../services/catalog.ts';
import {
  adminCategorySchema, adminCouponSchema, adminOrderUpdateSchema, adminProductSchema, adminShippingRuleSchema, adminVariantSchema, stockAdjustSchema,
} from '../validation.ts';

const audit = (actor: string, action: string, entity: string, entityId: string | number, data?: unknown) =>
  getDb().run('INSERT INTO audit_log (actor, action, entity, entity_id, data) VALUES (?, ?, ?, ?, ?)', actor, action, entity, String(entityId), data === undefined ? null : JSON.stringify(data));

const PAID_STATUSES = "('paid','processing','shipped','delivered')";

function productAdminDetail(id: number) {
  const db = getDb();
  const p = db.get<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
  return {
    id: p.id, slug: p.slug, name: p.name, description: p.description, details: p.details, audience: p.audience, productType: p.product_type,
    priceCents: p.price_cents, promoPriceCents: p.promo_price_cents, promoStartsAt: p.promo_starts_at, promoEndsAt: p.promo_ends_at,
    primaryCategoryId: p.primary_category_id, isActive: Boolean(p.is_active), isFeatured: Boolean(p.is_featured), isDemo: Boolean(p.is_demo), colorConfirmed: Boolean(p.color_confirmed),
    seoTitle: p.seo_title, seoDescription: p.seo_description, createdAt: p.created_at, updatedAt: p.updated_at,
    categoryIds: db.all<{ category_id: number }>('SELECT category_id FROM product_categories WHERE product_id = ?', id).map((r) => r.category_id),
    images: db.all<Record<string, unknown>>('SELECT * FROM product_images WHERE product_id = ? ORDER BY position', id).map((i) => ({ id: i.id, url: i.url, srcset: i.srcset, alt: i.alt, colorName: i.color_name, position: i.position, objectPosition: i.object_position, width: i.width, height: i.height })),
    variants: db.all<Record<string, unknown>>('SELECT * FROM product_variants WHERE product_id = ? ORDER BY color_name, size_order', id).map((v) => ({ id: v.id, sku: v.sku, colorName: v.color_name, colorHex: v.color_hex, size: v.size, sizeOrder: v.size_order, priceCents: v.price_cents, stock: v.stock, isActive: Boolean(v.is_active) })),
  };
}

function writeProductCategories(productId: number, ids: number[]): void {
  const db = getDb();
  const valid = db.all<{ id: number }>(`SELECT id FROM categories WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((r) => r.id);
  if (valid.length !== new Set(ids).size) throw new HttpError(400, 'Categoria inexistente.', 'bad_category');
  db.run('DELETE FROM product_categories WHERE product_id = ?', productId);
  for (const c of new Set(valid)) db.run('INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)', productId, c);
}

const MAGIC: [string, number[]][] = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]],
];

export function registerAdminRoutes(r: Router): void {
  r.get('/api/admin/dashboard', (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const one = (sql: string, ...p: (string | number)[]) => db.get<{ n: number }>(sql, ...p)!.n;
    return {
      orders: {
        total: one('SELECT COUNT(*) AS n FROM orders WHERE is_demo = 0'),
        pending: one("SELECT COUNT(*) AS n FROM orders WHERE is_demo = 0 AND status = 'pending_payment'"),
        paid: one(`SELECT COUNT(*) AS n FROM orders WHERE is_demo = 0 AND status IN ${PAID_STATUSES}`),
        toShip: one("SELECT COUNT(*) AS n FROM orders WHERE is_demo = 0 AND status IN ('paid','processing')"),
      },
      // Receita: soma dos pedidos com pagamento aprovado (status pagos), excluindo pedidos de demonstração.
      revenueCents: one(`SELECT COALESCE(SUM(total_cents), 0) AS n FROM orders WHERE is_demo = 0 AND status IN ${PAID_STATUSES}`),
      demoOrders: one('SELECT COUNT(*) AS n FROM orders WHERE is_demo = 1'),
      products: { active: one('SELECT COUNT(*) AS n FROM products WHERE is_active = 1'), demo: one('SELECT COUNT(*) AS n FROM products WHERE is_demo = 1') },
      lowStock: db.all(`SELECT v.id, v.sku, v.color_name AS colorName, v.size, v.stock, p.name, p.id AS productId FROM product_variants v JOIN products p ON p.id = v.product_id
                         WHERE v.is_active = 1 AND p.is_active = 1 AND v.stock <= 2 ORDER BY v.stock, p.name LIMIT 12`),
      lowStockCount: one('SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.is_active = 1 AND p.is_active = 1 AND v.stock <= 2'),
      recentOrders: db.all('SELECT number, status, total_cents AS totalCents, is_demo AS isDemo, created_at AS createdAt FROM orders ORDER BY created_at DESC LIMIT 8'),
    };
  });

  // ---------- Produtos ----------
  r.get('/api/admin/products', (ctx) => {
    requireAdmin(ctx);
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const status = ctx.url.searchParams.get('status');
    const page = Math.max(1, Number(ctx.url.searchParams.get('pagina') ?? 1) || 1);
    const where: string[] = ['1=1'];
    const params: string[] = [];
    if (q) { where.push("(gz_norm(p.name) LIKE gz_norm(?) OR p.slug LIKE ? OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.sku LIKE ?))"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (status === 'ativos') where.push('p.is_active = 1');
    if (status === 'inativos') where.push('p.is_active = 0');
    if (status === 'demo') where.push('p.is_demo = 1');
    if (status === 'sem-estoque') where.push('(SELECT COALESCE(SUM(stock),0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) = 0');
    const db = getDb();
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM products p WHERE ${where.join(' AND ')}`, ...params)!.n;
    const items = db.all(
      `SELECT p.id, p.slug, p.name, p.price_cents AS priceCents, p.promo_price_cents AS promoPriceCents, p.is_active AS isActive, p.is_featured AS isFeatured, p.is_demo AS isDemo,
              (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY position LIMIT 1) AS image,
              (SELECT COALESCE(SUM(stock),0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS stock,
              (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variantCount,
              (SELECT name FROM categories c WHERE c.id = p.primary_category_id) AS category
         FROM products p WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC, p.id DESC LIMIT 30 OFFSET ?`,
      ...params, (page - 1) * 30,
    );
    return { items, total, page, pages: Math.max(1, Math.ceil(total / 30)) };
  });

  r.get('/api/admin/products/:id', (ctx) => {
    requireAdmin(ctx);
    return productAdminDetail(intParam(ctx.params.id));
  });

  r.post('/api/admin/products', async (ctx) => {
    const admin = requireAdmin(ctx);
    const b = await ctx.body(adminProductSchema);
    const db = getDb();
    if (db.get('SELECT 1 FROM products WHERE slug = ?', b.slug)) throw new HttpError(409, 'Já existe um produto com este slug.', 'slug_taken', { fieldErrors: { slug: ['Slug em uso.'] } });
    const id = db.tx(() => {
      const { lastInsertRowid } = db.run(
        `INSERT INTO products (slug, name, description, details, audience, product_type, primary_category_id, price_cents, promo_price_cents, promo_starts_at, promo_ends_at,
           is_active, is_featured, is_demo, color_confirmed, seo_title, seo_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        b.slug, b.name, b.description, b.details ?? null, b.audience, b.productType, b.primaryCategoryId, b.priceCents, b.promoPriceCents ?? null, b.promoStartsAt ?? null, b.promoEndsAt ?? null,
        b.isActive, b.isFeatured, b.isDemo, b.colorConfirmed, b.seoTitle ?? null, b.seoDescription ?? null,
      );
      writeProductCategories(lastInsertRowid, b.categoryIds);
      audit(`admin:${admin.id}`, 'product.create', 'product', lastInsertRowid, { slug: b.slug });
      return lastInsertRowid;
    });
    return productAdminDetail(id);
  });

  r.put('/api/admin/products/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = intParam(ctx.params.id);
    const b = await ctx.body(adminProductSchema);
    const db = getDb();
    const clash = db.get<{ id: number }>('SELECT id FROM products WHERE slug = ? AND id <> ?', b.slug, id);
    if (clash) throw new HttpError(409, 'Já existe um produto com este slug.', 'slug_taken', { fieldErrors: { slug: ['Slug em uso.'] } });
    db.tx(() => {
      const before = db.get<{ price_cents: number; promo_price_cents: number | null }>('SELECT price_cents, promo_price_cents FROM products WHERE id = ?', id);
      if (!before) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
      db.run(
        `UPDATE products SET slug = ?, name = ?, description = ?, details = ?, audience = ?, product_type = ?, primary_category_id = ?, price_cents = ?, promo_price_cents = ?,
           promo_starts_at = ?, promo_ends_at = ?, is_active = ?, is_featured = ?, is_demo = ?, color_confirmed = ?, seo_title = ?, seo_description = ?, updated_at = ? WHERE id = ?`,
        b.slug, b.name, b.description, b.details ?? null, b.audience, b.productType, b.primaryCategoryId, b.priceCents, b.promoPriceCents ?? null, b.promoStartsAt ?? null, b.promoEndsAt ?? null,
        b.isActive, b.isFeatured, b.isDemo, b.colorConfirmed, b.seoTitle ?? null, b.seoDescription ?? null, nowIso(), id,
      );
      writeProductCategories(id, b.categoryIds);
      audit(`admin:${admin.id}`, 'product.update', 'product', id, { priceBefore: before.price_cents, priceAfter: b.priceCents, promoBefore: before.promo_price_cents, promoAfter: b.promoPriceCents ?? null, isActive: b.isActive });
    });
    return productAdminDetail(id);
  });

  // ---------- Variantes e estoque ----------
  r.post('/api/admin/products/:id/variants', async (ctx) => {
    const admin = requireAdmin(ctx);
    const productId = intParam(ctx.params.id);
    const b = await ctx.body(adminVariantSchema);
    const db = getDb();
    if (!db.get('SELECT 1 FROM products WHERE id = ?', productId)) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
    if (db.get('SELECT 1 FROM product_variants WHERE sku = ?', b.sku)) throw new HttpError(409, 'SKU já utilizado.', 'sku_taken', { fieldErrors: { sku: ['SKU em uso.'] } });
    if (db.get('SELECT 1 FROM product_variants WHERE product_id = ? AND color_name = ? AND size = ?', productId, b.colorName, b.size)) throw new HttpError(409, 'Esta combinação de cor e tamanho já existe.', 'variant_exists');
    db.tx(() => {
      const { lastInsertRowid } = db.run(
        'INSERT INTO product_variants (product_id, sku, color_name, color_hex, size, size_order, price_cents, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
        productId, b.sku, b.colorName, b.colorHex ?? null, b.size, b.sizeOrder, b.priceCents ?? null, b.isActive,
      );
      if (b.initialStock) moveStock(lastInsertRowid, b.initialStock, 'initial', `admin:${admin.id}`, null, 'Estoque inicial');
      audit(`admin:${admin.id}`, 'variant.create', 'variant', lastInsertRowid, b);
    });
    return productAdminDetail(productId);
  });

  r.put('/api/admin/variants/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = intParam(ctx.params.id);
    const b = await ctx.body(adminVariantSchema.omit({ initialStock: true }));
    const db = getDb();
    const v = db.get<{ product_id: number }>('SELECT product_id FROM product_variants WHERE id = ?', id);
    if (!v) throw new HttpError(404, 'Variante não encontrada.', 'not_found');
    if (db.get('SELECT 1 FROM product_variants WHERE sku = ? AND id <> ?', b.sku, id)) throw new HttpError(409, 'SKU já utilizado.', 'sku_taken');
    if (db.get('SELECT 1 FROM product_variants WHERE product_id = ? AND color_name = ? AND size = ? AND id <> ?', v.product_id, b.colorName, b.size, id)) throw new HttpError(409, 'Esta combinação de cor e tamanho já existe.', 'variant_exists');
    db.run('UPDATE product_variants SET sku = ?, color_name = ?, color_hex = ?, size = ?, size_order = ?, price_cents = ?, is_active = ? WHERE id = ?', b.sku, b.colorName, b.colorHex ?? null, b.size, b.sizeOrder, b.priceCents ?? null, b.isActive, id);
    audit(`admin:${admin.id}`, 'variant.update', 'variant', id, b);
    return productAdminDetail(v.product_id);
  });

  r.post('/api/admin/variants/:id/stock', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = intParam(ctx.params.id);
    const b = await ctx.body(stockAdjustSchema);
    const db = getDb();
    const v = db.get<{ product_id: number }>('SELECT product_id FROM product_variants WHERE id = ?', id);
    if (!v) throw new HttpError(404, 'Variante não encontrada.', 'not_found');
    db.tx(() => moveStock(id, b.delta, b.reason, `admin:${admin.id}`, null, b.note ?? null));
    return productAdminDetail(v.product_id);
  });

  r.get('/api/admin/variants/:id/movements', (ctx) => {
    requireAdmin(ctx);
    return { movements: getDb().all('SELECT id, delta, reason, order_id AS orderId, actor, note, created_at AS createdAt FROM inventory_movements WHERE variant_id = ? ORDER BY id DESC LIMIT 100', intParam(ctx.params.id)) };
  });

  // ---------- Imagens (upload validado: tipo real por assinatura, tamanho, reprocessamento) ----------
  r.post('/api/admin/products/:id/images', async (ctx) => {
    const admin = requireAdmin(ctx);
    const productId = intParam(ctx.params.id);
    const db = getDb();
    const product = db.get<{ slug: string; name: string }>('SELECT slug, name FROM products WHERE id = ?', productId);
    if (!product) throw new HttpError(404, 'Produto não encontrado.', 'not_found');
    const buf = ctx.rawBody;
    if (!buf || buf.length < 100) throw new HttpError(400, 'Envie um arquivo de imagem.', 'no_file');
    if (buf.length > 8 * 1024 * 1024) throw new HttpError(413, 'Imagem acima de 8 MB.', 'too_large');
    const kind = MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b));
    if (!kind) throw new HttpError(415, 'Formato não suportado. Use JPG, PNG ou WebP.', 'bad_type');
    let meta;
    try { meta = await sharp(buf).metadata(); } catch { throw new HttpError(415, 'Arquivo de imagem inválido.', 'bad_image'); }
    if (!meta.width || !meta.height || meta.width > 8000 || meta.height > 8000) throw new HttpError(415, 'Dimensões de imagem inválidas.', 'bad_image');
    const dir = path.join(ROOT, 'public/uploads/products', product.slug);
    fs.mkdirSync(dir, { recursive: true });
    const base = crypto.randomBytes(6).toString('hex');
    const variants: { url: string; width: number; height: number }[] = [];
    for (const w of [480, 960, 1600]) {
      const width = Math.min(w, meta.width);
      if (variants.some((v) => v.width === width)) continue;
      const file = path.join(dir, `${base}-${width}.webp`);
      const info = await sharp(buf).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 84 }).toFile(file);
      variants.push({ url: `/uploads/products/${product.slug}/${base}-${width}.webp`, width: info.width, height: info.height });
    }
    const main = variants[variants.length - 1]!;
    const alt = (ctx.url.searchParams.get('alt') ?? product.name).slice(0, 160);
    const colorName = ctx.url.searchParams.get('cor')?.slice(0, 60) || null;
    const pos = db.get<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM product_images WHERE product_id = ?', productId)!.n;
    db.run('INSERT INTO product_images (product_id, url, srcset, width, height, alt, color_name, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      productId, main.url, variants.map((v) => `${v.url} ${v.width}w`).join(', '), main.width, main.height, alt, colorName, pos);
    audit(`admin:${admin.id}`, 'image.upload', 'product', productId, { url: main.url, type: kind[0] });
    return productAdminDetail(productId);
  });

  r.put('/api/admin/images/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = intParam(ctx.params.id);
    const b = await ctx.body(z.object({ alt: z.string().trim().max(160), colorName: z.string().trim().max(60).nullable(), position: z.number().int().min(0).max(99), objectPosition: z.string().regex(/^[a-z0-9% ]{1,30}$/).default('center') }));
    const img = getDb().get<{ product_id: number }>('SELECT product_id FROM product_images WHERE id = ?', id);
    if (!img) throw new HttpError(404, 'Imagem não encontrada.', 'not_found');
    getDb().run('UPDATE product_images SET alt = ?, color_name = ?, position = ?, object_position = ? WHERE id = ?', b.alt, b.colorName || null, b.position, b.objectPosition, id);
    audit(`admin:${admin.id}`, 'image.update', 'image', id, b);
    return productAdminDetail(img.product_id);
  });

  r.delete('/api/admin/images/:id', (ctx) => {
    const admin = requireAdmin(ctx);
    const id = intParam(ctx.params.id);
    const img = getDb().get<{ product_id: number; url: string }>('SELECT product_id, url FROM product_images WHERE id = ?', id);
    if (!img) throw new HttpError(404, 'Imagem não encontrada.', 'not_found');
    getDb().run('DELETE FROM product_images WHERE id = ?', id);
    audit(`admin:${admin.id}`, 'image.delete', 'image', id, { url: img.url });
    return productAdminDetail(img.product_id);
  });

  // ---------- Categorias ----------
  r.get('/api/admin/categories', (ctx) => {
    requireAdmin(ctx);
    return { categories: listCategories(true), tree: categoryTree(true) };
  });
  const saveCategory = async (ctx: Parameters<Parameters<Router['post']>[1]>[0], id?: number) => {
    const admin = requireAdmin(ctx);
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
    audit(`admin:${admin.id}`, 'category.save', 'category', id, b);
    return { categories: listCategories(true) };
  };
  r.post('/api/admin/categories', (ctx) => saveCategory(ctx));
  r.put('/api/admin/categories/:id', (ctx) => saveCategory(ctx, intParam(ctx.params.id)));

  // ---------- Pedidos ----------
  r.get('/api/admin/orders', (ctx) => {
    requireAdmin(ctx);
    const sp = ctx.url.searchParams;
    const where: string[] = ['1=1'];
    const params: string[] = [];
    const status = sp.get('status');
    if (status) { where.push('o.status = ?'); params.push(status); }
    const q = (sp.get('q') ?? '').trim();
    if (q) { where.push('(o.number LIKE ? OR u.email LIKE ? OR o.ship_recipient LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const page = Math.max(1, Number(sp.get('pagina') ?? 1) || 1);
    const db = getDb();
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where.join(' AND ')}`, ...params)!.n;
    const items = db.all(
      `SELECT o.number, o.status, o.total_cents AS totalCents, o.is_demo AS isDemo, o.created_at AS createdAt, u.email, o.ship_recipient AS recipient,
              (SELECT status FROM payments p WHERE p.order_id = o.id ORDER BY id DESC LIMIT 1) AS paymentStatus,
              (SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id) AS items
         FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 30 OFFSET ?`,
      ...params, (page - 1) * 30,
    );
    return { items, total, page, pages: Math.max(1, Math.ceil(total / 30)) };
  });
  r.get('/api/admin/orders/:number', (ctx) => {
    requireAdmin(ctx);
    const id = orderIdByNumber(ctx.params.number!);
    if (!id) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
    return getOrder(id, { withCustomer: true });
  });
  r.patch('/api/admin/orders/:number', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = orderIdByNumber(ctx.params.number!);
    if (!id) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
    const b = await ctx.body(adminOrderUpdateSchema);
    adminUpdateOrder(id, admin.id, { status: b.status, trackingCode: b.trackingCode, trackingUrl: b.trackingUrl === '' ? null : b.trackingUrl, note: b.note });
    return getOrder(id, { withCustomer: true });
  });

  // ---------- Cupons ----------
  r.get('/api/admin/coupons', (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const rows = db.all<Record<string, unknown>>(
      `SELECT c.*, (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'confirmed') AS confirmed,
              (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'reserved') AS reserved,
              (SELECT COALESCE(SUM(discount_cents),0) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'confirmed') AS discountTotal
         FROM coupons c ORDER BY c.created_at DESC`,
    );
    return {
      coupons: rows.map((c) => ({
        id: c.id, code: c.code, description: c.description, discountType: c.discount_type, value: c.value, minOrderCents: c.min_order_cents, startsAt: c.starts_at, endsAt: c.ends_at,
        maxUses: c.max_uses, maxUsesPerUser: c.max_uses_per_user, isActive: Boolean(c.is_active), isDemo: Boolean(c.is_demo), usage: { confirmed: c.confirmed, reserved: c.reserved, discountTotalCents: c.discountTotal },
        categoryIds: db.all<{ category_id: number }>('SELECT category_id FROM coupon_categories WHERE coupon_id = ?', c.id as number).map((x) => x.category_id),
        productIds: db.all<{ product_id: number }>('SELECT product_id FROM coupon_products WHERE coupon_id = ?', c.id as number).map((x) => x.product_id),
      })),
    };
  });
  const saveCoupon = async (ctx: Parameters<Parameters<Router['post']>[1]>[0], id?: number) => {
    const admin = requireAdmin(ctx);
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
      audit(`admin:${admin.id}`, 'coupon.save', 'coupon', id!, b);
    });
    return { ok: true, id };
  };
  r.post('/api/admin/coupons', (ctx) => saveCoupon(ctx));
  r.put('/api/admin/coupons/:id', (ctx) => saveCoupon(ctx, intParam(ctx.params.id)));

  // ---------- Frete (política manual) ----------
  r.get('/api/admin/shipping-rules', (ctx) => {
    requireAdmin(ctx);
    return {
      rules: getDb().all('SELECT id, name, cep_start AS cepStart, cep_end AS cepEnd, price_cents AS priceCents, min_days AS minDays, max_days AS maxDays, free_above_cents AS freeAboveCents, is_active AS isActive, position FROM shipping_rules ORDER BY position, id'),
    };
  });
  const saveRule = async (ctx: Parameters<Parameters<Router['post']>[1]>[0], id?: number) => {
    const admin = requireAdmin(ctx);
    const b = await ctx.body(adminShippingRuleSchema);
    const db = getDb();
    if (id) {
      if (!db.run('UPDATE shipping_rules SET name = ?, cep_start = ?, cep_end = ?, price_cents = ?, min_days = ?, max_days = ?, free_above_cents = ?, is_active = ?, position = ? WHERE id = ?',
        b.name, b.cepStart, b.cepEnd, b.priceCents, b.minDays, b.maxDays, b.freeAboveCents ?? null, b.isActive, b.position, id).changes) throw new HttpError(404, 'Regra não encontrada.', 'not_found');
    } else {
      id = db.run('INSERT INTO shipping_rules (name, cep_start, cep_end, price_cents, min_days, max_days, free_above_cents, is_active, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        b.name, b.cepStart, b.cepEnd, b.priceCents, b.minDays, b.maxDays, b.freeAboveCents ?? null, b.isActive, b.position).lastInsertRowid;
    }
    audit(`admin:${admin.id}`, 'shipping.save', 'shipping_rule', id, b);
    return { ok: true, id };
  };
  r.post('/api/admin/shipping-rules', (ctx) => saveRule(ctx));
  r.put('/api/admin/shipping-rules/:id', (ctx) => saveRule(ctx, intParam(ctx.params.id)));
  r.delete('/api/admin/shipping-rules/:id', (ctx) => {
    const admin = requireAdmin(ctx);
    const id = intParam(ctx.params.id);
    getDb().run('DELETE FROM shipping_rules WHERE id = ?', id);
    audit(`admin:${admin.id}`, 'shipping.delete', 'shipping_rule', id);
    return { ok: true };
  });

  // ---------- Configurações ----------
  r.get('/api/admin/settings', (ctx) => {
    requireAdmin(ctx);
    return getSettings();
  });
  r.put('/api/admin/settings', async (ctx) => {
    const admin = requireAdmin(ctx);
    const b = await ctx.body(storeSettingsSchema);
    saveSettings(b);
    audit(`admin:${admin.id}`, 'settings.update', 'settings', 'store');
    return getSettings();
  });

  // ---------- Clientes (somente dados necessários à operação) ----------
  r.get('/api/admin/customers', (ctx) => {
    requireAdmin(ctx);
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    return {
      customers: getDb().all(
        `SELECT u.id, u.email, u.role, u.created_at AS createdAt, u.email_verified_at IS NOT NULL AS emailVerified, p.full_name AS name,
                (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders
           FROM users u LEFT JOIN profiles p ON p.user_id = u.id
          WHERE (? = '' OR u.email LIKE ? OR p.full_name LIKE ?) ORDER BY u.created_at DESC LIMIT 100`,
        q, `%${q}%`, `%${q}%`,
      ),
    };
  });
}
