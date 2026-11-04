import { api } from './api';
import { readJson, writeJson } from './storage';

// Analytics com consentimento (LGPD):
// - Até a pessoa escolher, NADA é enviado. A escolha fica no navegador (preferência do visitante).
// - O identificador de sessão é aleatório e só é criado depois do consentimento.
// - Compras nunca são enviadas pelo navegador: os relatórios usam pedidos aprovados pelo provedor.
// - UTM de campanha é guardada só nesta aba (sessionStorage) para atribuir o pedido à campanha.

const CONSENT_KEY = 'gazu.consent.v1';
const SESSION_KEY = 'gazu.analytics.sid';
const UTM_KEY = 'gazu.utm.v1';

export interface ConsentState { analytics: boolean; decidedAt: string }
type Listener = (c: ConsentState | null) => void;
const listeners = new Set<Listener>();

export function getConsent(): ConsentState | null {
  return readJson<ConsentState | null>(CONSENT_KEY, null);
}
export function onConsentChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function sessionId(create: boolean): string | null {
  try {
    let sid = window.localStorage.getItem(SESSION_KEY);
    if (!sid && create) {
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      sid = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      window.localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return null;
  }
}

export async function setConsent(analytics: boolean): Promise<void> {
  const state = { analytics, decidedAt: new Date().toISOString() };
  writeJson(CONSENT_KEY, state);
  const sid = sessionId(analytics) ?? sessionId(true);
  if (sid) await api.post('/api/consent', { sessionId: sid, analytics }).catch(() => undefined);
  if (!analytics) {
    try { window.localStorage.removeItem(SESSION_KEY); } catch { /* ignorado */ }
    queue.length = 0;
  }
  listeners.forEach((l) => l(state));
}

interface Event {
  event: 'page_view' | 'product_view' | 'add_to_cart' | 'remove_from_cart' | 'begin_checkout' | 'search' | 'select_item' | 'favorite_add' | 'newsletter_signup' | 'lookbook_view' | 'filter_use';
  path?: string; productId?: number; categorySlug?: string; searchTerm?: string; resultsCount?: number; valueCents?: number; props?: Record<string, string | number | boolean>;
}
const queue: (Event & { utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; referrerHost?: string | null })[] = [];
let timer: number | null = null;

function flush(): void {
  timer = null;
  const sid = sessionId(false);
  if (!sid || !getConsent()?.analytics || !queue.length) { queue.length = 0; return; }
  const events = queue.splice(0, 30);
  void api.post('/api/analytics/events', { sessionId: sid, events }).catch(() => undefined);
}

export function track(e: Event): void {
  if (!getConsent()?.analytics) return;
  const utm = getAttribution();
  let referrerHost: string | null = null;
  try { referrerHost = document.referrer ? new URL(document.referrer).host : null; } catch { /* ignorado */ }
  if (referrerHost === window.location.host) referrerHost = null;
  queue.push({ ...e, path: e.path ?? window.location.pathname, utmSource: utm.utmSource, utmMedium: utm.utmMedium, utmCampaign: utm.utmCampaign, referrerHost });
  if (timer === null) timer = window.setTimeout(flush, 1500);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (queue.length) flush(); });
}

// ---- Atribuição de campanha (UTM) ----
export interface Attribution { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null }

export function captureUtm(search: string): void {
  const sp = new URLSearchParams(search);
  const src = sp.get('utm_source'), med = sp.get('utm_medium'), camp = sp.get('utm_campaign');
  if (!src && !camp) return;
  try { window.sessionStorage.setItem(UTM_KEY, JSON.stringify({ utmSource: src, utmMedium: med, utmCampaign: camp })); } catch { /* ignorado */ }
}

export function getAttribution(): Attribution {
  try {
    const raw = window.sessionStorage.getItem(UTM_KEY);
    if (raw) return JSON.parse(raw) as Attribution;
  } catch { /* ignorado */ }
  return { utmSource: null, utmMedium: null, utmCampaign: null };
}
