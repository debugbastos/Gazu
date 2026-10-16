import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZodType, ZodTypeDef } from 'zod';
import type { SessionUser } from './auth/sessions.ts';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  cookies: Record<string, string>;
  ip: string;
  user: SessionUser | null;
  rawBody?: Buffer;
  /** Lê e valida o corpo JSON. */
  body<T>(schema: ZodType<T, ZodTypeDef, unknown>): Promise<T>;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/\//g, '\\/').replace(/:([a-zA-Z_]+)/g, (_, k: string) => {
          keys.push(k);
          return '([^\\/]+)';
        }) +
        '\\/?$',
    );
    this.routes.push({ method, pattern, keys, handler });
    return this;
  }
  get(p: string, h: Handler) { return this.add('GET', p, h); }
  post(p: string, h: Handler) { return this.add('POST', p, h); }
  put(p: string, h: Handler) { return this.add('PUT', p, h); }
  patch(p: string, h: Handler) { return this.add('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.add('DELETE', p, h); }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
      return { handler: r.handler, params };
    }
    return pathMatched ? 'method' : null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
}

export function setCookie(res: ServerResponse, name: string, value: string, o: CookieOptions = {}): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`, `SameSite=${o.sameSite ?? 'Lax'}`];
  if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(o.maxAge)}`);
  if (o.httpOnly !== false) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}

export async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Conteúdo muito grande.', 'payload_too_large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export function redirect(res: ServerResponse, location: string, status = 302): void {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.end();
}

export const requireUser = (ctx: Ctx): SessionUser => {
  if (!ctx.user) throw new HttpError(401, 'Faça login para continuar.', 'unauthenticated');
  return ctx.user;
};

export const requireAdmin = (ctx: Ctx): SessionUser => {
  const u = requireUser(ctx);
  if (u.role !== 'admin') throw new HttpError(403, 'Acesso restrito a administradores.', 'forbidden');
  return u;
};

export const intParam = (v: string | undefined, name = 'id'): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, `Parâmetro inválido: ${name}.`, 'bad_request');
  return n;
};
