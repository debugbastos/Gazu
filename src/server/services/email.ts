import { env, isProd } from '../config.ts';
import { getDb, nowIso } from '../db.ts';

/**
 * Envio de e-mails transacionais.
 * - EMAIL_PROVIDER=console (padrão em desenvolvimento): o e-mail é registrado na tabela email_outbox (status "logged")
 *   e impresso no terminal — NADA é enviado de verdade.
 * - EMAIL_PROVIDER=resend: envia pela API HTTP da Resend (requer RESEND_API_KEY e domínio verificado).
 */
export type EmailStatus = 'sent' | 'logged' | 'failed';

export async function sendEmail(to: string, subject: string, text: string, opts: { html?: string; event?: string } = {}): Promise<{ id: number; status: EmailStatus }> {
  const db = getDb();
  const { lastInsertRowid: id } = db.run('INSERT INTO email_outbox (to_email, subject, body_text, body_html, event) VALUES (?, ?, ?, ?, ?)', to, subject, text, opts.html ?? null, opts.event ?? null);
  if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
    return deliver(id);
  }
  db.run("UPDATE email_outbox SET status = 'logged' WHERE id = ?", id);
  if (!isProd && env.NODE_ENV !== 'test') {
    console.log(`\n[e-mail de desenvolvimento] Para: ${to}\nAssunto: ${subject}\n${text}\n`);
  }
  return { id, status: 'logged' };
}

/** Tenta (re)enviar um e-mail da fila pela Resend. Usado no envio e na rotina de reprocessamento. */
export async function deliver(id: number): Promise<{ id: number; status: EmailStatus }> {
  const db = getDb();
  const m = db.get<{ to_email: string; subject: string; body_text: string; body_html: string | null; attempts: number }>('SELECT * FROM email_outbox WHERE id = ?', id);
  if (!m || !env.RESEND_API_KEY) return { id, status: 'failed' };
  db.run('UPDATE email_outbox SET attempts = attempts + 1 WHERE id = ?', id);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: m.to_email, subject: m.subject, text: m.body_text, ...(m.body_html ? { html: m.body_html } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    db.run('UPDATE email_outbox SET status = ?, error = ? WHERE id = ?', r.ok ? 'sent' : 'failed', r.ok ? null : `HTTP ${r.status}`, id);
    return { id, status: r.ok ? 'sent' : 'failed' };
  } catch (e) {
    db.run('UPDATE email_outbox SET status = ?, error = ? WHERE id = ?', 'failed', String(e).slice(0, 300), id);
    return { id, status: 'failed' };
  }
}

/** Reenvia e-mails que falharam nas últimas 24h (até 3 tentativas). */
export async function retryFailedEmails(): Promise<number> {
  if (env.EMAIL_PROVIDER !== 'resend' || !env.RESEND_API_KEY) return 0;
  const since = new Date(Date.now() - 86400_000).toISOString();
  const rows = getDb().all<{ id: number }>("SELECT id FROM email_outbox WHERE status = 'failed' AND attempts < 3 AND created_at >= ? ORDER BY id LIMIT 20", since);
  let ok = 0;
  for (const r of rows) if ((await deliver(r.id)).status === 'sent') ok++;
  void nowIso;
  return ok;
}
