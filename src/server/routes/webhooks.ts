import { env, isProd } from '../config.ts';
import { getDb } from '../db.ts';
import { sendJson, type Router } from '../http.ts';
import { verifyMpSignature } from '../services/payments/mercadopago.ts';
import { processMercadoPagoNotification } from '../services/payments/index.ts';

/**
 * Webhook do Mercado Pago.
 * 1. Valida a assinatura (x-signature) com MP_WEBHOOK_SECRET — sem assinatura válida, nada é processado.
 * 2. Registra o evento com chave única (idempotência contra notificações repetidas).
 * 3. Consulta o pagamento NA API do provedor (o corpo da notificação não é considerado fonte de verdade).
 * 4. Confere pedido (external_reference) e valor antes de aprovar.
 */
export function registerWebhookRoutes(r: Router): void {
  r.post('/api/webhooks/mercadopago', async (ctx) => {
    const db = getDb();
    let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
    try { body = JSON.parse(ctx.rawBody?.toString('utf8') || '{}'); } catch { /* corpo inválido */ }
    const dataId = ctx.url.searchParams.get('data.id') ?? (body.data?.id !== undefined ? String(body.data.id) : undefined);
    const type = ctx.url.searchParams.get('type') ?? body.type ?? 'unknown';
    const sigHeader = ctx.req.headers['x-signature'] as string | undefined;
    const requestId = ctx.req.headers['x-request-id'] as string | undefined;
    const ts = /ts=(\d+)/.exec(sigHeader ?? '')?.[1] ?? 'no-ts';
    const eventKey = `${type}:${dataId ?? 'none'}:${body.action ?? 'none'}:${ts}`;

    const record = (signatureValid: boolean, result: string, detail: string | null, paymentId: number | null = null, status: string | null = null) =>
      db.run(
        `INSERT INTO payment_events (provider, event_key, provider_payment_id, payment_id, type, status, signature_valid, result, detail)
         VALUES ('mercadopago', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, event_key) DO UPDATE SET result = excluded.result, detail = excluded.detail, payment_id = excluded.payment_id, status = excluded.status`,
        eventKey, dataId ?? null, paymentId, type, status, signatureValid, result, detail,
      );

    if (!env.MP_WEBHOOK_SECRET) {
      if (isProd) console.error('[webhook] MP_WEBHOOK_SECRET não configurado — notificação recusada.');
      return sendJson(ctx.res, 401, { error: { code: 'webhook_not_configured', message: 'Webhook não configurado.' } });
    }
    const valid = verifyMpSignature({ signatureHeader: sigHeader, requestId, dataId, secret: env.MP_WEBHOOK_SECRET });
    if (!valid) {
      try { record(false, 'rejected', 'assinatura inválida'); } catch { /* ignore */ }
      return sendJson(ctx.res, 401, { error: { code: 'invalid_signature', message: 'Assinatura inválida.' } });
    }
    if (type !== 'payment' || !dataId) {
      record(true, 'ignored', `tipo ${type}`);
      return { ok: true, ignored: true };
    }
    const existing = db.get<{ result: string }>("SELECT result FROM payment_events WHERE provider = 'mercadopago' AND event_key = ?", eventKey);
    if (existing && existing.result !== 'error') return { ok: true, duplicate: true };
    record(true, 'received', null);
    try {
      const out = await processMercadoPagoNotification(dataId);
      record(true, out.result === 'unknown_order' ? 'ignored' : out.result === 'amount_mismatch' ? 'rejected' : 'processed', out.result, out.paymentId, out.status);
      return { ok: true };
    } catch (e) {
      record(true, 'error', String((e as Error).message).slice(0, 200));
      // 5xx faz o Mercado Pago reenviar a notificação mais tarde.
      return sendJson(ctx.res, 502, { error: { code: 'provider_unreachable', message: 'Falha temporária.' } });
    }
  });
}
