// Gera o catálogo inicial da versão HTML autônoma a partir de um banco NOVO em memória (seed oficial),
// garantindo que o index.html sempre parta dos mesmos dados de demonstração. Saída: JSON no stdout.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.GAZU_ROOT ??= process.cwd();
const { getDb } = await import('../src/server/db.ts');
const { seedDatabase } = await import('../src/server/cli/seed-data.ts');
const db = getDb();
db.migrate();
seedDatabase(db);
const coupons = db.all<Record<string, unknown>>('SELECT * FROM coupons').map((c) => ({
  ...c,
  category_ids: db.all<{ category_id: number }>('SELECT category_id FROM coupon_categories WHERE coupon_id = ?', c.id as number).map((r) => r.category_id),
  product_ids: db.all<{ product_id: number }>('SELECT product_id FROM coupon_products WHERE coupon_id = ?', c.id as number).map((r) => r.product_id),
}));
const settings = JSON.parse(db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'store'")!.value);
process.stdout.write(JSON.stringify({
  categories: db.all('SELECT id, slug, name, description, parent_id, position, is_active, image_url FROM categories ORDER BY id'),
  products: db.all('SELECT id, slug, name, description, details, audience, product_type, primary_category_id, price_cents, promo_price_cents, promo_starts_at, promo_ends_at, is_active, is_featured, is_demo, color_confirmed, seo_title, seo_description, created_at, updated_at FROM products ORDER BY id'),
  product_categories: db.all('SELECT product_id, category_id FROM product_categories'),
  product_images: db.all('SELECT id, product_id, url, NULL AS srcset, width, height, alt, color_name, object_position, position FROM product_images ORDER BY id'),
  product_variants: db.all('SELECT id, product_id, sku, color_name, color_hex, size, size_order, price_cents, stock, is_active FROM product_variants ORDER BY id'),
  coupons,
  shipping_rules: db.all('SELECT id, name, cep_start, cep_end, price_cents, min_days, max_days, free_above_cents, is_active, position FROM shipping_rules'),
  settings,
}));
