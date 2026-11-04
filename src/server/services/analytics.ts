import { getDb } from '../db.ts';
import { HttpError } from '../http.ts';
import type { AnalyticsReportDTO } from '../../shared/types.ts';
import { latestConsent, recordConsent } from './privacy.ts';
import { parsePeriod } from './finance.ts';

// Analytics próprio, com consentimento (LGPD):
// - Eventos de navegação só são aceitos de sessões que CONSENTIRAM (registro em `consents`, finalidade "analytics").
// - Sem IP, sem e-mail, sem nome: apenas um identificador aleatório de sessão gerado após o consentimento.
// - Compras NUNCA vêm do navegador: os relatórios usam pedidos com pagamento aprovado pelo provedor.
// - Buscas sem resultado são registradas pelo servidor de forma agregada (sem sessão/usuário) para melhorar o catálogo.

export const ALLOWED_EVENTS = ['page_view', 'product_view', 'add_to_cart', 'remove_from_cart', 'begin_checkout', 'search', 'select_item', 'favorite_add', 'newsletter_signup', 'lookbook_view', 'filter_use'] as const;
export type AnalyticsEvent = (typeof ALLOWED_EVENTS)[number];

const SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function setAnalyticsConsent(sessionId: string, granted: boolean, userId: string | null, ip?: string, ua?: string): void {
  if (!SESSION_RE.test(sessionId)) throw new HttpError(400, 'Identificador de sessão inválido.', 'bad_session');
  recordConsent({ subject: `anon:${sessionId}`, purpose: 'analytics', granted, ip, userAgent: ua });
  if (userId) recordConsent({ subject: `user:${userId}`, purpose: 'analytics', granted, ip, userAgent: ua });
  if (!granted) getDb().run('DELETE FROM analytics_events WHERE session_id = ?', sessionId); // revogação apaga o histórico da sessão
}

export interface IncomingEvent {
  event: string; path?: string | null; productId?: number | null; categorySlug?: string | null; searchTerm?: string | null; resultsCount?: number | null; valueCents?: number | null;
  props?: Record<string, string | number | boolean> | null; utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; referrerHost?: string | null;
}

const short = (v: string | null | undefined, n: number) => (v ? String(v).slice(0, n) : null);
/** Remove e-mails, números longos (CPF, telefone, cartão) e tokens de textos livres antes de gravar. */
export function scrubText(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.replace(/[^\s@]+@[^\s@]+/g, '[email]').replace(/\d[\d .\-/]{7,}\d/g, '[número]').replace(/[A-Za-z0-9_-]{32,}/g, '[token]').slice(0, 120);
}
const cleanPath = (p: string | null | undefined) => (p ? p.split('?')[0]!.split('#')[0]!.slice(0, 200) : null);

export function recordEvents(sessionId: string, userId: string | null, events: IncomingEvent[]): { accepted: number } {
  if (!SESSION_RE.test(sessionId)) throw new HttpError(400, 'Identificador de sessão inválido.', 'bad_session');
  const consent = latestConsent(`anon:${sessionId}`, 'analytics');
  if (!consent?.granted) return { accepted: 0 }; // sem consentimento, nada é gravado
  const db = getDb();
  let accepted = 0;
  db.tx(() => {
    for (const e of events.slice(0, 30)) {
      if (!(ALLOWED_EVENTS as readonly string[]).includes(e.event)) continue;
      db.run(
        `INSERT INTO analytics_events (session_id, user_id, event, path, product_id, category_slug, search_term, results_count, value_cents, props, utm_source, utm_medium, utm_campaign, referrer_host)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sessionId, userId, e.event, cleanPath(e.path), e.productId ?? null, short(e.categorySlug, 80), scrubText(e.searchTerm)?.toLowerCase() ?? null,
        e.resultsCount ?? null, e.valueCents ?? null, e.props ? JSON.stringify(e.props).slice(0, 500) : null,
        short(e.utmSource, 80), short(e.utmMedium, 80), short(e.utmCampaign, 80)?.toLowerCase() ?? null, short(e.referrerHost, 120),
      );
      accepted++;
    }
  });
  return { accepted };
}

/** Busca sem resultado: registro agregado do servidor, sem sessão nem usuário. */
export function recordZeroResultSearch(term: string): void {
  const t = scrubText(term.trim().toLowerCase());
  if (!t || t.length < 2) return;
  getDb().run("INSERT INTO analytics_events (session_id, event, search_term, results_count) VALUES ('server', 'search_zero', ?, 0)", t);
}

export function analyticsReport(fromInput?: string | null, toInput?: string | null): AnalyticsReportDTO {
  const db = getDb();
  const p = parsePeriod(fromInput, toInput);
  const range = [p.fromIso, p.toIso] as const;
  const sessionsWith = (event: string) => db.get<{ n: number }>("SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE event = ? AND session_id <> 'server' AND created_at >= ? AND created_at < ?", event, ...range)!.n;
  const paid = db.get<{ n: number; revenue: number }>(
    `SELECT COUNT(DISTINCT o.id) AS n, COALESCE(SUM(pay.amount_cents), 0) AS revenue FROM orders o JOIN payments pay ON pay.order_id = o.id
      WHERE pay.status IN ('approved','partially_refunded','refunded') AND pay.approved_at >= ? AND pay.approved_at < ? AND o.is_demo = 0 AND pay.provider <> 'demo'`, ...range,
  )!;
  const consentedSessions = db.get<{ n: number }>("SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE session_id <> 'server' AND created_at >= ? AND created_at < ?", ...range)!.n;
  return {
    period: { from: p.from, to: p.to },
    consentedSessions,
    funnel: [
      { step: 'Visitas (sessões com consentimento)', sessions: sessionsWith('page_view') },
      { step: 'Viram produto', sessions: sessionsWith('product_view') },
      { step: 'Adicionaram ao carrinho', sessions: sessionsWith('add_to_cart') },
      { step: 'Iniciaram o checkout', sessions: sessionsWith('begin_checkout') },
    ],
    topProducts: db.all<{ productId: number; name: string; views: number; addToCart: number }>(
      `SELECT e.product_id AS productId, p.name, SUM(e.event = 'product_view') AS views, SUM(e.event = 'add_to_cart') AS addToCart
         FROM analytics_events e JOIN products p ON p.id = e.product_id WHERE e.product_id IS NOT NULL AND e.created_at >= ? AND e.created_at < ?
        GROUP BY e.product_id ORDER BY views DESC LIMIT 15`, ...range,
    ).map((r) => ({
      ...r,
      purchases: db.get<{ n: number }>(
        `SELECT COALESCE(SUM(i.quantity), 0) AS n FROM order_items i JOIN orders o ON o.id = i.order_id JOIN payments pay ON pay.order_id = o.id
          WHERE i.product_id = ? AND pay.status IN ('approved','partially_refunded','refunded') AND pay.approved_at >= ? AND pay.approved_at < ? AND o.is_demo = 0`, r.productId, ...range,
      )!.n,
    })),
    topSearches: db.all<{ term: string; count: number; avgResults: number }>(
      "SELECT search_term AS term, COUNT(*) AS count, ROUND(AVG(results_count), 1) AS avgResults FROM analytics_events WHERE event = 'search' AND search_term IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY search_term ORDER BY count DESC LIMIT 20", ...range,
    ),
    zeroResultSearches: db.all<{ term: string; count: number }>(
      "SELECT search_term AS term, COUNT(*) AS count FROM analytics_events WHERE (event = 'search_zero' OR (event = 'search' AND results_count = 0)) AND search_term IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY search_term ORDER BY count DESC LIMIT 20", ...range,
    ),
    sources: db.all<{ source: string; sessions: number }>(
      "SELECT COALESCE(utm_source, referrer_host, 'direto') AS source, COUNT(DISTINCT session_id) AS sessions FROM analytics_events WHERE event = 'page_view' AND created_at >= ? AND created_at < ? GROUP BY source ORDER BY sessions DESC LIMIT 15", ...range,
    ).map((s) => {
      const o = db.get<{ n: number; r: number }>(
        `SELECT COUNT(DISTINCT o.id) AS n, COALESCE(SUM(pay.amount_cents), 0) AS r FROM orders o JOIN payments pay ON pay.order_id = o.id
          WHERE COALESCE(o.utm_source, 'direto') = ? AND pay.status IN ('approved','partially_refunded','refunded') AND pay.approved_at >= ? AND pay.approved_at < ? AND o.is_demo = 0`, s.source, ...range,
      )!;
      return { ...s, orders: o.n, revenueCents: o.r };
    }),
    purchases: { orders: paid.n, revenueCents: paid.revenue, note: 'Compras e receita vêm de pedidos com pagamento aprovado pelo provedor (não de eventos do navegador). Pedidos de demonstração não entram.' },
  };
}

/** Retenção: eventos de navegação são apagados após 13 meses. */
export function purgeOldAnalytics(): number {
  return getDb().run('DELETE FROM analytics_events WHERE created_at < ?', new Date(Date.now() - 395 * 86400_000).toISOString()).changes;
}
