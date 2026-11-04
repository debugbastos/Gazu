import { z } from 'zod';
import { getDb } from '../db.ts';
import { HttpError, intParam, requireUser, type Router } from '../http.ts';
import { rateLimit } from '../security.ts';
import { email as emailSchema } from '../validation.ts';
import { productsByIds, reviewSummary } from '../services/catalog.ts';
import {
  confirmNewsletter, createReview, publicReviews, recentlyViewedIds, reviewEligibility, subscribeNewsletter, subscribeStockAlert, trackViewed, unsubscribeNewsletter, NEWSLETTER_CONSENT_TEXT,
} from '../services/engagement.ts';
import { recordEvents, setAnalyticsConsent } from '../services/analytics.ts';
import { createDataRequest, exportUserData, latestConsent, recordConsent } from '../services/privacy.ts';
import { getSettings } from '../services/settings.ts';

const sessionId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

export function registerEngagementRoutes(r: Router): void {
  // ---- Avaliações verificadas ----
  r.get('/api/products/:id/reviews', (ctx) => {
    const id = intParam(ctx.params.id);
    const page = Math.max(1, Number(ctx.url.searchParams.get('pagina') ?? 1) || 1);
    return {
      enabled: getSettings().reviews.enabled,
      summary: reviewSummary(id),
      reviews: publicReviews(id, 10, (page - 1) * 10),
      eligibility: ctx.user ? reviewEligibility(ctx.user.id, id) : null,
    };
  });
  r.post('/api/products/:id/reviews', async (ctx) => {
    const u = requireUser(ctx);
    rateLimit(`review:${u.id}`, 10, 60 * 60_000);
    const b = await ctx.body(z.object({
      rating: z.number().int().min(1).max(5), title: z.string().trim().max(80).default(''),
      body: z.string().trim().min(10, 'Conte um pouco mais (mínimo de 10 caracteres).').max(2000),
      authorName: z.string().trim().min(2).max(60).optional(),
    }));
    const name = b.authorName ?? (u.name ? `${u.name.split(' ')[0]} ${(u.name.split(' ')[1] ?? '').charAt(0)}.`.trim() : 'Cliente GAZU');
    return createReview(u.id, intParam(ctx.params.id), { rating: b.rating, title: b.title, body: b.body, authorName: name });
  });

  // ---- Lista de espera (avise-me) ----
  r.post('/api/stock-alerts', async (ctx) => {
    rateLimit(`stock-alert:${ctx.ip}`, 20, 60 * 60_000);
    const b = await ctx.body(z.object({ variantId: z.number().int().positive(), email: emailSchema.optional() }));
    const email = ctx.user?.email ?? b.email;
    if (!email) throw new HttpError(400, 'Informe seu e-mail.', 'email_required', { fieldErrors: { email: ['Informe seu e-mail.'] } });
    return subscribeStockAlert(b.variantId, email, ctx.user?.id ?? null);
  });

  // ---- Newsletter (confirmação dupla) ----
  r.get('/api/newsletter/consent-text', () => ({ text: NEWSLETTER_CONSENT_TEXT }));
  r.post('/api/newsletter', async (ctx) => {
    rateLimit(`newsletter:${ctx.ip}`, 8, 60 * 60_000);
    const b = await ctx.body(z.object({
      email: emailSchema, name: z.string().trim().max(80).optional().nullable(), source: z.string().max(40).default('site'),
      consent: z.literal(true, { errorMap: () => ({ message: 'Marque a autorização para receber e-mails.' }) }),
    }));
    return subscribeNewsletter({ email: b.email, name: b.name, userId: ctx.user?.id ?? null, source: b.source, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
  });
  r.post('/api/newsletter/confirm', async (ctx) => {
    rateLimit(`newsletter-confirm:${ctx.ip}`, 30, 60 * 60_000);
    const b = await ctx.body(z.object({ token: z.string().min(10).max(100) }));
    return confirmNewsletter(b.token, ctx.ip);
  });
  r.post('/api/newsletter/unsubscribe', async (ctx) => {
    rateLimit(`newsletter-unsub:${ctx.ip}`, 30, 60 * 60_000);
    const b = await ctx.body(z.object({ token: z.string().min(10).max(100) }));
    return unsubscribeNewsletter(b.token, ctx.ip);
  });

  // ---- Vistos recentemente (sincronizado na conta) ----
  r.get('/api/account/viewed', (ctx) => {
    const ids = recentlyViewedIds(requireUser(ctx).id);
    const cards = productsByIds(ids);
    return { ids, items: ids.map((id) => cards.find((c) => c.id === id)).filter(Boolean) };
  });
  r.post('/api/account/viewed', async (ctx) => {
    const u = requireUser(ctx);
    const b = await ctx.body(z.object({ productIds: z.array(z.number().int().positive()).max(30) }));
    for (const id of [...b.productIds].reverse()) trackViewed(u.id, id);
    return { ids: recentlyViewedIds(u.id) };
  });

  // ---- Consentimento de cookies/analytics e eventos ----
  r.post('/api/consent', async (ctx) => {
    rateLimit(`consent:${ctx.ip}`, 60, 60 * 60_000);
    const b = await ctx.body(z.object({ sessionId, analytics: z.boolean() }));
    setAnalyticsConsent(b.sessionId, b.analytics, ctx.user?.id ?? null, ctx.ip, ctx.req.headers['user-agent']);
    return { ok: true };
  });
  r.post('/api/analytics/events', async (ctx) => {
    rateLimit(`analytics:${ctx.ip}`, 240, 60_000);
    const b = await ctx.body(z.object({
      sessionId,
      events: z.array(z.object({
        event: z.string().max(40), path: z.string().max(300).optional().nullable(), productId: z.number().int().positive().optional().nullable(),
        categorySlug: z.string().max(80).optional().nullable(), searchTerm: z.string().max(120).optional().nullable(), resultsCount: z.number().int().min(0).max(100000).optional().nullable(),
        valueCents: z.number().int().min(0).max(100_000_000).optional().nullable(), props: z.record(z.union([z.string().max(120), z.number(), z.boolean()])).optional().nullable(),
        utmSource: z.string().max(80).optional().nullable(), utmMedium: z.string().max(80).optional().nullable(), utmCampaign: z.string().max(80).optional().nullable(),
        referrerHost: z.string().max(120).optional().nullable(),
      })).max(30),
    }));
    return recordEvents(b.sessionId, ctx.user?.id ?? null, b.events);
  });

  // ---- Privacidade (LGPD) — direitos do titular ----
  r.get('/api/account/privacy', (ctx) => {
    const u = requireUser(ctx);
    const db = getDb();
    return {
      marketingOptIn: Boolean(db.get<{ m: number }>('SELECT marketing_opt_in AS m FROM users WHERE id = ?', u.id)?.m),
      newsletter: db.get<{ status: string }>('SELECT status FROM newsletter_subscribers WHERE email = ?', u.email)?.status ?? null,
      analytics: latestConsent(`user:${u.id}`, 'analytics'),
      requests: db.all('SELECT id, type, status, created_at AS createdAt, completed_at AS completedAt FROM data_requests WHERE user_id = ? ORDER BY id DESC', u.id),
    };
  });
  r.get('/api/account/privacy/export', (ctx) => {
    const u = requireUser(ctx);
    rateLimit(`export:${u.id}`, 5, 60 * 60_000);
    const data = exportUserData(u.id);
    createDataRequest({ userId: u.id, email: u.email, type: 'export' });
    getDb().run("UPDATE data_requests SET status = 'completed', completed_at = ?, handled_by = 'self-service' WHERE user_id = ? AND type = 'export' AND status = 'requested'", new Date().toISOString(), u.id);
    ctx.res.setHeader('Content-Disposition', 'attachment; filename="meus-dados-gazu.json"');
    return data;
  });
  r.post('/api/account/privacy/requests', async (ctx) => {
    const u = requireUser(ctx);
    rateLimit(`privacy-req:${u.id}`, 5, 24 * 60 * 60_000);
    const b = await ctx.body(z.object({ type: z.enum(['deletion', 'correction']), note: z.string().trim().max(1000).optional().nullable() }));
    const id = createDataRequest({ userId: u.id, email: u.email, type: b.type, note: b.note });
    return { id, message: b.type === 'deletion' ? 'Pedido de exclusão registrado. Confirmaremos por e-mail; dados exigidos por lei (fiscais) são mantidos pelo prazo legal.' : 'Pedido de correção registrado.' };
  });
  r.put('/api/account/marketing', async (ctx) => {
    const u = requireUser(ctx);
    const b = await ctx.body(z.object({ optIn: z.boolean() }));
    getDb().run('UPDATE users SET marketing_opt_in = ? WHERE id = ?', b.optIn ? 1 : 0, u.id);
    recordConsent({ subject: `user:${u.id}`, purpose: 'marketing_email', granted: b.optIn, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    if (!b.optIn) getDb().run("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE email = ? AND status <> 'unsubscribed'", new Date().toISOString(), u.email);
    return { optIn: b.optIn };
  });
}
