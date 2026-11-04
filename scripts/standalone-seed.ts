// Gera os dados da versão HTML autônoma a partir de um banco NOVO em memória (seed oficial),
// garantindo que o index.html sempre parta dos mesmos dados de demonstração. Saída: JSON no stdout.
//
// Além das tabelas do catálogo (que a demonstração edita localmente), grava um "retrato" das respostas
// públicas de conteúdo editorial do servidor real (home editorial, coleções, Archive, lookbooks, journal,
// páginas, FAQ, guias de medidas, Monte seu look) e os campos extras da página de produto. Assim a versão
// HTML mostra o mesmo conteúdo do site, sem reimplementar as regras no navegador.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.GAZU_ROOT ??= process.cwd();
process.env.APP_URL = 'http://127.0.0.1';
process.env.JOBS_ENABLED = 'false';
process.env.DEMO_MODE = 'true';
const { getDb } = await import('../src/server/db.ts');
const { seedDatabase } = await import('../src/server/cli/seed-data.ts');
const { createApp } = await import('../src/server/app.ts');
const db = getDb();
db.migrate();
seedDatabase(db);
const coupons = db.all<Record<string, unknown>>('SELECT * FROM coupons').map((c) => ({
  ...c,
  category_ids: db.all<{ category_id: number }>('SELECT category_id FROM coupon_categories WHERE coupon_id = ?', c.id as number).map((r) => r.category_id),
  product_ids: db.all<{ product_id: number }>('SELECT product_id FROM coupon_products WHERE coupon_id = ?', c.id as number).map((r) => r.product_id),
}));
const settings = JSON.parse(db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'store'")!.value);

// ---- Retrato das respostas públicas do servidor real ----
const server = createApp();
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as { port: number }).port;
const get = async (p: string): Promise<unknown | null> => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`);
  return res.ok ? res.json() : null;
};
const snapshot: Record<string, unknown> = {};
const take = async (p: string) => { const v = await get(p); if (v !== null) snapshot[p] = v; return v; };

const config = await get('/api/config');
await take('/api/content/home');
const cols = (await take('/api/collections')) as { collections: { slug: string }[] } | null;
const arch = (await take('/api/archive')) as { collections: { slug: string }[] } | null;
for (const c of [...(cols?.collections ?? []), ...(arch?.collections ?? [])]) await take(`/api/collections/${c.slug}`);
const looks = (await take('/api/lookbooks')) as { lookbooks: { slug: string }[] } | null;
for (const l of looks?.lookbooks ?? []) await take(`/api/lookbooks/${l.slug}`);
const journal = (await take('/api/journal')) as { articles: { slug: string; category: string }[] } | null;
for (const cat of new Set((journal?.articles ?? []).map((a) => a.category))) await take(`/api/journal?categoria=${encodeURIComponent(cat)}`);
for (const a of journal?.articles ?? []) await take(`/api/journal/${a.slug}`);
for (const p of db.all<{ slug: string }>("SELECT slug FROM pages WHERE status = 'published'")) await take(`/api/pages/${p.slug}`);
await take('/api/faq');
for (const cat of ['geral', 'pedidos', 'pagamento', 'entrega', 'trocas', 'produtos', 'conta', 'privacidade']) await take(`/api/faq?categoria=${cat}`);
for (const g of db.all<{ id: number }>('SELECT id FROM size_guides')) await take(`/api/size-guides/${g.id}`);
await take('/api/looks/builder');
await take('/api/newsletter/consent-text');
// Avaliações: a demonstração não tem avaliações (nunca são inventadas); guarda o formato vazio uma vez.
const firstProduct = db.get<{ id: number }>('SELECT id FROM products WHERE is_active = 1 ORDER BY id LIMIT 1');
const reviewsTemplate = firstProduct ? await get(`/api/products/${firstProduct.id}/reviews`) : null;

// Campos da página de produto que a demonstração não calcula (composição, cuidados, guia de medidas, FAQ, looks).
const EXTRA_KEYS = ['brand', 'composition', 'careInstructions', 'fitNotes', 'sizeGuide', 'reviews', 'looks', 'faq'];
const extras: Record<string, Record<string, unknown>> = {};
for (const p of db.all<{ slug: string }>('SELECT slug FROM products WHERE is_active = 1')) {
  const d = (await get(`/api/products/${p.slug}`)) as Record<string, unknown> | null;
  if (!d) continue;
  const e: Record<string, unknown> = {};
  for (const k of EXTRA_KEYS) if (d[k] !== undefined && d[k] !== null) e[k] = d[k];
  if (Object.keys(e).length) extras[p.slug] = e;
}
await new Promise<void>((r) => server.close(() => r()));

process.stdout.write(JSON.stringify({
  categories: db.all('SELECT id, slug, name, description, parent_id, position, is_active, image_url FROM categories ORDER BY id'),
  products: db.all('SELECT id, slug, name, description, details, audience, product_type, primary_category_id, price_cents, promo_price_cents, promo_starts_at, promo_ends_at, is_active, is_featured, is_demo, color_confirmed, seo_title, seo_description, created_at, updated_at FROM products ORDER BY id'),
  product_categories: db.all('SELECT product_id, category_id FROM product_categories'),
  product_images: db.all('SELECT id, product_id, url, NULL AS srcset, width, height, alt, color_name, object_position, position FROM product_images ORDER BY id'),
  product_variants: db.all('SELECT id, product_id, sku, color_name, color_hex, size, size_order, price_cents, stock, is_active FROM product_variants ORDER BY id'),
  coupons,
  shipping_rules: db.all('SELECT id, name, cep_start, cep_end, price_cents, min_days, max_days, free_above_cents, is_active, position FROM shipping_rules'),
  settings,
  serverConfig: config,
  snapshot,
  reviewsTemplate,
  extras,
}), () => process.exit(0)); // sai só depois de o stdout (pipe) ser totalmente escrito
