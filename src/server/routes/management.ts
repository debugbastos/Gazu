import { z } from 'zod';
import { getDb, nowIso } from '../db.ts';
import { HttpError, intParam, requirePermission, sendJson, type Ctx, type Router } from '../http.ts';
import { destroyAllSessions } from '../auth/sessions.ts';
import { isStaffRole, permissionsFor, ROLE_LABEL, ROLE_PERMISSIONS, STAFF_ROLES } from '../auth/permissions.ts';
import { financeCsv, financeSummary, parsePeriod, productMargins, categorySales, financialMovements } from '../services/finance.ts';
import { analyticsReport } from '../services/analytics.ts';
import { adminReviews, moderateReview, notifyRestock } from '../services/engagement.ts';
import { anonymizeUser, exportUserData } from '../services/privacy.ts';
import { consistencyChecks, healthReport } from '../services/monitoring.ts';
import { listBackups, runBackup, verifyBackup } from '../services/backup.ts';
import { JOBS, runJobNow } from '../services/jobs.ts';
import { audit } from '../services/audit.ts';
import { deliver } from '../services/email.ts';
import { renderBrandEmail } from '../services/notifications.ts';

const actorOf = (ctx: Ctx) => `admin:${ctx.user!.id}`;
const sp = (ctx: Ctx, k: string) => ctx.url.searchParams.get(k);

export function registerManagementRoutes(r: Router): void {
  // ---------- Saúde (público: apenas o essencial; detalhes só no painel) ----------
  r.get('/api/health', (ctx) => {
    const h = healthReport();
    if (h.status !== 'ok') ctx.res.statusCode = 503;
    return { status: h.status, checkedAt: h.checkedAt };
  });

  // ---------- Financeiro ----------
  r.get('/api/admin/finance/summary', (ctx) => {
    requirePermission(ctx, 'finance.read');
    return financeSummary(sp(ctx, 'de'), sp(ctx, 'ate'));
  });
  r.get('/api/admin/finance/products', (ctx) => {
    requirePermission(ctx, 'finance.read');
    return { products: productMargins(sp(ctx, 'de'), sp(ctx, 'ate')) };
  });
  r.get('/api/admin/finance/categories', (ctx) => {
    requirePermission(ctx, 'finance.read');
    return { categories: categorySales(sp(ctx, 'de'), sp(ctx, 'ate')) };
  });
  r.get('/api/admin/finance/movements', (ctx) => {
    requirePermission(ctx, 'finance.read');
    return { movements: financialMovements(sp(ctx, 'de'), sp(ctx, 'ate')) };
  });
  r.get('/api/admin/finance/export.csv', (ctx) => {
    requirePermission(ctx, 'finance.read');
    const p = parsePeriod(sp(ctx, 'de'), sp(ctx, 'ate'));
    audit({ actor: actorOf(ctx), action: 'finance.export', entity: 'finance', entityId: `${p.from}..${p.to}`, ip: ctx.ip });
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="gazu-financeiro-${p.from}-a-${p.to}.csv"`);
    ctx.res.setHeader('Cache-Control', 'no-store');
    ctx.res.end(financeCsv(p.from, p.to));
  });

  // ---------- Analytics ----------
  r.get('/api/admin/analytics', (ctx) => {
    requirePermission(ctx, 'analytics.read');
    return analyticsReport(sp(ctx, 'de'), sp(ctx, 'ate'));
  });

  // ---------- Marketing ----------
  r.get('/api/admin/marketing/campaigns-report', (ctx) => {
    requirePermission(ctx, 'marketing.read');
    const db = getDb();
    return {
      campaigns: db.all<Record<string, unknown>>('SELECT * FROM campaigns ORDER BY id DESC').map((c) => {
        const spend = db.get<{ n: number }>('SELECT COALESCE(SUM(amount_cents), 0) AS n FROM expenses WHERE campaign_id = ? AND deleted_at IS NULL', c.id as number)!.n;
        const sales = db.get<{ orders: number; revenue: number }>(
          `SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(pay.amount_cents), 0) AS revenue FROM orders o JOIN payments pay ON pay.order_id = o.id
            WHERE o.campaign_id = ? AND pay.status IN ('approved','partially_refunded','refunded') AND o.is_demo = 0 AND pay.provider <> 'demo'`, c.id as number,
        )!;
        const coupon = c.coupon_id ? db.get<{ code: string; uses: number }>("SELECT c.code, (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'confirmed') AS uses FROM coupons c WHERE c.id = ?", c.coupon_id as number) : null;
        return {
          id: c.id, name: c.name, status: c.status, channel: c.channel, utmCampaign: c.utm_campaign, startsAt: c.starts_at, endsAt: c.ends_at,
          spendCents: spend, orders: sales.orders, revenueCents: sales.revenue, coupon,
          // ROAS só é calculado com gasto registrado (despesas vinculadas à campanha).
          roas: spend > 0 ? Math.round((sales.revenue / spend) * 100) / 100 : null,
        };
      }),
    };
  });
  r.get('/api/admin/marketing/newsletter', (ctx) => {
    requirePermission(ctx, 'marketing.read');
    const db = getDb();
    return {
      counts: db.all('SELECT status, COUNT(*) AS n FROM newsletter_subscribers GROUP BY status'),
      subscribers: db.all('SELECT id, email, name, status, source, created_at AS createdAt, confirmed_at AS confirmedAt, unsubscribed_at AS unsubscribedAt FROM newsletter_subscribers ORDER BY id DESC LIMIT 500'),
    };
  });
  r.get('/api/admin/marketing/newsletter.csv', (ctx) => {
    requirePermission(ctx, 'marketing.write');
    const rows = getDb().all<{ email: string; name: string | null; confirmed_at: string }>("SELECT email, name, confirmed_at FROM newsletter_subscribers WHERE status = 'confirmed' ORDER BY id");
    audit({ actor: actorOf(ctx), action: 'newsletter.export', entity: 'newsletter', entityId: String(rows.length), ip: ctx.ip });
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', 'attachment; filename="gazu-newsletter-confirmados.csv"');
    ctx.res.end('﻿email;nome;confirmado_em\r\n' + rows.map((r) => [r.email, (r.name ?? '').replace(/[;\r\n]/g, ' ').replace(/^[=+\-@]/, "'"), r.confirmed_at].join(';')).join('\r\n'));
  });
  r.get('/api/admin/marketing/abandoned-carts', (ctx) => {
    requirePermission(ctx, 'marketing.read');
    return {
      carts: getDb().all(
        `SELECT c.id, c.updated_at AS updatedAt, c.reminder_sent_at AS reminderSentAt, u.marketing_opt_in AS optIn,
                (SELECT COUNT(*) FROM cart_items ci WHERE ci.cart_id = c.id) AS items,
                (SELECT SUM(ci.quantity * COALESCE(v.price_cents, p.price_cents)) FROM cart_items ci JOIN product_variants v ON v.id = ci.variant_id JOIN products p ON p.id = v.product_id WHERE ci.cart_id = c.id) AS valueCents
           FROM carts c JOIN users u ON u.id = c.user_id WHERE EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id) AND c.updated_at < ?
          ORDER BY c.updated_at DESC LIMIT 200`, new Date(Date.now() - 3600_000).toISOString(),
      ),
    };
  });

  // ---------- Avaliações ----------
  r.get('/api/admin/reviews', (ctx) => {
    requirePermission(ctx, 'catalog.read');
    return { reviews: adminReviews(sp(ctx, 'status') ?? undefined) };
  });
  r.post('/api/admin/reviews/:id/moderate', async (ctx) => {
    requirePermission(ctx, 'content.write');
    const b = await ctx.body(z.object({ action: z.enum(['approved', 'rejected', 'pending']), note: z.string().trim().max(300).optional().nullable() }));
    moderateReview(intParam(ctx.params.id), b.action, actorOf(ctx), b.note ?? null, ctx.ip);
    return { reviews: adminReviews() };
  });

  // ---------- Lista de espera ----------
  r.get('/api/admin/waitlist', (ctx) => {
    requirePermission(ctx, 'catalog.read');
    return {
      items: getDb().all(
        `SELECT v.id AS variantId, v.sku, v.color_name AS colorName, v.size, v.stock, p.id AS productId, p.name,
                SUM(s.notified_at IS NULL AND s.cancelled_at IS NULL) AS waiting, SUM(s.notified_at IS NOT NULL) AS notified, MAX(s.created_at) AS lastAt
           FROM stock_alerts s JOIN product_variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id
          GROUP BY v.id ORDER BY waiting DESC, lastAt DESC LIMIT 300`,
      ),
    };
  });
  r.post('/api/admin/waitlist/:variantId/notify', async (ctx) => {
    requirePermission(ctx, 'catalog.write');
    const n = await notifyRestock(intParam(ctx.params.variantId));
    audit({ actor: actorOf(ctx), action: 'waitlist.notify', entity: 'variant', entityId: ctx.params.variantId, data: { notified: n }, ip: ctx.ip });
    return { notified: n };
  });

  // ---------- Equipe e permissões (somente proprietário) ----------
  r.get('/api/admin/team', (ctx) => {
    requirePermission(ctx, 'team.manage');
    return {
      roles: STAFF_ROLES.map((role) => ({ role, label: ROLE_LABEL[role], permissions: ROLE_PERMISSIONS[role] })),
      members: getDb().all(
        `SELECT u.id, u.email, u.staff_role AS staffRole, COALESCE(NULLIF(p.full_name, ''), u.email) AS name, u.created_at AS createdAt,
                (SELECT MAX(created_at) FROM sessions s WHERE s.user_id = u.id) AS lastSessionAt
           FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.role = 'admin' ORDER BY u.created_at`,
      ),
    };
  });
  r.post('/api/admin/team', async (ctx) => {
    requirePermission(ctx, 'team.manage');
    const b = await ctx.body(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(STAFF_ROLES) }));
    const db = getDb();
    const u = db.get<{ id: string; role: string; is_guest: number; anonymized_at: string | null; password_hash: string | null; google_sub: string | null }>('SELECT * FROM users WHERE email = ?', b.email);
    // A pessoa cria a própria conta (com senha própria); a loja nunca define senhas de terceiros.
    if (!u || u.is_guest || u.anonymized_at || (!u.password_hash && !u.google_sub)) throw new HttpError(404, 'A pessoa precisa criar uma conta no site com este e-mail antes de entrar para a equipe.', 'user_not_found');
    if (u.role === 'admin') throw new HttpError(409, 'Esta pessoa já faz parte da equipe.', 'already_staff');
    db.run("UPDATE users SET role = 'admin', staff_role = ?, updated_at = ? WHERE id = ?", b.role, nowIso(), u.id);
    destroyAllSessions(u.id); // novo login carrega as permissões
    audit({ actor: actorOf(ctx), action: 'team.add', entity: 'user', entityId: u.id, data: { role: b.role }, ip: ctx.ip });
    return { ok: true };
  });
  r.patch('/api/admin/team/:id', async (ctx) => {
    requirePermission(ctx, 'team.manage');
    const b = await ctx.body(z.object({ role: z.enum(STAFF_ROLES) }));
    const id = ctx.params.id!;
    if (id === ctx.user!.id) throw new HttpError(409, 'Você não pode alterar a própria função.', 'self_change');
    const db = getDb();
    const target = db.get<{ staff_role: string | null; role: string }>('SELECT staff_role, role FROM users WHERE id = ?', id);
    if (!target || target.role !== 'admin') throw new HttpError(404, 'Membro não encontrado.', 'not_found');
    if (target.staff_role === 'owner' && b.role !== 'owner' && db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND staff_role = 'owner'")!.n <= 1) {
      throw new HttpError(409, 'A loja precisa de pelo menos um proprietário.', 'last_owner');
    }
    db.run('UPDATE users SET staff_role = ?, updated_at = ? WHERE id = ?', b.role, nowIso(), id);
    destroyAllSessions(id);
    audit({ actor: actorOf(ctx), action: 'team.role', entity: 'user', entityId: id, data: { from: target.staff_role, to: b.role }, ip: ctx.ip });
    return { ok: true };
  });
  r.delete('/api/admin/team/:id', (ctx) => {
    requirePermission(ctx, 'team.manage');
    const id = ctx.params.id!;
    if (id === ctx.user!.id) throw new HttpError(409, 'Você não pode remover a si mesmo(a).', 'self_change');
    const db = getDb();
    const target = db.get<{ staff_role: string | null; role: string }>('SELECT staff_role, role FROM users WHERE id = ?', id);
    if (!target || target.role !== 'admin') throw new HttpError(404, 'Membro não encontrado.', 'not_found');
    if (target.staff_role === 'owner' && db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND staff_role = 'owner'")!.n <= 1) throw new HttpError(409, 'A loja precisa de pelo menos um proprietário.', 'last_owner');
    db.run("UPDATE users SET role = 'customer', staff_role = NULL, updated_at = ? WHERE id = ?", nowIso(), id);
    destroyAllSessions(id);
    audit({ actor: actorOf(ctx), action: 'team.remove', entity: 'user', entityId: id, data: { role: target.staff_role }, ip: ctx.ip });
    return { ok: true };
  });
  r.get('/api/admin/me/permissions', (ctx) => {
    const u = requirePermission(ctx);
    return { staffRole: u.staffRole, label: u.staffRole && isStaffRole(u.staffRole) ? ROLE_LABEL[u.staffRole] : null, permissions: permissionsFor(u.staffRole) };
  });

  // ---------- Auditoria ----------
  r.get('/api/admin/audit', (ctx) => {
    requirePermission(ctx, 'audit.read');
    const q = (sp(ctx, 'q') ?? '').trim();
    const result = sp(ctx, 'resultado');
    const page = Math.max(1, Number(sp(ctx, 'pagina') ?? 1) || 1);
    return {
      entries: getDb().all(
        `SELECT a.id, a.actor, a.action, a.entity, a.entity_id AS entityId, a.data, a.result, a.ip, a.created_at AS createdAt, u.email AS actorEmail
           FROM audit_log a LEFT JOIN users u ON a.actor = 'admin:' || u.id
          WHERE (? = '' OR a.action LIKE ? OR a.entity LIKE ? OR a.entity_id LIKE ? OR u.email LIKE ?) AND (? IS NULL OR a.result = ?)
          ORDER BY a.id DESC LIMIT 100 OFFSET ?`, q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, result, result, (page - 1) * 100,
      ),
      page,
    };
  });

  // ---------- Operação: saúde, consistência, rotinas, erros, backups, comunicações ----------
  r.get('/api/admin/ops', (ctx) => {
    requirePermission(ctx, 'ops.read');
    const db = getDb();
    return {
      health: healthReport(),
      issues: consistencyChecks(),
      jobs: JOBS.map((j) => ({ name: j.name, description: j.description, everyMinutes: Math.round(j.everyMs / 60_000), last: db.get('SELECT status, started_at AS startedAt, finished_at AS finishedAt, detail FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT 1', j.name) ?? null })),
      errors: db.all('SELECT id, level, source, message, occurrences, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, alerted_at AS alertedAt FROM error_log WHERE resolved_at IS NULL ORDER BY last_seen_at DESC LIMIT 100'),
      backups: listBackups(),
    };
  });
  r.post('/api/admin/ops/jobs/:name/run', async (ctx) => {
    requirePermission(ctx, 'ops.write');
    const result = await runJobNow(ctx.params.name!);
    audit({ actor: actorOf(ctx), action: 'job.run', entity: 'job', entityId: ctx.params.name, ip: ctx.ip });
    return { result };
  });
  r.post('/api/admin/ops/errors/:id/resolve', (ctx) => {
    requirePermission(ctx, 'ops.write');
    getDb().run('UPDATE error_log SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL', nowIso(), intParam(ctx.params.id));
    audit({ actor: actorOf(ctx), action: 'error.resolve', entity: 'error', entityId: ctx.params.id, ip: ctx.ip });
    return { ok: true };
  });
  r.post('/api/admin/ops/backups', (ctx) => {
    requirePermission(ctx, 'ops.write');
    const b = runBackup('manual');
    const check = verifyBackup(b.id);
    audit({ actor: actorOf(ctx), action: 'backup.create', entity: 'backup', entityId: b.id, data: { verified: check.ok }, ip: ctx.ip });
    return { backup: { id: b.id, sizeBytes: b.sizeBytes }, verification: check };
  });
  r.post('/api/admin/ops/backups/:id/verify', (ctx) => {
    requirePermission(ctx, 'ops.write');
    const check = verifyBackup(intParam(ctx.params.id));
    audit({ actor: actorOf(ctx), action: 'backup.verify', entity: 'backup', entityId: ctx.params.id, data: { ok: check.ok }, ip: ctx.ip });
    return check;
  });
  r.get('/api/admin/ops/communications', (ctx) => {
    requirePermission(ctx, 'ops.read');
    const db = getDb();
    return {
      notifications: db.all(`SELECT n.id, n.event, n.channel, n.recipient, n.status, n.detail, n.created_at AS createdAt, o.number AS orderNumber
                               FROM notifications n LEFT JOIN orders o ON o.id = n.order_id ORDER BY n.id DESC LIMIT 200`),
      emails: db.all('SELECT id, to_email AS toEmail, subject, status, error, attempts, event, created_at AS createdAt FROM email_outbox ORDER BY id DESC LIMIT 200'),
    };
  });
  r.post('/api/admin/ops/emails/:id/retry', async (ctx) => {
    requirePermission(ctx, 'ops.write');
    return deliver(intParam(ctx.params.id));
  });
  // Pré-visualização da identidade dos e-mails transacionais (sem envio).
  r.get('/api/admin/email-preview', (ctx) => {
    requirePermission(ctx, 'content.write');
    const { html } = renderBrandEmail({
      subject: 'Pré-visualização', preheader: 'Exemplo de e-mail transacional GAZU', title: 'Pagamento aprovado',
      intro: 'Exemplo: o pagamento do pedido foi confirmado pelo provedor. Vamos preparar o envio.',
      rows: [['1× Produto de exemplo — Preto, M', 'R$ 0,00'], ['Total', 'R$ 0,00']], blocks: ['Este é apenas um modelo visual: nenhum e-mail foi enviado.'],
      cta: { label: 'Acompanhar pedido', href: '#' },
    });
    ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8');
    ctx.res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    ctx.res.end(html);
  });

  // ---------- LGPD: solicitações dos titulares ----------
  r.get('/api/admin/privacy/requests', (ctx) => {
    requirePermission(ctx, 'customers.privacy');
    return { requests: getDb().all('SELECT id, user_id AS userId, email, type, status, note, handled_by AS handledBy, created_at AS createdAt, completed_at AS completedAt FROM data_requests ORDER BY id DESC LIMIT 300') };
  });
  r.patch('/api/admin/privacy/requests/:id', async (ctx) => {
    requirePermission(ctx, 'customers.privacy');
    const b = await ctx.body(z.object({ status: z.enum(['in_review', 'completed', 'rejected']), note: z.string().trim().max(1000).optional().nullable() }));
    getDb().run('UPDATE data_requests SET status = ?, note = COALESCE(?, note), handled_by = ?, completed_at = CASE WHEN ? IN (\'completed\',\'rejected\') THEN ? ELSE completed_at END WHERE id = ?',
      b.status, b.note ?? null, actorOf(ctx), b.status, nowIso(), intParam(ctx.params.id));
    audit({ actor: actorOf(ctx), action: 'privacy.request', entity: 'data_request', entityId: ctx.params.id, data: { status: b.status }, ip: ctx.ip });
    return { ok: true };
  });
  r.get('/api/admin/privacy/users/:id/export', (ctx) => {
    requirePermission(ctx, 'customers.privacy');
    audit({ actor: actorOf(ctx), action: 'privacy.export', entity: 'user', entityId: ctx.params.id, ip: ctx.ip });
    ctx.res.setHeader('Content-Disposition', 'attachment; filename="dados-titular.json"');
    return exportUserData(ctx.params.id!);
  });
  r.post('/api/admin/privacy/users/:id/anonymize', async (ctx) => {
    requirePermission(ctx, 'customers.privacy');
    const b = await ctx.body(z.object({ confirm: z.literal('ANONIMIZAR') }));
    void b;
    const open = getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status IN ('pending_payment','paid','processing','shipped')", ctx.params.id!)!.n;
    if (open) return sendJson(ctx.res, 409, { error: { code: 'open_orders', message: 'Há pedidos em andamento. Conclua-os antes de anonimizar a conta.' } });
    anonymizeUser(ctx.params.id!, actorOf(ctx), ctx.ip);
    return { ok: true };
  });
}
