import crypto from 'node:crypto';
import { isProd } from '../config.ts';
import { getDb } from '../db.ts';
import { HttpError, setCookie, type Ctx } from '../http.ts';
import { randomToken, safeEqual, sha256, sign, unsign } from '../security.ts';

// Compra sem cadastro (visitante).
// - O pedido fica ligado a um usuário "visitante" (users.is_guest = 1) apenas para manter a integridade dos dados.
// - Visitantes NÃO recebem sessão: o acesso a cada pedido é feito por um token aleatório exclusivo do pedido,
//   guardado no banco somente como hash (orders.guest_access_hash) e entregue ao cliente por cookie HttpOnly
//   assinado e pelo link do e-mail de confirmação.
// - Se o mesmo e-mail criar conta depois, a ativação é feita por link enviado ao e-mail (prova de posse),
//   e os pedidos anteriores passam a aparecer na conta.

export const GUEST_COOKIE = 'gazu_guest';
const MAX_GRANTS = 10;
const COOKIE_DAYS = 60;

interface Grant { n: string; t: string }

export function readGuestGrants(ctx: Pick<Ctx, 'cookies'>): Grant[] {
  const raw = unsign(ctx.cookies[GUEST_COOKIE]);
  if (!raw) return [];
  try {
    const list = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    return Array.isArray(list) ? list.filter((g): g is Grant => typeof g?.n === 'string' && typeof g?.t === 'string').slice(0, MAX_GRANTS) : [];
  } catch {
    return [];
  }
}

export function addGuestGrant(ctx: Pick<Ctx, 'cookies' | 'res'>, number: string, token: string): void {
  const grants = [{ n: number, t: token }, ...readGuestGrants(ctx).filter((g) => g.n !== number)].slice(0, MAX_GRANTS);
  const value = sign(Buffer.from(JSON.stringify(grants)).toString('base64url'));
  ctx.cookies[GUEST_COOKIE] = value;
  setCookie(ctx.res, GUEST_COOKIE, value, { maxAge: COOKIE_DAYS * 86400, httpOnly: true, secure: isProd, sameSite: 'Lax' });
}

export function newGuestToken(): { token: string; hash: string } {
  const token = randomToken(24);
  return { token, hash: sha256(token) };
}

/** Usuário técnico para pedidos de visitante. E-mails de contas com senha exigem login. */
export function guestUserFor(email: string, name: string): string {
  const db = getDb();
  const existing = db.get<{ id: string; is_guest: number }>('SELECT id, is_guest FROM users WHERE email = ?', email);
  if (existing && !existing.is_guest) {
    throw new HttpError(409, 'Este e-mail já tem uma conta na GAZU. Entre na sua conta para concluir a compra.', 'account_exists', { fieldErrors: { email: ['E-mail já cadastrado — entre na sua conta.'] } });
  }
  if (existing) {
    db.run("UPDATE profiles SET full_name = CASE WHEN full_name = '' THEN ? ELSE full_name END WHERE user_id = ?", name, existing.id);
    return existing.id;
  }
  const id = crypto.randomUUID();
  db.tx(() => {
    db.run('INSERT INTO users (id, email, is_guest) VALUES (?, ?, 1)', id, email);
    db.run('INSERT INTO profiles (user_id, full_name) VALUES (?, ?)', id, name);
  });
  return id;
}

export interface OrderAccessInfo { orderId: number; email: string; userId: string; guest: boolean; number: string }

/**
 * Autoriza o acesso a um pedido: dono autenticado OU visitante com o token do pedido (cookie).
 * Responde 404 (e não 403) para não revelar a existência de pedidos de terceiros.
 */
export function orderAccess(ctx: Pick<Ctx, 'cookies' | 'user'>, number: string): OrderAccessInfo {
  const row = getDb().get<{ id: number; user_id: string; guest_access_hash: string | null; customer_email: string | null; email: string }>(
    'SELECT o.id, o.user_id, o.guest_access_hash, o.customer_email, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.number = ?', number,
  );
  if (!row) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
  const email = row.customer_email ?? row.email;
  if (ctx.user && row.user_id === ctx.user.id) return { orderId: row.id, email, userId: row.user_id, guest: false, number };
  if (row.guest_access_hash) {
    const grant = readGuestGrants(ctx).find((g) => g.n === number);
    if (grant && safeEqual(sha256(grant.t), row.guest_access_hash)) return { orderId: row.id, email, userId: row.user_id, guest: true, number };
  }
  throw new HttpError(ctx.user ? 404 : 401, ctx.user ? 'Pedido não encontrado.' : 'Entre na sua conta ou use o link do e-mail do pedido.', ctx.user ? 'not_found' : 'unauthenticated');
}

/** Valida um token recebido por link (e-mail) e, se correto, grava o acesso no cookie. */
export function claimGuestLink(ctx: Pick<Ctx, 'cookies' | 'res'>, number: string, token: string): boolean {
  const row = getDb().get<{ guest_access_hash: string | null }>('SELECT guest_access_hash FROM orders WHERE number = ?', number);
  if (!row?.guest_access_hash || !safeEqual(sha256(token), row.guest_access_hash)) return false;
  addGuestGrant(ctx, number, token);
  return true;
}

/** Pedidos de visitante acessíveis neste navegador (somente os do cookie, verificados). */
export function guestOrderNumbers(ctx: Pick<Ctx, 'cookies' | 'user'>): string[] {
  return readGuestGrants(ctx).filter((g) => {
    try { return orderAccess({ cookies: ctx.cookies, user: null }, g.n).guest; } catch { return false; }
  }).map((g) => g.n);
}
