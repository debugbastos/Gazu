import fs from 'node:fs';
import path from 'node:path';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { ROOT, isProd } from './config.ts';
import { HttpError, Router, parseCookies, readBody, sendJson, type Ctx } from './http.ts';
import { assertSameOrigin, clientIp, securityHeaders } from './security.ts';
import { SESSION_COOKIE, userFromToken } from './auth/sessions.ts';
import { registerPublicRoutes } from './routes/public.ts';
import { registerCartRoutes } from './routes/cart.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerAccountRoutes } from './routes/account.ts';
import { registerAdminRoutes } from './routes/admin.ts';
import { registerWebhookRoutes } from './routes/webhooks.ts';
import { renderHtml, robotsTxt, sitemapXml } from './render.ts';

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.map': 'application/json',
};

export function createRouter(): Router {
  const r = new Router();
  registerPublicRoutes(r);
  registerCartRoutes(r);
  registerAuthRoutes(r);
  registerAccountRoutes(r);
  registerAdminRoutes(r);
  registerWebhookRoutes(r);
  return r;
}

const PUBLIC_DIR = path.join(ROOT, 'public');

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (pathname.includes('\0')) return false;
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) return false;
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  res.setHeader('Content-Type', MIME[ext]!);
  res.setHeader('ETag', etag);
  const immutable = pathname.startsWith('/build/') && /\.[a-z0-9]{8,}\./i.test(pathname);
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : pathname.startsWith('/assets/') || pathname.startsWith('/uploads/') ? 'public, max-age=86400' : 'public, max-age=300');
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return true; }
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

export function createApp(): http.Server {
  const router = createRouter();
  return http.createServer(async (req, res) => {
    const started = Date.now();
    securityHeaders(res);
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://localhost'); } catch { res.statusCode = 400; res.end(); return; }
    const pathname = url.pathname;
    try {
      if (pathname.startsWith('/api/')) {
        if (!pathname.startsWith('/api/webhooks/')) assertSameOrigin(req);
        const match = router.match(req.method ?? 'GET', pathname);
        if (!match) throw new HttpError(404, 'Rota não encontrada.', 'not_found');
        if (match === 'method') throw new HttpError(405, 'Método não permitido.', 'method_not_allowed');
        const cookies = parseCookies(req.headers.cookie);
        let rawBody: Buffer | undefined;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const isUpload = /^\/api\/admin\/products\/\d+\/images$/.test(pathname);
          rawBody = await readBody(req, isUpload ? 8 * 1024 * 1024 + 1024 : 200_000);
        }
        const ctx: Ctx = {
          req, res, url, params: match.params, cookies, ip: clientIp(req), user: userFromToken(cookies[SESSION_COOKIE]), rawBody,
          async body<T>(schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
            const ct = req.headers['content-type'] ?? '';
            if (!ct.includes('application/json')) throw new HttpError(415, 'Envie JSON.', 'unsupported_media_type');
            let data: unknown;
            try { data = JSON.parse(rawBody?.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'JSON inválido.', 'bad_json'); }
            return schema.parse(data);
          },
        };
        const out = await match.handler(ctx);
        if (!res.headersSent && !res.writableEnded) sendJson(res, 200, out ?? { ok: true });
        return;
      }
      if (pathname === '/sitemap.xml') { res.setHeader('Content-Type', 'application/xml; charset=utf-8'); res.end(sitemapXml()); return; }
      if (pathname === '/robots.txt') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(robotsTxt()); return; }
      if ((req.method === 'GET' || req.method === 'HEAD') && path.extname(pathname) && serveStatic(req, res, pathname)) return;
      if (path.extname(pathname) && !pathname.endsWith('.html')) { res.statusCode = 404; res.end('Not found'); return; }
      const { status, html } = renderHtml(pathname, url.search);
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : html);
    } catch (err) {
      handleError(res, err);
    } finally {
      if (!isProd && process.env.LOG_REQUESTS === '1') console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
}

function handleError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) { res.end(); return; }
  if (err instanceof ZodError) {
    const flat = err.flatten();
    const first = Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0] ?? 'Dados inválidos.';
    sendJson(res, 400, { error: { code: 'validation_error', message: first, details: { fieldErrors: flat.fieldErrors, formErrors: flat.formErrors } } });
    return;
  }
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  console.error('[erro interno]', err instanceof Error ? err.stack : err);
  sendJson(res, 500, { error: { code: 'internal_error', message: 'Erro interno. Tente novamente em instantes.' } });
}
