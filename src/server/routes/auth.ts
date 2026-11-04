import crypto from 'node:crypto';
import { env, features, isProd } from '../config.ts';
import { getDb, nowIso } from '../db.ts';
import { HttpError, redirect, requireUser, setCookie, type Ctx, type Router } from '../http.ts';
import { hashPassword, passwordProblems, verifyPassword } from '../auth/password.ts';
import { createSession, destroyAllSessions, destroySession, SESSION_COOKIE, type SessionUser } from '../auth/sessions.ts';
import { exchangeGoogleCode, googleAuthUrl } from '../auth/google.ts';
import { rateLimit, randomToken, sha256, sign, unsign } from '../security.ts';
import { sendEmail } from '../services/email.ts';
import { renderBrandEmail } from '../services/notifications.ts';
import { recordConsent } from '../services/privacy.ts';
import { changePasswordSchema, forgotSchema, loginSchema, profileSchema, registerSchema, resetSchema } from '../validation.ts';
import type { MeDTO } from '../../shared/types.ts';

const me = (u: SessionUser): MeDTO => ({ id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: u.emailVerified, hasPassword: u.hasPassword, googleLinked: u.googleLinked, staffRole: u.staffRole, permissions: u.permissions });

function issueToken(userId: string, purpose: 'password_reset' | 'email_verification', ttlMinutes: number): string {
  const token = randomToken(32);
  const db = getDb();
  db.run('UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', nowIso(), userId, purpose);
  db.run('INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)', sha256(token), userId, purpose, new Date(Date.now() + ttlMinutes * 60_000).toISOString());
  return token;
}

function consumeToken(token: string, purpose: 'password_reset' | 'email_verification'): string {
  const db = getDb();
  const row = db.get<{ user_id: string; expires_at: string; used_at: string | null }>('SELECT user_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND purpose = ?', sha256(token), purpose);
  if (!row || row.used_at || row.expires_at < nowIso()) throw new HttpError(400, 'Link inválido ou expirado. Solicite um novo.', 'invalid_token');
  db.run('UPDATE auth_tokens SET used_at = ? WHERE token_hash = ?', nowIso(), sha256(token));
  return row.user_id;
}

/** E-mails de conta com a identidade da marca (HTML) + texto puro. O link contém token de uso único e expira. */
async function sendAccountEmail(to: string, subject: string, text: string, c: { title: string; intro: string; cta: { label: string; href: string }; outro: string; event: string }): Promise<void> {
  const { html } = renderBrandEmail({ subject, preheader: c.intro, title: c.title, intro: c.intro, cta: c.cta, outro: c.outro });
  await sendEmail(to, subject, text, { html, event: c.event });
}

async function sendVerification(userId: string, email: string): Promise<void> {
  const token = issueToken(userId, 'email_verification', 60 * 48);
  const link = new URL(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, env.APP_URL).toString();
  await sendAccountEmail(email, 'Confirme seu e-mail — GAZU', `Olá!\n\nConfirme seu e-mail para ativar todos os recursos da sua conta GAZU:\n${link}\n\nSe você não criou esta conta, ignore esta mensagem.`, {
    title: 'Confirme seu e-mail', intro: 'Falta só um passo para ativar todos os recursos da sua conta GAZU.', cta: { label: 'Confirmar e-mail', href: link },
    outro: 'O link vale por 48 horas. Se você não criou esta conta, ignore esta mensagem.', event: 'account_verify',
  });
}

function login(ctx: Ctx, userId: string): void {
  createSession(ctx.res, userId, ctx.ip, ctx.req.headers['user-agent']);
}

const safeReturnTo = (v: string | null | undefined): string => (v && v.startsWith('/') && !v.startsWith('//') && v.length < 300 ? v : '/conta');

export function registerAuthRoutes(r: Router): void {
  r.get('/api/auth/me', (ctx) => ({ user: ctx.user ? me(ctx.user) : null }));

  r.post('/api/auth/register', async (ctx) => {
    rateLimit(`register:${ctx.ip}`, 10, 60 * 60_000);
    const body = await ctx.body(registerSchema);
    const problem = passwordProblems(body.password);
    if (problem) throw new HttpError(400, problem, 'weak_password', { fieldErrors: { password: [problem] } });
    const db = getDb();
    const existing = db.get<{ id: string; is_guest: number }>('SELECT id, is_guest FROM users WHERE email = ?', body.email);
    if (existing?.is_guest) {
      // E-mail usado antes em compra sem cadastro: a conta só é ativada pelo link enviado ao e-mail (prova de posse),
      // evitando que alguém crie uma conta com o e-mail de outra pessoa e veja os pedidos dela.
      const token = issueToken(existing.id, 'password_reset', 60 * 24);
      const link = new URL(`/redefinir-senha?token=${encodeURIComponent(token)}&ativar=1`, env.APP_URL).toString();
      await sendAccountEmail(body.email, 'Ative sua conta GAZU', `Olá!\n\nVocê já comprou na GAZU com este e-mail. Para criar sua senha e ver seus pedidos na conta, use o link (válido por 24 horas):\n${link}\n\nSe não foi você, ignore este e-mail.`, {
        title: 'Ative sua conta', intro: 'Você já comprou na GAZU com este e-mail. Crie sua senha para ver seus pedidos na sua conta.', cta: { label: 'Criar senha', href: link },
        outro: 'O link vale por 24 horas. Se não foi você, ignore este e-mail.', event: 'account_activate',
      });
      return { ok: true, pendingActivation: true, message: 'Enviamos um link para o seu e-mail para ativar a conta com as compras já feitas.' };
    }
    if (existing) {
      throw new HttpError(409, 'Já existe uma conta com este e-mail. Entre ou recupere sua senha.', 'email_taken', { fieldErrors: { email: ['E-mail já cadastrado.'] } });
    }
    const id = crypto.randomUUID();
    const hash = await hashPassword(body.password);
    db.tx(() => {
      db.run('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', id, body.email, hash);
      db.run('INSERT INTO profiles (user_id, full_name) VALUES (?, ?)', id, body.name);
    });
    recordConsent({ subject: `user:${id}`, purpose: 'terms', granted: true, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    recordConsent({ subject: `user:${id}`, purpose: 'privacy', granted: true, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    await sendVerification(id, body.email);
    login(ctx, id);
    return { ok: true };
  });

  r.post('/api/auth/login', async (ctx) => {
    const body = await ctx.body(loginSchema);
    rateLimit(`login-ip:${ctx.ip}`, 30, 15 * 60_000);
    rateLimit(`login-email:${body.email}`, 8, 15 * 60_000);
    const user = getDb().get<{ id: string; password_hash: string | null }>('SELECT id, password_hash FROM users WHERE email = ?', body.email);
    const ok = await verifyPassword(body.password, user?.password_hash);
    if (!user || !ok) throw new HttpError(401, 'E-mail ou senha incorretos.', 'invalid_credentials');
    login(ctx, user.id);
    return { ok: true };
  });

  r.post('/api/auth/logout', (ctx) => {
    destroySession(ctx.res, ctx.cookies[SESSION_COOKIE]);
    return { ok: true };
  });

  r.post('/api/auth/forgot-password', async (ctx) => {
    rateLimit(`forgot:${ctx.ip}`, 5, 15 * 60_000);
    const body = await ctx.body(forgotSchema);
    const user = getDb().get<{ id: string }>('SELECT id FROM users WHERE email = ?', body.email);
    if (user) {
      const token = issueToken(user.id, 'password_reset', 60);
      const link = new URL(`/redefinir-senha?token=${encodeURIComponent(token)}`, env.APP_URL).toString();
      await sendAccountEmail(body.email, 'Redefinição de senha — GAZU', `Recebemos um pedido para redefinir sua senha.\n\nUse o link abaixo (válido por 1 hora):\n${link}\n\nSe não foi você, ignore este e-mail.`, {
        title: 'Redefinir senha', intro: 'Recebemos um pedido para redefinir a senha da sua conta GAZU.', cta: { label: 'Criar nova senha', href: link },
        outro: 'O link vale por 1 hora. Se não foi você, ignore este e-mail — sua senha atual continua valendo.', event: 'account_password_reset',
      });
    }
    // Mesma resposta sempre, para não revelar quais e-mails estão cadastrados.
    return { ok: true, message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.' };
  });

  r.post('/api/auth/reset-password', async (ctx) => {
    rateLimit(`reset:${ctx.ip}`, 10, 15 * 60_000);
    const body = await ctx.body(resetSchema);
    const problem = passwordProblems(body.password);
    if (problem) throw new HttpError(400, problem, 'weak_password', { fieldErrors: { password: [problem] } });
    const userId = consumeToken(body.token, 'password_reset');
    const hash = await hashPassword(body.password);
    // Redefinir/criar senha pelo link do e-mail também ativa contas criadas em compras sem cadastro.
    getDb().run('UPDATE users SET password_hash = ?, is_guest = 0, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ? AND anonymized_at IS NULL', hash, nowIso(), nowIso(), userId);
    destroyAllSessions(userId);
    login(ctx, userId);
    return { ok: true };
  });

  r.get('/api/auth/verify-email', (ctx) => {
    try {
      const userId = consumeToken(ctx.url.searchParams.get('token') ?? '', 'email_verification');
      getDb().run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', nowIso(), userId);
      redirect(ctx.res, '/conta?email=verificado');
    } catch {
      redirect(ctx.res, '/conta?email=link-invalido');
    }
  });

  r.post('/api/auth/resend-verification', async (ctx) => {
    const u = requireUser(ctx);
    rateLimit(`verify:${u.id}`, 3, 60 * 60_000);
    if (!u.emailVerified) await sendVerification(u.id, u.email);
    return { ok: true };
  });

  r.post('/api/auth/change-password', async (ctx) => {
    const u = requireUser(ctx);
    rateLimit(`chpw:${u.id}`, 10, 15 * 60_000);
    const body = await ctx.body(changePasswordSchema);
    const row = getDb().get<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = ?', u.id)!;
    if (row.password_hash && !(await verifyPassword(body.currentPassword ?? '', row.password_hash))) {
      throw new HttpError(400, 'Senha atual incorreta.', 'invalid_credentials', { fieldErrors: { currentPassword: ['Senha atual incorreta.'] } });
    }
    const problem = passwordProblems(body.newPassword);
    if (problem) throw new HttpError(400, problem, 'weak_password', { fieldErrors: { newPassword: [problem] } });
    getDb().run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', await hashPassword(body.newPassword), nowIso(), u.id);
    destroyAllSessions(u.id);
    login(ctx, u.id);
    return { ok: true };
  });

  r.get('/api/account/profile', (ctx) => {
    const u = requireUser(ctx);
    const p = getDb().get<{ full_name: string; phone: string | null }>('SELECT full_name, phone FROM profiles WHERE user_id = ?', u.id);
    return { name: p?.full_name ?? '', phone: p?.phone ?? '', email: u.email };
  });
  r.put('/api/account/profile', async (ctx) => {
    const u = requireUser(ctx);
    const body = await ctx.body(profileSchema);
    getDb().run(
      `INSERT INTO profiles (user_id, full_name, phone, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET full_name = excluded.full_name, phone = excluded.phone, updated_at = excluded.updated_at`,
      u.id, body.name, body.phone ?? null, nowIso(),
    );
    return { ok: true };
  });

  // ---- Google OAuth ----
  r.get('/api/auth/google/start', (ctx) => {
    if (!features.googleAuth) throw new HttpError(503, 'Login com Google ainda não foi configurado.', 'google_not_configured');
    const state = randomToken(16);
    const verifier = randomToken(48);
    const returnTo = safeReturnTo(ctx.url.searchParams.get('returnTo'));
    setCookie(ctx.res, 'gazu_oauth', sign(Buffer.from(JSON.stringify({ state, verifier, returnTo })).toString('base64url')), { maxAge: 600, secure: isProd, sameSite: 'Lax' });
    redirect(ctx.res, googleAuthUrl(state, verifier));
  });

  r.get('/api/auth/google/callback', async (ctx) => {
    const raw = unsign(ctx.cookies['gazu_oauth']);
    setCookie(ctx.res, 'gazu_oauth', '', { maxAge: 0, secure: isProd });
    const fail = (reason: string) => redirect(ctx.res, `/entrar?erro=${encodeURIComponent(reason)}`);
    if (!raw) return fail('sessao-expirada');
    const saved = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { state: string; verifier: string; returnTo: string };
    if (ctx.url.searchParams.get('state') !== saved.state) return fail('estado-invalido');
    const code = ctx.url.searchParams.get('code');
    if (!code) return fail(ctx.url.searchParams.get('error') ?? 'cancelado');
    let identity;
    try {
      identity = await exchangeGoogleCode(code, saved.verifier);
    } catch {
      return fail('google');
    }
    if (!identity.emailVerified) return fail('email-nao-verificado');
    const db = getDb();
    let user = db.get<{ id: string }>('SELECT id FROM users WHERE google_sub = ?', identity.sub);
    if (!user) {
      const byEmail = db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', identity.email);
      if (byEmail) {
        // O Google confirmou a posse do e-mail: contas de compra sem cadastro são ativadas.
        db.run('UPDATE users SET google_sub = ?, is_guest = 0, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', identity.sub, nowIso(), byEmail.id);
        user = byEmail;
      } else {
        const id = crypto.randomUUID();
        db.tx(() => {
          db.run('INSERT INTO users (id, email, google_sub, email_verified_at) VALUES (?, ?, ?, ?)', id, identity.email, identity.sub, nowIso());
          db.run('INSERT INTO profiles (user_id, full_name) VALUES (?, ?)', id, identity.name);
        });
        user = { id };
      }
    }
    login(ctx, user.id);
    redirect(ctx.res, `${saved.returnTo}${saved.returnTo.includes('?') ? '&' : '?'}login=google`);
  });
}
