import { z } from 'zod';
import { env, features } from '../config.ts';
import { getDb } from '../db.ts';
import { HttpError, intParam, requirePermission, requireUser, sendJson, type Router } from '../http.ts';
import { rateLimit } from '../security.ts';
import { email as emailSchema } from '../validation.ts';
import {
  createTicket, customerReply, customerTicketId, getTicket, listTickets, processWhatsAppInbound, sendTicketConfirmation, staffReply, updateTicket, verifyWhatsAppSignature,
} from '../services/support.ts';
import { logError } from '../services/monitoring.ts';

const CATEGORIES = ['produto', 'pedido', 'pagamento', 'entrega', 'troca', 'reembolso', 'defeito', 'contato', 'outro'] as const;

export function registerSupportRoutes(r: Router): void {
  // ---- Cliente ----
  r.post('/api/support/tickets', async (ctx) => {
    rateLimit(`ticket:${ctx.ip}`, 6, 60 * 60_000);
    const b = await ctx.body(z.object({
      name: z.string().trim().min(2, 'Informe seu nome.').max(120), email: emailSchema, phone: z.string().trim().max(30).optional().nullable(),
      category: z.enum(CATEGORIES), subject: z.string().trim().min(3, 'Informe o assunto.').max(140),
      message: z.string().trim().min(10, 'Descreva sua dúvida (mínimo de 10 caracteres).').max(4000),
      orderNumber: z.string().trim().max(20).optional().nullable(), productId: z.number().int().positive().optional().nullable(),
      acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'É necessário concordar com a política de privacidade.' }) }),
    }));
    const t = createTicket({ ...b, email: ctx.user?.email ?? b.email, userId: ctx.user?.id ?? null, channel: 'site' });
    await sendTicketConfirmation(t.id, t.token);
    // O token só volta nesta resposta (para abrir o atendimento agora) e no e-mail — no banco fica apenas o hash.
    return { number: t.number, token: t.token };
  });
  r.get('/api/support/tickets/:number', (ctx) => {
    rateLimit(`ticket-view:${ctx.ip}`, 120, 60 * 60_000);
    const id = customerTicketId(ctx.params.number!, ctx.user?.id ?? null, ctx.url.searchParams.get('acesso'));
    return getTicket(id, { admin: false });
  });
  r.post('/api/support/tickets/:number/messages', async (ctx) => {
    rateLimit(`ticket-reply:${ctx.ip}`, 30, 60 * 60_000);
    const b = await ctx.body(z.object({ body: z.string().trim().min(1).max(4000), token: z.string().max(100).optional().nullable() }));
    const id = customerTicketId(ctx.params.number!, ctx.user?.id ?? null, b.token ?? null);
    customerReply(id, b.body, ctx.user?.id ?? null);
    return getTicket(id, { admin: false });
  });
  r.get('/api/account/tickets', (ctx) => {
    const u = requireUser(ctx);
    return { tickets: getDb().all('SELECT number, subject, status, category, created_at AS createdAt, updated_at AS updatedAt FROM support_tickets WHERE user_id = ? ORDER BY id DESC', u.id) };
  });

  // ---- WhatsApp Business (Cloud API) — webhook oficial ----
  r.get('/api/webhooks/whatsapp', (ctx) => {
    const sp = ctx.url.searchParams;
    if (!env.WHATSAPP_VERIFY_TOKEN || sp.get('hub.mode') !== 'subscribe' || sp.get('hub.verify_token') !== env.WHATSAPP_VERIFY_TOKEN) {
      return sendJson(ctx.res, 403, { error: { code: 'forbidden', message: 'Verificação recusada.' } });
    }
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    ctx.res.end(sp.get('hub.challenge') ?? '');
  });
  r.post('/api/webhooks/whatsapp', (ctx) => {
    if (!features.whatsappWebhook || !env.WHATSAPP_APP_SECRET) return sendJson(ctx.res, 401, { error: { code: 'not_configured', message: 'Webhook não configurado.' } });
    if (!verifyWhatsAppSignature(ctx.rawBody ?? Buffer.alloc(0), ctx.req.headers['x-hub-signature-256'] as string | undefined, env.WHATSAPP_APP_SECRET)) {
      return sendJson(ctx.res, 401, { error: { code: 'invalid_signature', message: 'Assinatura inválida.' } });
    }
    try {
      return processWhatsAppInbound(JSON.parse(ctx.rawBody?.toString('utf8') || '{}'));
    } catch (e) {
      logError('error', 'whatsapp:webhook', e);
      return sendJson(ctx.res, 500, { error: { code: 'error', message: 'Falha ao processar.' } });
    }
  });

  // ---- Painel de atendimento ----
  r.get('/api/admin/support/tickets', (ctx) => {
    requirePermission(ctx, 'support.read');
    const sp = ctx.url.searchParams;
    return {
      tickets: listTickets({ status: sp.get('status'), q: sp.get('q'), channel: sp.get('canal'), mine: sp.get('meus') === '1' ? ctx.user!.id : null }),
      staff: getDb().all("SELECT u.id, COALESCE(NULLIF(p.full_name, ''), u.email) AS name FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.role = 'admin' AND u.staff_role IN ('owner','manager','support')"),
      whatsapp: { api: features.whatsappApi, webhook: features.whatsappWebhook },
    };
  });
  r.get('/api/admin/support/tickets/:id', (ctx) => {
    requirePermission(ctx, 'support.read');
    const t = getTicket(intParam(ctx.params.id), { admin: true });
    if (!t) throw new HttpError(404, 'Atendimento não encontrado.', 'not_found');
    return t;
  });
  r.post('/api/admin/support/tickets/:id/messages', async (ctx) => {
    const u = requirePermission(ctx, 'support.write');
    const b = await ctx.body(z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().default(false) }));
    const id = intParam(ctx.params.id);
    const out = await staffReply(id, u.id, b.body, b.internal, ctx.ip);
    return { ...out, ticket: getTicket(id, { admin: true }) };
  });
  r.patch('/api/admin/support/tickets/:id', async (ctx) => {
    requirePermission(ctx, 'support.write');
    const b = await ctx.body(z.object({
      status: z.enum(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      assigneeId: z.string().max(60).optional().nullable(), category: z.enum(CATEGORIES).optional(),
    }));
    const id = intParam(ctx.params.id);
    updateTicket(id, `admin:${ctx.user!.id}`, b, ctx.ip);
    return getTicket(id, { admin: true });
  });
}
