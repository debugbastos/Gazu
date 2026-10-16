import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from '../config.ts';
import type { Database } from '../db.ts';
import { defaultSettings } from '../services/settings.ts';

interface CatalogProduct {
  f: string; slug: string; name: string; cats: string[]; aud: string; type: string; colors: [string, string][]; sz: 'A' | 'K' | 'S' | 'U'; price: number; desc: string; pos: string; note?: string;
}
interface Catalog { sizeProfiles: Record<string, string[]>; products: CatalogProduct[] }
interface ImageManifest {
  products: Record<string, { variants: { width: number; height: number; url: string }[] }>;
  editorial: Record<string, { variants: { width: number; height: number; url: string }[] }>;
}

// Árvore inicial de categorias (editável no painel administrativo).
const TREE: { slug: string; name: string; description: string; children: [string, string][] }[] = [
  { slug: 'masculino', name: 'Masculino', description: 'Essenciais elevados para o dia a dia.', children: [['camisetas', 'Camisetas'], ['camisas', 'Camisas'], ['calcas', 'Calças'], ['shorts', 'Shorts e bermudas'], ['jaquetas', 'Jaquetas'], ['casacos', 'Casacos e moletons'], ['conjuntos', 'Conjuntos']] },
  { slug: 'feminino', name: 'Feminino', description: 'Estilo sem esforço, para todos os momentos.', children: [['blusas', 'Blusas'], ['camisetas', 'Camisetas'], ['calcas', 'Calças'], ['shorts', 'Shorts'], ['saias', 'Saias'], ['vestidos', 'Vestidos'], ['jaquetas', 'Jaquetas'], ['casacos', 'Casacos e moletons']] },
  { slug: 'infantil', name: 'Infantil', description: 'Conforto que acompanha cada brincadeira.', children: [['menino', 'Menino'], ['menina', 'Menina'], ['camisetas', 'Camisetas e suéteres'], ['calcas', 'Calças e jardineiras'], ['shorts', 'Shorts'], ['vestidos', 'Vestidos'], ['jaquetas', 'Jaquetas e moletons'], ['conjuntos', 'Conjuntos'], ['tenis', 'Tênis infantil']] },
  { slug: 'tenis', name: 'Tênis', description: 'Pares para caminhar com personalidade.', children: [['masculinos', 'Masculinos'], ['femininos', 'Femininos'], ['infantis', 'Infantis']] },
  { slug: 'acessorios', name: 'Acessórios', description: 'Detalhes que completam o visual.', children: [['relogios', 'Relógios'], ['aneis', 'Anéis'], ['pulseiras', 'Pulseiras'], ['colares', 'Colares'], ['bolsas', 'Bolsas'], ['bones', 'Bonés e chapéus']] },
];

const FEATURED = [
  'camiseta-oversized-blurred', 'camiseta-oversized-speed', 'camisa-manga-curta-texturizada', 'camiseta-basica-branca-masculina',
  'vestido-longo-branco-floral', 'camiseta-oversized-bloom-borboleta', 'tenis-branco-listras-verdes', 'conjunto-moletom-masculino-cinza',
];
const OUT_OF_STOCK = ['tenis-off-white-cerejas', 'jaqueta-racing-preta-patches'];
const CATEGORY_IMAGE: Record<string, string> = {
  masculino: 'camisa-manga-curta-texturizada', feminino: 'saia-longa-marrom', infantil: 'sueter-infantil-listrado', tenis: 'tenis-branco-listras-verdes',
};

const hashInt = (s: string): number => crypto.createHash('md5').update(s).digest().readUInt32BE(0);

/** Estoque de DEMONSTRAÇÃO determinístico (mesmo resultado a cada seed). */
function demoStock(key: string, size: string): number {
  // key = "slug:cor" — produtos da lista OUT_OF_STOCK ficam esgotados para demonstrar esse estado na loja.
  if (OUT_OF_STOCK.includes(key.split(':')[0]!)) return 0;
  const h = hashInt(`${key}:${size}`);
  return h % 7 === 0 ? 0 : (h % 9) + 1;
}

export function seedDatabase(db: Database, opts: { reset?: boolean } = {}): { products: number; categories: number; skipped: boolean } {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'db/seed/catalog.json'), 'utf8')) as Catalog;
  const images = JSON.parse(fs.readFileSync(path.join(ROOT, 'db/seed/images.json'), 'utf8')) as ImageManifest;
  const existing = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM products')!.n;
  if (existing && !opts.reset) return { products: existing, categories: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM categories')!.n, skipped: true };

  return db.tx(() => {
    if (opts.reset) {
      const orders = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM orders')!.n;
      if (orders) throw new Error('Existem pedidos registrados; o reset do catálogo foi bloqueado para preservar o histórico.');
      db.exec('DELETE FROM cart_items; DELETE FROM favorites; DELETE FROM inventory_movements; DELETE FROM product_variants; DELETE FROM product_images; DELETE FROM product_categories; DELETE FROM coupon_products; DELETE FROM coupon_categories; DELETE FROM coupon_redemptions; DELETE FROM coupons; DELETE FROM products; DELETE FROM categories WHERE parent_id IS NOT NULL; DELETE FROM categories;');
    }
    const catId = new Map<string, number>();
    TREE.forEach((root, i) => {
      const img = root.slug === 'acessorios' ? images.editorial['acessorios']?.variants[0]?.url : images.products[CATEGORY_IMAGE[root.slug] ?? '']?.variants[0]?.url;
      const id = db.run('INSERT INTO categories (slug, name, description, position, image_url) VALUES (?, ?, ?, ?, ?)', root.slug, root.name, root.description, i, img ?? null).lastInsertRowid;
      catId.set(root.slug, id);
      root.children.forEach(([s, n], j) => {
        const slug = `${root.slug}-${s}`;
        catId.set(slug, db.run('INSERT INTO categories (slug, name, parent_id, position) VALUES (?, ?, ?, ?)', slug, n, id, j).lastInsertRowid);
      });
    });

    const base = Date.now() - catalog.products.length * 3600_000;
    catalog.products.forEach((p, idx) => {
      const cats = p.cats.map((c) => {
        const id = catId.get(c);
        if (!id) throw new Error(`Categoria desconhecida no catálogo: ${c} (${p.slug})`);
        return id;
      });
      const created = new Date(base + idx * 3600_000).toISOString();
      const productId = db.run(
        `INSERT INTO products (slug, name, description, details, audience, product_type, primary_category_id, price_cents, is_active, is_featured, is_demo, color_confirmed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, 0, ?, ?)`,
        p.slug, p.name, p.desc, null, p.aud, p.type, cats[0]!, p.price * 100, FEATURED.includes(p.slug), created, created,
      ).lastInsertRowid;
      for (const c of new Set(cats)) db.run('INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)', productId, c);
      const im = images.products[p.slug];
      if (!im) throw new Error(`Imagem processada ausente para ${p.slug}. Rode: npm run images`);
      const main = im.variants[im.variants.length - 1]!;
      db.run(
        'INSERT INTO product_images (product_id, url, srcset, width, height, alt, color_name, object_position, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
        productId, main.url, im.variants.map((v) => `${v.url} ${v.width}w`).join(', '), main.width, main.height, p.name, null, p.pos,
      );
      const sizes = catalog.sizeProfiles[p.sz]!;
      p.colors.forEach(([color, hex], ci) => {
        sizes.forEach((size, si) => {
          const sku = `GZ-${String(productId).padStart(4, '0')}-${ci + 1}${String(si + 1).padStart(2, '0')}`;
          const vid = db.run('INSERT INTO product_variants (product_id, sku, color_name, color_hex, size, size_order, stock) VALUES (?, ?, ?, ?, ?, ?, 0)', productId, sku, color, hex, size, si).lastInsertRowid;
          const qty = demoStock(`${p.slug}:${color}`, size);
          if (qty > 0) {
            db.run('UPDATE product_variants SET stock = ? WHERE id = ?', qty, vid);
            db.run("INSERT INTO inventory_movements (variant_id, delta, reason, actor, note) VALUES (?, ?, 'initial', 'system:seed', 'Estoque de demonstração')", vid, qty);
          }
        });
      });
    });

    db.run("INSERT INTO coupons (code, description, discount_type, value, min_order_cents, is_active, is_demo) VALUES ('BEMVINDO10', 'Cupom de demonstração: 10% de desconto', 'percent', 10, 15000, 1, 1)");
    if (!db.get("SELECT 1 FROM settings WHERE key = 'store'")) db.run("INSERT INTO settings (key, value) VALUES ('store', ?)", JSON.stringify(defaultSettings));
    return { products: catalog.products.length, categories: catId.size, skipped: false };
  });
}
