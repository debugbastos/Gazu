import { env, isProd } from '../config.ts';
import { getDb } from '../db.ts';

/**
 * Envio de e-mails transacionais.
 * - EMAIL_PROVIDER=console (padrão em desenvolvimento): o e-mail é registrado no log e na tabela email_outbox.
 * - EMAIL_PROVIDER=resend: envia pela API HTTP da Resend (requer RESEND_API_KEY e domínio verificado).
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const db = getDb();
  const { lastInsertRowid } = db.run('INSERT INTO email_outbox (to_email, subject, body_text) VALUES (?, ?, ?)', to, subject, text);
  if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }),
      });
      db.run('UPDATE email_outbox SET status = ?, error = ? WHERE id = ?', r.ok ? 'sent' : 'failed', r.ok ? null : `HTTP ${r.status}`, lastInsertRowid);
    } catch (e) {
      db.run('UPDATE email_outbox SET status = ?, error = ? WHERE id = ?', 'failed', String(e).slice(0, 300), lastInsertRowid);
    }
    return;
  }
  db.run("UPDATE email_outbox SET status = 'logged' WHERE id = ?", lastInsertRowid);
  if (!isProd && env.NODE_ENV !== 'test') {
    console.log(`\n[e-mail de desenvolvimento] Para: ${to}\nAssunto: ${subject}\n${text}\n`);
  }
}
