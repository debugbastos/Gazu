import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { env, isProd, sessionSecret } from './config.ts';
import { HttpError } from './http.ts';

export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Assinatura HMAC para valores guardados em cookies temporários (ex.: state do OAuth). */
export function sign(value: string): string {
  const mac = crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
  return `${value}.${mac}`;
}
export function unsign(signed: string | undefined): string | null {
  if (!signed) return null;
  const i = signed.lastIndexOf('.');
  if (i < 1) return null;
  const value = signed.slice(0, i);
  return safeEqual(sign(value), signed) ? value : null;
}

export function securityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  const mp = ['https://sdk.mercadopago.com', 'https://*.mercadopago.com', 'https://*.mercadolibre.com', 'https://*.mlstatic.com'];
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' ${mp.join(' ')}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${mp.join(' ')}`,
      "font-src 'self'",
      `connect-src 'self' ${mp.join(' ')}`,
      `frame-src ${mp.join(' ')}`,
      "base-uri 'self'",
      "form-action 'self' https://accounts.google.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; '),
  );
}

/**
 * Proteção CSRF: toda requisição que altera estado deve vir da própria origem.
 * Cookies de sessão são SameSite=Lax e as APIs exigem JSON (ou multipart no upload do admin).
 */
export function assertSameOrigin(req: IncomingMessage): void {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const origin = req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
  const allowed = new Set([new URL(env.APP_URL).origin, `http://${req.headers.host}`, `https://${req.headers.host}`]);
  if (!origin || !allowed.has(origin)) throw new HttpError(403, 'Origem da requisição não permitida.', 'bad_origin');
}

/** Limitador simples em memória (janela fixa). Em múltiplas instâncias use Redis/infra equivalente. */
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > max) {
    const secs = Math.ceil((b.reset - now) / 1000);
    throw new HttpError(429, `Muitas tentativas. Tente novamente em ${secs}s.`, 'rate_limited');
  }
}
export function resetRateLimits(): void {
  buckets.clear();
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

export function clientIp(req: IncomingMessage): string {
  // Atrás de um proxy confiável, configure TRUST_PROXY=1 para usar X-Forwarded-For.
  if (process.env.TRUST_PROXY === '1') {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf) return xf.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}
