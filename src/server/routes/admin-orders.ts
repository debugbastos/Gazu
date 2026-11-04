import { z } from 'zod';
import { getDb } from '../db.ts';
import { HttpError, intParam, requirePermission, type Ctx, type Router } from '../http.ts';
import { adminUpdateOrder, getOrder, orderIdByNumber } from '../services/orders.ts';
import { cancelPendingProviderPayments, processMercadoPagoNotification, requestRefund, syncMercadoPagoPayment } from '../services/payments/index.ts';
import { adminUpdateReturn, getReturn, listReturns } from '../services/returns.ts';
import { buyMelhorEnvioLabel, createShipment, senderMissing, syncMelhorEnvioTracking, updateShipment } from '../services/shipments.ts';
import { audit } from '../services/audit.ts';
import { getSettings } from '../services/settings.ts';
import { formatPrice } from '../../shared/format.ts';

const actorOf = (ctx: Ctx) => `admin:${ctx.user!.id}`;
const orderId = (number: string): number => {
  const id = orderIdByNumber(number);
  if (!id) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
  return id;
};
const SHIP_STATUSES = ['pending', 'preparing', 'label_purchased', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returned', 'cancelled'] as const;
const shipmentSchema = z.object({
  status: z.enum(SHIP_STATUSES).optional(),
  carrier: z.string().trim().max(60).optional().nullable(),
  service: z.string().trim().max(80).optional().nullable(),
  trackingCode: z.string().trim().max(60).optional().nullable(),
  trackingUrl: z.string().trim().url().max(300).optional().nullable().or(z.literal('')),
  costCents: z.number().int().min(0).max(10_000_00).optional().nullable(),
  description: z.string().trim().max(300).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function registerAdminOrderRoutes(r: Router): void {
  // Operação do pedido: etapas operacionais e rastreio. Pagamento NUNCA é marcado manualmente.
  r.patch('/api/admin/orders/:number', async (ctx) => {
    const u = requirePermission(ctx, 'orders.write');
    const body = await ctx.body(z.object({
      status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']).optional(),
      trackingCode: z.string().trim().max(60).optional().nullable(),
      trackingUrl: z.string().trim().url().max(300).optional().nullable().or(z.literal('')),
      carrier: z.string().trim().max(60).optional().nullable(),
      note: z.string().trim().max(500).optional(),
    }));
    const id = orderId(ctx.params.number!);
    const out = adminUpdateOrder(id, u.id, { ...body, trackingUrl: body.trackingUrl || null });
    if (body.status === 'cancelled') await cancelPendingProviderPayments(id);
    return out;
  });

  // Observações internas: visíveis somente para a equipe (nunca retornadas nas rotas do cliente).
  r.post('/api/admin/orders/:number/notes', async (ctx) => {
    const u = requirePermission(ctx, 'orders.write');
    const { body } = await ctx.body(z.object({ body: z.string().trim().min(1).max(2000) }));
    const id = orderId(ctx.params.number!);
    getDb().run('INSERT INTO order_notes (order_id, author_id, body) VALUES (?, ?, ?)', id, u.id, body);
    audit({ actor: actorOf(ctx), action: 'order.note', entity: 'order', entityId: id, ip: ctx.ip });
    return getOrder(id, { withCustomer: true, admin: true });
  });

  // ---- Envios ----
  r.post('/api/admin/orders/:number/shipments', async (ctx) => {
    requirePermission(ctx, 'orders.write');
    const b = await ctx.body(shipmentSchema);
    const id = orderId(ctx.params.number!);
    const sid = createShipment(id, actorOf(ctx), { ...b, trackingUrl: b.trackingUrl || null });
    if (b.status && b.status !== 'pending') updateShipment(sid, actorOf(ctx), { status: b.status, trackingCode: b.trackingCode, trackingUrl: b.trackingUrl || null });
    return getOrder(id, { withCustomer: true, admin: true });
  });
  r.patch('/api/admin/shipments/:id', async (ctx) => {
    requirePermission(ctx, 'orders.write');
    const b = await ctx.body(shipmentSchema);
    const sid = intParam(ctx.params.id);
    const s = getDb().get<{ order_id: number }>('SELECT order_id FROM shipments WHERE id = ?', sid);
    if (!s) throw new HttpError(404, 'Envio não encontrado.', 'not_found');
    updateShipment(sid, actorOf(ctx), { ...b, trackingUrl: b.trackingUrl || null });
    return getOrder(s.order_id, { withCustomer: true, admin: true });
  });
  r.post('/api/admin/orders/:number/label', async (ctx) => {
    requirePermission(ctx, 'orders.write');
    const id = orderId(ctx.params.number!);
    await buyMelhorEnvioLabel(id, actorOf(ctx));
    return getOrder(id, { withCustomer: true, admin: true });
  });
  r.get('/api/admin/shipping/status', (ctx) => {
    requirePermission(ctx, 'orders.read');
    return { senderMissing: senderMissing() };
  });
  r.post('/api/admin/shipments/sync', async (ctx) => {
    requirePermission(ctx, 'orders.write');
    return syncMelhorEnvioTracking();
  });
  r.get('/api/admin/shipments', (ctx) => {
    requirePermission(ctx, 'orders.read');
    const status = ctx.url.searchParams.get('status');
    return {
      shipments: getDb().all(
        `SELECT s.id, s.status, s.provider, s.carrier, s.service, s.tracking_code AS trackingCode, s.tracking_url AS trackingUrl, s.label_url AS labelUrl, s.cost_cents AS costCents,
                s.shipped_at AS shippedAt, s.delivered_at AS deliveredAt, s.updated_at AS updatedAt, o.number AS orderNumber, o.ship_city AS city, o.ship_state AS state, o.is_demo AS isDemo
           FROM shipments s JOIN orders o ON o.id = s.order_id WHERE (? IS NULL OR s.status = ?) ORDER BY s.updated_at DESC LIMIT 200`, status, status,
      ),
    };
  });

  // ---- Pagamentos e estornos (sempre pelo provedor) ----
  r.post('/api/admin/orders/:number/refunds', async (ctx) => {
    requirePermission(ctx, 'payments.refund');
    const b = await ctx.body(z.object({ amountCents: z.number().int().positive().optional().nullable(), reason: z.string().trim().min(3).max(300) }));
    return requestRefund({ orderId: orderId(ctx.params.number!), amountCents: b.amountCents ?? null, reason: b.reason, actor: actorOf(ctx), ip: ctx.ip });
  });
  r.post('/api/admin/payments/:id/sync', async (ctx) => {
    requirePermission(ctx, 'orders.read');
    const id = intParam(ctx.params.id);
    const pay = getDb().get<{ order_id: number }>('SELECT order_id FROM payments WHERE id = ?', id);
    if (!pay) throw new HttpError(404, 'Pagamento não encontrado.', 'not_found');
    const result = await syncMercadoPagoPayment(id);
    audit({ actor: actorOf(ctx), action: 'payment.sync', entity: 'payment', entityId: id, data: { result }, ip: ctx.ip });
    return { result, order: getOrder(pay.order_id, { withCustomer: true, admin: true }) };
  });
  r.get('/api/admin/payment-events', (ctx) => {
    requirePermission(ctx, 'ops.read');
    const result = ctx.url.searchParams.get('result');
    return {
      events: getDb().all(
        `SELECT e.id, e.provider, e.event_key AS eventKey, e.provider_payment_id AS providerPaymentId, e.type, e.status, e.signature_valid AS signatureValid, e.result, e.detail,
                e.attempts, e.received_at AS receivedAt, e.processed_at AS processedAt, o.number AS orderNumber
           FROM payment_events e LEFT JOIN payments p ON p.id = e.payment_id LEFT JOIN orders o ON o.id = p.order_id
          WHERE (? IS NULL OR e.result = ?) ORDER BY e.id DESC LIMIT 200`, result, result,
      ),
    };
  });
  // Reprocessa uma notificação autenticada: consulta o pagamento na API do provedor de novo.
  r.post('/api/admin/payment-events/:id/reprocess', async (ctx) => {
    requirePermission(ctx, 'ops.write');
    const ev = getDb().get<{ id: number; provider: string; provider_payment_id: string | null; signature_valid: number }>('SELECT * FROM payment_events WHERE id = ?', intParam(ctx.params.id));
    if (!ev) throw new HttpError(404, 'Evento não encontrado.', 'not_found');
    if (ev.provider !== 'mercadopago' || !ev.provider_payment_id || !ev.signature_valid) throw new HttpError(409, 'Somente notificações autenticadas do Mercado Pago podem ser reprocessadas.', 'not_reprocessable');
    const out = await processMercadoPagoNotification(ev.provider_payment_id);
    getDb().run("UPDATE payment_events SET result = ?, detail = ?, attempts = attempts + 1, processed_at = ?, payment_id = ?, status = ? WHERE id = ?",
      out.result === 'unknown_order' ? 'ignored' : 'processed', `reprocessado manualmente: ${out.result}`, new Date().toISOString(), out.paymentId, out.status, ev.id);
    audit({ actor: actorOf(ctx), action: 'payment_event.reprocess', entity: 'payment_event', entityId: ev.id, data: { result: out.result }, ip: ctx.ip });
    return out;
  });

  // ---- Trocas e devoluções ----
  r.get('/api/admin/returns', (ctx) => {
    requirePermission(ctx, 'orders.read');
    return { returns: listReturns({ status: ctx.url.searchParams.get('status') ?? undefined }) };
  });
  r.get('/api/admin/returns/:id', (ctx) => {
    requirePermission(ctx, 'orders.read');
    const ret = getReturn(intParam(ctx.params.id), { admin: true });
    if (!ret) throw new HttpError(404, 'Solicitação não encontrada.', 'not_found');
    return ret;
  });
  r.patch('/api/admin/returns/:id', async (ctx) => {
    requirePermission(ctx, 'orders.write');
    const b = await ctx.body(z.object({
      status: z.enum(['approved', 'rejected', 'awaiting_item', 'received', 'exchanged', 'closed']).optional(),
      message: z.string().trim().max(2000).optional(), internal: z.boolean().optional(), restock: z.boolean().optional(), resolution: z.string().trim().max(500).optional().nullable(),
    }));
    return adminUpdateReturn(intParam(ctx.params.id), actorOf(ctx), b, ctx.ip);
  });
  r.post('/api/admin/returns/:id/refund', async (ctx) => {
    requirePermission(ctx, 'payments.refund');
    const b = await ctx.body(z.object({ amountCents: z.number().int().positive(), reason: z.string().trim().min(3).max(300) }));
    const ret = getDb().get<{ id: number; order_id: number; status: string; number: string }>('SELECT * FROM return_requests WHERE id = ?', intParam(ctx.params.id));
    if (!ret) throw new HttpError(404, 'Solicitação não encontrada.', 'not_found');
    if (!['received', 'approved'].includes(ret.status)) throw new HttpError(409, 'O estorno da devolução é feito após aprovar (defeito) ou receber o produto.', 'invalid_status');
    await requestRefund({ orderId: ret.order_id, amountCents: b.amountCents, reason: `${ret.number}: ${b.reason}`, actor: actorOf(ctx), returnId: ret.id, ip: ctx.ip });
    return getReturn(ret.id, { admin: true });
  });

  // ---- Romaneio (documento de separação/embalagem para impressão) ----
  r.get('/api/admin/orders/:number/packing-slip', (ctx) => {
    requirePermission(ctx, 'orders.read');
    const o = getOrder(orderId(ctx.params.number!), { withCustomer: true, admin: true })!;
    const s = getSettings();
    const rows = o.items.map((i) => `<tr><td>${esc(i.sku)}</td><td>${esc(i.productName)}</td><td>${esc(i.colorName)}</td><td>${esc(i.size)}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:center">☐</td></tr>`).join('');
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Romaneio ${esc(o.number)}</title>
<style>body{font-family:Inter,Helvetica,Arial,sans-serif;color:#111;margin:32px;font-size:13px}h1{font-size:28px;letter-spacing:.08em;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border-bottom:1px solid #d6d5d0;padding:8px 6px;text-align:left}th{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6b6b6b}.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:12px}
.box{border:1px solid #111;padding:12px;margin-top:16px}.muted{color:#6b6b6b}.demo{background:#111;color:#fff;padding:6px 10px;display:inline-block;margin-top:8px}@media print{body{margin:12mm}}</style></head>
<body><div class="top"><div><h1>GAZU</h1><div class="muted">Romaneio de separação e embalagem</div></div><div style="text-align:right"><strong>Pedido ${esc(o.number)}</strong><br>${new Date(o.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div></div>
${o.isDemo ? '<div class="demo">PEDIDO DE DEMONSTRAÇÃO — NÃO ENVIAR</div>' : ''}
<div class="box"><strong>Destinatário</strong><br>${esc(o.address.recipient)}<br>${esc(o.address.street)}, ${esc(o.address.number)}${o.address.complement ? ` — ${esc(o.address.complement)}` : ''}<br>${esc(o.address.district)} — ${esc(o.address.city)}/${esc(o.address.state)} — CEP ${esc(o.address.cep)}</div>
<table><thead><tr><th>SKU</th><th>Produto</th><th>Cor</th><th>Tamanho</th><th>Qtd.</th><th>Conferido</th></tr></thead><tbody>${rows}</tbody></table>
<p><strong>Entrega:</strong> ${esc(o.shippingLabel)} · <strong>Total do pedido:</strong> ${formatPrice(o.totalCents)}</p>
<div class="box"><strong>Checklist de embalagem</strong><br>☐ Peças conferidas (SKU, cor e tamanho) ☐ Etiquetas/tags preservadas ☐ Cartão de agradecimento ☐ Instruções de troca ☐ Embalagem lacrada</div>
<p class="muted">${esc([s.company.legalName, s.company.cnpj ? `CNPJ ${s.company.cnpj}` : ''].filter(Boolean).join(' — ') || 'Dados da empresa: preencher em Configurações.')}</p>
<script>window.print && setTimeout(function(){window.print()},300)</script></body></html>`;
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8');
    ctx.res.setHeader('Cache-Control', 'no-store');
    ctx.res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
    ctx.res.end(html);
  });
}
