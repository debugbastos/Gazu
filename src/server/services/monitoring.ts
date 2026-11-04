import crypto from 'node:crypto';
import { env, features, isProd, isTest } from '../config.ts';
import { getDb, nowIso } from '../db.ts';
import { redact } from './audit.ts';

// Monitoramento operacional: registro deduplicado de erros, execução de rotinas com histórico,
// checagens de consistência (pagamentos, estoque, webhooks, e-mails, entregas) e alertas.
// Nada aqui é "simulado": cada indicador consulta os dados reais do banco.

export type Level = 'warn' | 'error' | 'critical';

export function logError(level: Level, source: string, err: unknown, context?: Record<string, unknown>): void {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  const fingerprint = crypto.createHash('sha256').update(`${source}|${message.replace(/\d+/g, '#')}`).digest('hex').slice(0, 32);
  if (!isTest) console.error(`[${level}] ${source}: ${message}`);
  try {
    const db = getDb();
    const ctx = context ? JSON.stringify(redact(context)) : null;
    const r = db.run('UPDATE error_log SET occurrences = occurrences + 1, last_seen_at = ?, context = COALESCE(?, context) WHERE fingerprint = ? AND resolved_at IS NULL', nowIso(), ctx, fingerprint);
    if (!r.changes) db.run('INSERT INTO error_log (level, source, message, context, fingerprint) VALUES (?, ?, ?, ?, ?)', level, source, message, ctx, fingerprint);
    if (level === 'critical') void alertOnce(fingerprint, `[GAZU] Alerta crítico: ${source}`, `${message}\n\nContexto: ${ctx ?? '—'}`);
  } catch (e) {
    if (!isTest) console.error('[monitoramento] falha ao registrar erro', e);
  }
}

/** Envia alerta (e-mail e/ou webhook) no máximo a cada 6 horas por ocorrência. */
export async function alertOnce(fingerprint: string, subject: string, text: string): Promise<'sent' | 'skipped' | 'not_configured'> {
  if (!env.ALERT_EMAIL && !env.ALERT_WEBHOOK_URL) return 'not_configured';
  const db = getDb();
  const row = db.get<{ alerted_at: string | null }>('SELECT alerted_at FROM error_log WHERE fingerprint = ? AND resolved_at IS NULL', fingerprint);
  if (row?.alerted_at && Date.now() - Date.parse(row.alerted_at) < 6 * 3600_000) return 'skipped';
  db.run('UPDATE error_log SET alerted_at = ? WHERE fingerprint = ? AND resolved_at IS NULL', nowIso(), fingerprint);
  if (env.ALERT_EMAIL) {
    const { sendEmail } = await import('./email.ts');
    await sendEmail(env.ALERT_EMAIL, subject, text, { event: 'ops_alert' });
  }
  if (env.ALERT_WEBHOOK_URL) {
    try {
      await fetch(env.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `${subject}\n${text}` }), signal: AbortSignal.timeout(8000) });
    } catch (e) {
      if (!isTest) console.error('[alerta] webhook indisponível', e);
    }
  }
  return 'sent';
}

/** Executa uma rotina registrando início, fim, resultado e falhas (visível em Operação). */
export async function runJob<T>(job: string, fn: () => Promise<T> | T): Promise<T | null> {
  const db = getDb();
  const id = db.run("INSERT INTO job_runs (job, status) VALUES (?, 'running')", job).lastInsertRowid;
  try {
    const result = await fn();
    db.run("UPDATE job_runs SET status = 'ok', finished_at = ?, detail = ? WHERE id = ?", nowIso(), result === undefined ? null : JSON.stringify(result).slice(0, 500), id);
    return result;
  } catch (e) {
    db.run("UPDATE job_runs SET status = 'failed', finished_at = ?, detail = ? WHERE id = ?", nowIso(), String((e as Error).message ?? e).slice(0, 500), id);
    logError('error', `job:${job}`, e);
    return null;
  } finally {
    // Mantém o histórico enxuto (últimas 500 execuções por rotina).
    db.run('DELETE FROM job_runs WHERE job = ? AND id NOT IN (SELECT id FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT 500)', job, job);
  }
}

export interface ConsistencyIssue { key: string; level: Level; title: string; detail: string; count: number; refs: string[] }

/** Verificações de integridade comercial executadas sob demanda e pela rotina de monitoramento. */
export function consistencyChecks(): ConsistencyIssue[] {
  const db = getDb();
  const issues: ConsistencyIssue[] = [];
  const add = (key: string, level: Level, title: string, detail: string, refs: string[]) => { if (refs.length) issues.push({ key, level, title, detail, count: refs.length, refs: refs.slice(0, 20) }); };

  add('paid_without_payment', 'critical', 'Pedido pago sem pagamento aprovado',
    'Pedidos com status de pago/enviado sem nenhum pagamento aprovado ou estornado registrado pelo provedor.',
    db.all<{ number: string }>(`SELECT o.number FROM orders o WHERE o.status IN ('paid','processing','shipped','delivered')
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status IN ('approved','partially_refunded','refunded'))`).map((r) => r.number));
  add('approved_on_cancelled', 'critical', 'Pagamento aprovado em pedido cancelado',
    'O provedor aprovou um pagamento depois do cancelamento. Avalie estorno ou reativação.',
    db.all<{ number: string }>(`SELECT DISTINCT o.number FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.status = 'cancelled' AND p.status = 'approved'`).map((r) => r.number));
  add('stock_mismatch', 'critical', 'Estoque divergente do histórico',
    'O estoque atual da variante não corresponde à soma das movimentações registradas.',
    db.all<{ sku: string }>(`SELECT v.sku FROM product_variants v WHERE v.stock <> COALESCE((SELECT SUM(delta) FROM inventory_movements m WHERE m.variant_id = v.id), 0)`).map((r) => r.sku));
  add('amount_mismatch', 'critical', 'Valor do pagamento diferente do pedido',
    'O provedor informou valor diferente do total do pedido; o pagamento não foi confirmado.',
    db.all<{ number: string }>(`SELECT DISTINCT o.number FROM orders o JOIN payments p ON p.order_id = o.id WHERE p.status_detail = 'amount_mismatch' AND o.status = 'pending_payment'`).map((r) => r.number));
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  add('webhook_errors', 'error', 'Webhooks com erro de processamento',
    'Notificações autenticadas que falharam (ex.: provedor indisponível). São reprocessadas automaticamente.',
    db.all<{ event_key: string }>(`SELECT event_key FROM payment_events WHERE result = 'error' AND received_at < ?`, hourAgo).map((r) => r.event_key));
  add('stale_pending', 'warn', 'Cobranças pendentes vencidas',
    'Pagamentos pendentes com prazo expirado em pedidos ainda abertos (a rotina de expiração deve resolvê-los).',
    db.all<{ number: string }>(`SELECT DISTINCT o.number FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.status = 'pending_payment' AND p.status IN ('pending','in_process') AND p.expires_at IS NOT NULL AND p.expires_at < ?`, hourAgo).map((r) => r.number));
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  add('email_failures', 'error', 'E-mails com falha de envio', 'Mensagens transacionais que o provedor de e-mail recusou nas últimas 24 horas.',
    db.all<{ id: number; to_email: string }>(`SELECT id, to_email FROM email_outbox WHERE status = 'failed' AND created_at >= ?`, dayAgo).map((r) => `#${r.id}`));
  add('refund_pending', 'warn', 'Estornos sem confirmação', 'Estornos solicitados há mais de 24 horas sem confirmação do provedor.',
    db.all<{ id: number }>(`SELECT id FROM refunds WHERE status = 'requested' AND created_at < ?`, dayAgo).map((r) => `#${r.id}`));
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  add('shipment_stale', 'warn', 'Entregas sem atualização', 'Envios marcados como enviados há mais de 30 dias sem confirmação de entrega.',
    db.all<{ number: string }>(`SELECT o.number FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.status IN ('shipped','in_transit','out_for_delivery') AND COALESCE(s.shipped_at, s.created_at) < ?`, monthAgo).map((r) => r.number));
  add('paid_not_shipped', 'warn', 'Pedidos pagos aguardando envio há mais de 3 dias', 'Pedidos pagos sem envio registrado após 3 dias.',
    db.all<{ number: string }>(`SELECT o.number FROM orders o WHERE o.status IN ('paid','processing') AND o.is_demo = 0 AND COALESCE(o.paid_at, o.updated_at) < ?`, new Date(Date.now() - 3 * 86400_000).toISOString()).map((r) => r.number));
  return issues;
}

export function healthReport() {
  const db = getDb();
  let database: 'ok' | 'error' = 'ok';
  let integrity = 'não verificado';
  try {
    db.get('SELECT 1');
    integrity = db.get<{ quick_check: string }>('PRAGMA quick_check')?.quick_check ?? 'desconhecido';
  } catch {
    database = 'error';
  }
  const jobs = db.all<{ job: string; status: string; started_at: string; finished_at: string | null; detail: string | null }>(
    `SELECT j.* FROM job_runs j JOIN (SELECT job, MAX(id) AS id FROM job_runs GROUP BY job) last ON last.id = j.id ORDER BY j.job`,
  );
  const lastBackup = db.get<{ file: string; created_at: string; status: string; verified_at: string | null }>("SELECT * FROM backups WHERE status IN ('ok','verified') ORDER BY id DESC LIMIT 1") ?? null;
  return {
    status: database === 'ok' && integrity === 'ok' ? 'ok' : 'degraded',
    checkedAt: nowIso(),
    environment: env.NODE_ENV,
    database, integrity,
    migrations: db.all<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version').map((m) => m.version),
    integrations: {
      payments: features.mercadoPago ? 'mercadopago' : features.demoPayments ? 'demo (simulado)' : 'não configurado',
      webhookSignature: features.webhookSignature,
      shipping: features.melhorEnvio ? 'melhorenvio' : env.SHIPPING_PROVIDER === 'demo' ? 'demo (simulado)' : 'manual',
      email: features.email ? 'resend' : 'console (não envia)',
      whatsapp: features.whatsappApi ? 'cloud api' : 'link wa.me',
      alerts: env.ALERT_EMAIL || env.ALERT_WEBHOOK_URL ? 'configurado' : 'não configurado',
      googleAuth: features.googleAuth,
    },
    jobs,
    openErrors: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM error_log WHERE resolved_at IS NULL')!.n,
    lastBackup,
    production: isProd,
  };
}
