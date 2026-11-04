import { getDb, nowIso } from '../db.ts';
import { renderMarkdown } from '../../shared/markdown.ts';
import type {
  AnnouncementDTO, ArticleCardDTO, ArticleDetailDTO, BannerDTO, CollectionCardDTO, CollectionDetailDTO, HomeContentDTO, LookbookCardDTO, LookbookDetailDTO, PageDTO,
} from '../../shared/types.ts';
import { cardsFor, quickProducts } from './catalog.ts';
import { getSettings } from './settings.ts';

// Consultas públicas do conteúdo editorial. Somente itens publicados/ativos e dentro da validade.

const inWindow = "(starts_at IS NULL OR starts_at <= :now) AND (ends_at IS NULL OR ends_at >= :now)";
const win = (sql: string) => sql.replaceAll(':now', '?');

export function activeAnnouncements(now = nowIso()): AnnouncementDTO[] {
  return getDb().all<{ id: number; message: string; link_url: string | null }>(
    win(`SELECT id, message, link_url FROM announcements WHERE is_active = 1 AND ${inWindow} ORDER BY position, id`), now, now,
  ).map((a) => ({ id: a.id, message: a.message, linkUrl: a.link_url }));
}

export function activeBanners(placement?: BannerDTO['placement'], now = nowIso()): BannerDTO[] {
  return getDb().all<Record<string, unknown>>(
    win(`SELECT * FROM banners WHERE is_active = 1 AND ${inWindow} ${placement ? 'AND placement = ?' : ''} ORDER BY position, id`), now, now, ...(placement ? [placement] : []),
  ).map((b) => ({
    id: b.id as number, placement: b.placement as BannerDTO['placement'], eyebrow: (b.eyebrow as string) ?? null, title: b.title as string, subtitle: (b.subtitle as string) ?? null,
    imageUrl: (b.image_url as string) ?? null, imageAlt: (b.image_alt as string) ?? null, linkUrl: b.link_url as string, ctaLabel: b.cta_label as string,
  }));
}

// ---------------- Coleções e Archive ----------------
interface CollectionRow { id: number; slug: string; name: string; description: string; season: string | null; cover_url: string | null; cover_alt: string | null; status: CollectionCardDTO['status']; is_demo: number; archived_at: string | null; seo_title: string | null; seo_description: string | null }

function collectionCard(c: CollectionRow): CollectionCardDTO {
  const n = getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM collection_products cp JOIN products p ON p.id = cp.product_id WHERE cp.collection_id = ? AND p.deleted_at IS NULL', c.id)!.n;
  return { id: c.id, slug: c.slug, name: c.name, description: c.description, season: c.season, coverUrl: c.cover_url, coverAlt: c.cover_alt, status: c.status, productCount: n, isDemo: Boolean(c.is_demo), archivedAt: c.archived_at };
}

export function listCollections(status: 'active' | 'archived', opts: { featuredOnly?: boolean; limit?: number } = {}): CollectionCardDTO[] {
  return getDb().all<CollectionRow>(
    `SELECT * FROM collections WHERE status = ? ${opts.featuredOnly ? 'AND is_featured = 1' : ''} ORDER BY ${status === 'archived' ? 'COALESCE(archived_at, updated_at) DESC' : 'position, id DESC'} LIMIT ?`,
    status, opts.limit ?? 50,
  ).map(collectionCard);
}

export function collectionBySlug(slug: string): (CollectionDetailDTO & { seoTitle: string | null; seoDescription: string | null }) | null {
  const db = getDb();
  const c = db.get<CollectionRow>("SELECT * FROM collections WHERE slug = ? AND status IN ('active', 'archived')", slug);
  if (!c) return null;
  // Archive: produtos históricos aparecem mesmo despublicados — o cartão mostra "Indisponível".
  const rows = db.all<Parameters<typeof cardsFor>[0][number]>(
    `SELECT p.* FROM collection_products cp JOIN products p ON p.id = cp.product_id WHERE cp.collection_id = ? AND p.deleted_at IS NULL ${c.status === 'active' ? 'AND p.is_active = 1' : ''} ORDER BY cp.position`, c.id,
  );
  const cards = cardsFor(rows).map((card) => {
    const active = rows.find((r) => r.id === card.id)?.is_active;
    return active ? card : { ...card, available: false };
  });
  const lookbooks = db.all<{ id: number }>("SELECT id FROM lookbooks WHERE collection_id = ? AND status = 'published' ORDER BY position, id DESC", c.id).map((l) => lookbookCard(l.id)!).filter(Boolean);
  return { ...collectionCard(c), products: cards, lookbooks, seoTitle: c.seo_title, seoDescription: c.seo_description };
}

// ---------------- Lookbooks ----------------
export function lookbookCard(id: number): LookbookCardDTO | null {
  const l = getDb().get<{ id: number; slug: string; title: string; description: string; cover_url: string | null; is_demo: number; published_at: string | null }>('SELECT * FROM lookbooks WHERE id = ?', id);
  if (!l) return null;
  const n = getDb().get<{ n: number }>('SELECT COUNT(DISTINCT product_id) AS n FROM lookbook_products WHERE lookbook_id = ?', id)!.n;
  return { id: l.id, slug: l.slug, title: l.title, description: l.description, coverUrl: l.cover_url, productCount: n, isDemo: Boolean(l.is_demo), publishedAt: l.published_at };
}

export function listLookbooks(limit = 24): LookbookCardDTO[] {
  return getDb().all<{ id: number }>("SELECT id FROM lookbooks WHERE status = 'published' ORDER BY position, published_at DESC, id DESC LIMIT ?", limit).map((l) => lookbookCard(l.id)!);
}

export function lookbookBySlug(slug: string, opts: { includeDraft?: boolean } = {}): (LookbookDetailDTO & { seoTitle: string | null; seoDescription: string | null }) | null {
  const db = getDb();
  const l = db.get<{ id: number; collection_id: number | null; seo_title: string | null; seo_description: string | null }>(
    `SELECT * FROM lookbooks WHERE slug = ? ${opts.includeDraft ? '' : "AND status = 'published'"}`, slug,
  );
  if (!l) return null;
  const images = db.all<{ id: number; url: string; alt: string; width: number | null; height: number | null }>('SELECT * FROM lookbook_images WHERE lookbook_id = ? ORDER BY position, id', l.id);
  const spots = db.all<{ id: number; image_id: number | null; product_id: number; x_pct: number | null; y_pct: number | null; label: string | null }>(
    'SELECT * FROM lookbook_products WHERE lookbook_id = ? ORDER BY position, id', l.id,
  );
  // Somente produtos publicados aparecem como compráveis; despublicados são omitidos do look.
  const productIds = [...new Set(spots.map((s) => s.product_id))];
  const products = quickProducts(productIds);
  const visible = new Set(products.map((p) => p.id));
  const col = l.collection_id ? db.get<{ slug: string; name: string }>("SELECT slug, name FROM collections WHERE id = ? AND status IN ('active','archived')", l.collection_id) ?? null : null;
  return {
    ...lookbookCard(l.id)!,
    images: images.map((im) => ({
      id: im.id, url: im.url, alt: im.alt, width: im.width, height: im.height,
      hotspots: spots.filter((s) => s.image_id === im.id && visible.has(s.product_id)).map((s) => ({ id: s.id, productId: s.product_id, x: s.x_pct, y: s.y_pct, label: s.label })),
    })),
    products,
    collection: col,
    seoTitle: l.seo_title,
    seoDescription: l.seo_description,
  };
}

// ---------------- Journal ----------------
interface ArticleRow { id: number; slug: string; title: string; excerpt: string; body: string; cover_url: string | null; cover_alt: string | null; category: string; author: string; status: string; published_at: string | null; seo_title: string | null; seo_description: string | null; is_demo: number }
const articleCard = (a: ArticleRow): ArticleCardDTO => ({ id: a.id, slug: a.slug, title: a.title, excerpt: a.excerpt, coverUrl: a.cover_url, coverAlt: a.cover_alt, category: a.category, author: a.author, publishedAt: a.published_at, isDemo: Boolean(a.is_demo) });

export function listArticles(opts: { category?: string; limit?: number } = {}): ArticleCardDTO[] {
  return getDb().all<ArticleRow>(
    `SELECT * FROM journal_articles WHERE status = 'published' AND (published_at IS NULL OR published_at <= ?) ${opts.category ? 'AND category = ?' : ''} ORDER BY published_at DESC, id DESC LIMIT ?`,
    nowIso(), ...(opts.category ? [opts.category] : []), opts.limit ?? 24,
  ).map(articleCard);
}

export function articleBySlug(slug: string): ArticleDetailDTO | null {
  const db = getDb();
  const a = db.get<ArticleRow>("SELECT * FROM journal_articles WHERE slug = ? AND status = 'published' AND (published_at IS NULL OR published_at <= ?)", slug, nowIso());
  if (!a) return null;
  const rows = db.all<Parameters<typeof cardsFor>[0][number]>('SELECT p.* FROM journal_article_products jp JOIN products p ON p.id = jp.product_id WHERE jp.article_id = ? AND p.is_active = 1 ORDER BY jp.position', a.id);
  return { ...articleCard(a), html: renderMarkdown(a.body), products: cardsFor(rows), seoTitle: a.seo_title, seoDescription: a.seo_description };
}

// ---------------- Páginas institucionais ----------------
export function pageBySlug(slug: string): PageDTO | null {
  const p = getDb().get<{ slug: string; title: string; body: string; updated_at: string }>("SELECT * FROM pages WHERE slug = ? AND status = 'published'", slug);
  return p ? { slug: p.slug, title: p.title, html: renderMarkdown(p.body), updatedAt: p.updated_at } : null;
}

// ---------------- Home ----------------
export function homeContent(): HomeContentDTO {
  const s = getSettings();
  const featuredLook = getDb().get<{ slug: string }>("SELECT slug FROM lookbooks WHERE status = 'published' ORDER BY position, published_at DESC, id DESC LIMIT 1");
  return {
    sections: s.home.sections,
    banners: activeBanners(),
    collections: listCollections('active', { featuredOnly: true, limit: 6 }),
    lookbook: featuredLook ? lookbookBySlug(featuredLook.slug) : null,
    articles: listArticles({ limit: 3 }),
  };
}
