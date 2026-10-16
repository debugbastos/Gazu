import type { ServerResponse } from 'node:http';
import { env, isProd } from '../config.ts';
import { getDb, nowIso } from '../db.ts';
import { setCookie } from '../http.ts';
import { randomToken, sha256 } from '../security.ts';

export const SESSION_COOKIE = 'gazu_session';

export interface SessionUser {
  id: string;
  email: string;
  role: 'customer' | 'admin';
  name: string;
  emailVerified: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
}

export function createSession(res: ServerResponse, userId: string, ip: string, ua: string | undefined): void {
  const token = randomToken(32);
  const expires = new Date(Date.now() + env.SESSION_TTL_DAYS * 86400_000);
  getDb().run('INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)', sha256(token), userId, expires.toISOString(), ip, (ua ?? '').slice(0, 300));
  setCookie(res, SESSION_COOKIE, token, { httpOnly: true, secure: isProd, sameSite: 'Lax', maxAge: env.SESSION_TTL_DAYS * 86400 });
}

export function destroySession(res: ServerResponse, token: string | undefined): void {
  if (token) getDb().run('DELETE FROM sessions WHERE id = ?', sha256(token));
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0, secure: isProd });
}

export function destroyAllSessions(userId: string): void {
  getDb().run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function userFromToken(token: string | undefined): SessionUser | null {
  if (!token || token.length > 200) return null;
  const row = getDb().get<{
    id: string; email: string; role: 'customer' | 'admin'; full_name: string | null; email_verified_at: string | null; password_hash: string | null; google_sub: string | null; expires_at: string;
  }>(
    `SELECT u.id, u.email, u.role, p.full_name, u.email_verified_at, u.password_hash, u.google_sub, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN profiles p ON p.user_id = u.id
      WHERE s.id = ?`,
    sha256(token),
  );
  if (!row) return null;
  if (row.expires_at < nowIso()) {
    getDb().run('DELETE FROM sessions WHERE id = ?', sha256(token));
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    name: row.full_name ?? '',
    emailVerified: Boolean(row.email_verified_at),
    hasPassword: Boolean(row.password_hash),
    googleLinked: Boolean(row.google_sub),
  };
}

export function purgeExpiredSessions(): number {
  return getDb().run('DELETE FROM sessions WHERE expires_at < ?', nowIso()).changes;
}
