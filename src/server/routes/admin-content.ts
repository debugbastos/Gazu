import { z } from 'zod';
import { getDb, nowIso } from '../db.ts';
import { HttpError, intParam, requirePermission, type Router } from '../http.ts';
import { registerResource } from '../services/resources.ts';
import { processImageUpload } from '../services/uploads.ts';
import { audit } from '../services/audit.ts';
import { lookbookBySlug } from '../services/content.ts';

// Recursos administráveis de conteúdo, marketing e financeiro (CRUD genérico com permissões).

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.').max(120);
const isoDate = z.string().datetime({ offset: true }).nullable().optional();
const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v ?? null));
const url = z.string().trim().max(500).refine((v) => v === '' || v.startsWith('/') || /^https?:\/\//.test(v), 'Use um endereço iniciando com / ou https://').nullable().optional().transform((v) => (v === '' ? null : v ?? null));
const ids = z.array(z.number().int().positive()).max(200).optional();
const windowCheck = (d: { startsAt?: string | null; endsAt?: string | null }) => !d.startsAt || !d.endsAt || d.startsAt < d.endsAt;

export function registerAdminContentRoutes(r: Router): void {
  // ---------- Upload genérico de imagens de conteúdo ----------
  r.post('/api/admin/uploads', async (ctx) => {
    const admin = requirePermission(ctx, 'content.write');
    const folder = ctx.url.searchParams.get('pasta') ?? 'conteudo';
    if (!['conteudo', 'lookbooks', 'journal', 'banners', 'colecoes', 'marca'].includes(folder)) throw new HttpError(400, 'Pasta inválida.', 'bad_folder');
    const img = await processImageUpload(ctx.rawBody, folder, new Date().toISOString().slice(0, 7));
    audit({ actor: `admin:${admin.id}`, action: 'upload.image', entity: 'upload', entityId: img.url, data: { folder, type: img.type }, ip: ctx.ip });
    return img;
  });

  // ---------- Barra de anúncios (com ativação e validade) ----------
  registerResource(r, {
    name: 'announcements', table: 'announcements', entity: 'announcement', read: 'catalog.read', write: 'content.write',
    schema: z.object({ message: z.string().trim().min(2).max(120), linkUrl: url, startsAt: isoDate, endsAt: isoDate, isActive: z.boolean(), position: z.number().int().min(0).max(99).default(0) })
      .refine(windowCheck, { message: 'O fim deve ser posterior ao início.', path: ['endsAt'] }),
    columns: { message: 'message', linkUrl: 'link_url', startsAt: 'starts_at', endsAt: 'ends_at', isActive: 'is_active', position: 'position' },
    orderBy: 'position, id', search: ['message'],
  });

  // ---------- Banners ----------
  registerResource(r, {
    name: 'banners', table: 'banners', entity: 'banner', read: 'catalog.read', write: 'content.write',
    schema: z.object({
      placement: z.enum(['home_editorial', 'home_secondary', 'catalog_top']), eyebrow: optText(40), title: z.string().trim().min(2).max(80), subtitle: optText(200),
      imageUrl: url, imageAlt: optText(160), linkUrl: z.string().trim().max(300).refine((v) => v.startsWith('/') || /^https?:\/\//.test(v), 'Link inválido.'),
      ctaLabel: z.string().trim().min(2).max(40), campaignId: z.number().int().positive().nullable().optional(), startsAt: isoDate, endsAt: isoDate, isActive: z.boolean(),
      position: z.number().int().min(0).max(99).default(0),
    }).refine(windowCheck, { message: 'O fim deve ser posterior ao início.', path: ['endsAt'] }),
    columns: { placement: 'placement', eyebrow: 'eyebrow', title: 'title', subtitle: 'subtitle', imageUrl: 'image_url', imageAlt: 'image_alt', linkUrl: 'link_url', ctaLabel: 'cta_label', campaignId: 'campaign_id', startsAt: 'starts_at', endsAt: 'ends_at', isActive: 'is_active', position: 'position' },
    orderBy: 'placement, position, id', search: ['title'], filters: { posicao: 'placement' },
  });

  // ---------- Coleções (ativas e Archive) ----------
  registerResource(r, {
    name: 'collections', table: 'collections', entity: 'collection', read: 'catalog.read', write: 'catalog.write',
    schema: z.object({
      name: z.string().trim().min(2).max(80), slug, description: z.string().trim().max(1000).default(''), season: optText(40), coverUrl: url, coverAlt: optText(160),
      status: z.enum(['draft', 'active', 'archived']), isFeatured: z.boolean(), position: z.number().int().min(0).max(999).default(0), seoTitle: optText(70), seoDescription: optText(170), productIds: ids,
    }),
    columns: { name: 'name', slug: 'slug', description: 'description', season: 'season', coverUrl: 'cover_url', coverAlt: 'cover_alt', status: 'status', isFeatured: 'is_featured', position: 'position', seoTitle: 'seo_title', seoDescription: 'seo_description' },
    unique: ['slug'], search: ['name', 'slug'], filters: { status: 'status' }, orderBy: 'status, position, id DESC',
    relations: [{ key: 'productIds', table: 'collection_products', fk: 'collection_id', otherFk: 'product_id', check: 'products' }],
    afterSave: (id, d) => {
      getDb().run("UPDATE collections SET archived_at = CASE WHEN status = 'archived' THEN COALESCE(archived_at, ?) ELSE NULL END WHERE id = ?", nowIso(), id);
      void d;
    },
  });

  // ---------- Lookbooks ----------
  registerResource(r, {
    name: 'lookbooks', table: 'lookbooks', entity: 'lookbook', read: 'catalog.read', write: 'content.write',
    schema: z.object({
      title: z.string().trim().min(2).max(80), slug, description: z.string().trim().max(1000).default(''), coverUrl: url, collectionId: z.number().int().positive().nullable().optional(),
      status: z.enum(['draft', 'published', 'archived']), position: z.number().int().min(0).max(999).default(0), seoTitle: optText(70), seoDescription: optText(170),
    }),
    columns: { title: 'title', slug: 'slug', description: 'description', coverUrl: 'cover_url', collectionId: 'collection_id', status: 'status', position: 'position', seoTitle: 'seo_title', seoDescription: 'seo_description' },
    unique: ['slug'], search: ['title', 'slug'], filters: { status: 'status' }, orderBy: 'position, id DESC',
    beforeSave: (d, id) => {
      if (d.status === 'published') {
        const lookId = id ?? 0;
        const hasProducts = getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM lookbook_products WHERE lookbook_id = ?', lookId)!.n;
        if (!hasProducts) throw new HttpError(422, 'Para publicar, adicione ao menos uma foto com produto associado.', 'publish_requirements', { missing: ['produtos'] });
      }
    },
    afterSave: (id) => getDb().run("UPDATE lookbooks SET published_at = CASE WHEN status = 'published' THEN COALESCE(published_at, ?) ELSE published_at END WHERE id = ?", nowIso(), id),
  });

  // Composição do lookbook: fotos e pontos interativos (substitui o conjunto inteiro, em transação).
  const compositionSchema = z.object({
    images: z.array(z.object({
      url: z.string().trim().min(1).max(500).refine((v) => v.startsWith('/') || /^https?:\/\//.test(v), 'Imagem inválida.'),
      alt: z.string().trim().max(160).default(''),
      width: z.number().int().positive().nullable().optional(),
      height: z.number().int().positive().nullable().optional(),
      hotspots: z.array(z.object({ productId: z.number().int().positive(), x: z.number().min(0).max(100), y: z.number().min(0).max(100), label: optText(60) })).max(12).default([]),
    })).max(20),
    extraProductIds: z.array(z.number().int().positive()).max(30).default([]),
  });
  r.get('/api/admin/lookbooks/:id/composition', (ctx) => {
    requirePermission(ctx, 'catalog.read');
    const db = getDb();
    const id = intParam(ctx.params.id);
    const images = db.all<{ id: number; url: string; alt: string; width: number | null; height: number | null }>('SELECT * FROM lookbook_images WHERE lookbook_id = ? ORDER BY position, id', id);
    const spots = db.all<{ image_id: number | null; product_id: number; x_pct: number | null; y_pct: number | null; label: string | null }>('SELECT * FROM lookbook_products WHERE lookbook_id = ? ORDER BY position, id', id);
    return {
      images: images.map((im) => ({ url: im.url, alt: im.alt, width: im.width, height: im.height, hotspots: spots.filter((s) => s.image_id === im.id).map((s) => ({ productId: s.product_id, x: s.x_pct, y: s.y_pct, label: s.label })) })),
      extraProductIds: spots.filter((s) => s.image_id === null).map((s) => s.product_id),
    };
  });
  r.put('/api/admin/lookbooks/:id/composition', async (ctx) => {
    const admin = requirePermission(ctx, 'content.write');
    const id = intParam(ctx.params.id);
    const body = await ctx.body(compositionSchema);
    const db = getDb();
    const look = db.get<{ slug: string; status: string }>('SELECT slug, status FROM lookbooks WHERE id = ?', id);
    if (!look) throw new HttpError(404, 'Lookbook não encontrado.', 'not_found');
    const allIds = [...new Set([...body.images.flatMap((i) => i.hotspots.map((h) => h.productId)), ...body.extraProductIds])];
    if (allIds.length) {
      const found = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NULL AND id IN (${allIds.map(() => '?').join(',')})`, ...allIds)!.n;
      if (found !== allIds.length) throw new HttpError(400, 'Há produtos inexistentes no look.', 'bad_product');
    }
    if (look.status === 'published' && !allIds.length) throw new HttpError(422, 'Um lookbook publicado precisa de ao menos um produto.', 'publish_requirements');
    db.tx(() => {
      db.run('DELETE FROM lookbook_products WHERE lookbook_id = ?', id);
      db.run('DELETE FROM lookbook_images WHERE lookbook_id = ?', id);
      let pos = 0;
      body.images.forEach((im, i) => {
        const imageId = db.run('INSERT INTO lookbook_images (lookbook_id, url, alt, width, height, position) VALUES (?, ?, ?, ?, ?, ?)', id, im.url, im.alt, im.width ?? null, im.height ?? null, i).lastInsertRowid;
        for (const h of im.hotspots) db.run('INSERT INTO lookbook_products (lookbook_id, image_id, product_id, x_pct, y_pct, label, position) VALUES (?, ?, ?, ?, ?, ?, ?)', id, imageId, h.productId, h.x, h.y, h.label ?? null, pos++);
      });
      for (const pid of body.extraProductIds) db.run('INSERT INTO lookbook_products (lookbook_id, product_id, position) VALUES (?, ?, ?)', id, pid, pos++);
      db.run('UPDATE lookbooks SET updated_at = ?, cover_url = COALESCE(cover_url, ?) WHERE id = ?', nowIso(), body.images[0]?.url ?? null, id);
      audit({ actor: `admin:${admin.id}`, action: 'lookbook.composition', entity: 'lookbook', entityId: id, data: { images: body.images.length, products: allIds.length }, ip: ctx.ip });
    });
    return lookbookBySlug(look.slug, { includeDraft: true });
  });

  // ---------- Journal ----------
  registerResource(r, {
    name: 'journal', table: 'journal_articles', entity: 'article', read: 'catalog.read', write: 'content.write',
    schema: z.object({
      title: z.string().trim().min(3).max(120), slug, excerpt: z.string().trim().max(300).default(''), body: z.string().trim().max(30_000).default(''),
      coverUrl: url, coverAlt: optText(160), category: z.enum(['estilo', 'combinacoes', 'cuidados', 'lancamentos', 'guias', 'inspiracao']), author: z.string().trim().min(2).max(80),
      status: z.enum(['draft', 'published', 'archived']), publishedAt: isoDate, seoTitle: optText(70), seoDescription: optText(170), productIds: ids,
    }).refine((a) => a.status !== 'published' || a.body.length >= 40, { message: 'Para publicar, escreva o conteúdo do artigo.', path: ['body'] }),
    columns: { title: 'title', slug: 'slug', excerpt: 'excerpt', body: 'body', coverUrl: 'cover_url', coverAlt: 'cover_alt', category: 'category', author: 'author', status: 'status', publishedAt: 'published_at', seoTitle: 'seo_title', seoDescription: 'seo_description' },
    unique: ['slug'], search: ['title', 'slug'], filters: { status: 'status' }, orderBy: 'COALESCE(published_at, created_at) DESC',
    relations: [{ key: 'productIds', table: 'journal_article_products', fk: 'article_id', otherFk: 'product_id', check: 'products' }],
    afterSave: (id) => getDb().run("UPDATE journal_articles SET published_at = CASE WHEN status = 'published' THEN COALESCE(published_at, ?) ELSE published_at END WHERE id = ?", nowIso(), id),
  });

  // ---------- Páginas institucionais (substituem o texto-base quando publicadas) ----------
  registerResource(r, {
    name: 'pages', table: 'pages', entity: 'page', read: 'catalog.read', write: 'content.write',
    schema: z.object({ slug, title: z.string().trim().min(2).max(120), body: z.string().trim().max(50_000), status: z.enum(['draft', 'published']), seoDescription: optText(170) }),
    columns: { slug: 'slug', title: 'title', body: 'body', status: 'status', seoDescription: 'seo_description' },
    unique: ['slug'], search: ['title', 'slug'], orderBy: 'slug',
  });

  // ---------- Perguntas frequentes ----------
  registerResource(r, {
    name: 'faq', table: 'faq_items', entity: 'faq', read: 'catalog.read', write: 'content.write',
    schema: z.object({
      category: z.enum(['geral', 'pedidos', 'pagamento', 'entrega', 'trocas', 'produtos', 'conta', 'privacidade']), question: z.string().trim().min(5).max(200), answer: z.string().trim().min(5).max(4000),
      productId: z.number().int().positive().nullable().optional(), position: z.number().int().min(0).max(999).default(0), isActive: z.boolean(),
    }),
    columns: { category: 'category', question: 'question', answer: 'answer', productId: 'product_id', position: 'position', isActive: 'is_active' },
    search: ['question'], filters: { categoria: 'category' }, orderBy: 'category, position, id',
  });

  // ---------- Guias de medidas ----------
  registerResource(r, {
    name: 'size-guides', table: 'size_guides', entity: 'size_guide', read: 'catalog.read', write: 'catalog.write',
    schema: z.object({
      name: z.string().trim().min(2).max(80), head: z.array(z.string().trim().min(1).max(30)).min(2).max(8), rows: z.array(z.array(z.string().trim().max(30))).min(1).max(30), note: optText(400), isDemo: z.boolean().default(false),
    }).refine((g) => g.rows.every((row) => row.length === g.head.length), { message: 'Cada linha precisa ter o mesmo número de colunas do cabeçalho.', path: ['rows'] })
      .transform((g) => ({ ...g, tableJson: JSON.stringify({ head: g.head, rows: g.rows }) })),
    columns: { name: 'name', tableJson: 'table_json', note: 'note', isDemo: 'is_demo' },
    search: ['name'], orderBy: 'name',
    toDTO: (row) => {
      const t = JSON.parse(String(row.table_json)) as { head: string[]; rows: string[][] };
      const n = getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM products WHERE size_guide_id = ? AND deleted_at IS NULL', row.id as number)!.n;
      return { id: row.id, name: row.name, head: t.head, rows: t.rows, note: row.note, isDemo: Boolean(row.is_demo), productCount: n, updatedAt: row.updated_at };
    },
  });

  // ---------- Campanhas (atribuição por UTM) ----------
  registerResource(r, {
    name: 'campaigns', table: 'campaigns', entity: 'campaign', read: 'marketing.read', write: 'marketing.write',
    schema: z.object({
      name: z.string().trim().min(2).max(80), slug, channel: z.enum(['instagram', 'tiktok', 'facebook', 'google', 'email', 'whatsapp', 'influenciador', 'evento', 'outro']),
      utmSource: optText(60), utmMedium: optText(60), utmCampaign: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]+$/, 'Use letras minúsculas, números, _ ou -.').max(80),
      couponId: z.number().int().positive().nullable().optional(), landingPath: z.string().trim().max(200).refine((v) => v.startsWith('/'), 'Use um caminho iniciando com /.'),
      startsAt: isoDate, endsAt: isoDate, status: z.enum(['draft', 'active', 'ended']), notes: optText(1000),
    }).refine(windowCheck, { message: 'O fim deve ser posterior ao início.', path: ['endsAt'] }),
    columns: { name: 'name', slug: 'slug', channel: 'channel', utmSource: 'utm_source', utmMedium: 'utm_medium', utmCampaign: 'utm_campaign', couponId: 'coupon_id', landingPath: 'landing_path', startsAt: 'starts_at', endsAt: 'ends_at', status: 'status', notes: 'notes' },
    unique: ['slug', 'utmCampaign'], search: ['name', 'utm_campaign'], filters: { status: 'status' }, orderBy: 'id DESC',
  });

  // ---------- Despesas operacionais ----------
  registerResource(r, {
    name: 'expenses', table: 'expenses', entity: 'expense', read: 'finance.read', write: 'finance.write', softDelete: true,
    schema: z.object({
      category: z.enum(['marketing', 'embalagem', 'frete', 'plataforma', 'taxas', 'pessoal', 'aluguel', 'impostos', 'fornecedores', 'outros']),
      description: z.string().trim().min(2).max(200), amountCents: z.number().int().positive().max(1_000_000_00),
      incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).'), campaignId: z.number().int().positive().nullable().optional(), orderId: z.number().int().positive().nullable().optional(),
    }),
    columns: { category: 'category', description: 'description', amountCents: 'amount_cents', incurredOn: 'incurred_on', campaignId: 'campaign_id', orderId: 'order_id', createdBy: 'created_by' },
    search: ['description'], filters: { categoria: 'category' }, orderBy: 'incurred_on DESC, id DESC', pageSize: 100,
    beforeSave: (d, id, ctx) => { if (!id) d.createdBy = ctx.user?.id ?? null; },
  });
}
