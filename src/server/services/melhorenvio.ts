import { env } from '../config.ts';
import { HttpError } from '../http.ts';

// Cliente da API do Melhor Envio (cotação, compra de etiqueta e rastreamento).
// Documentação: https://docs.melhorenvio.com.br — exige token (OAuth/Token pessoal) e User-Agent com contato.
// A conta, o saldo para etiquetas e os dados do remetente são providenciados pelo responsável da loja.

const BASE = () => (env.MELHORENVIO_ENV === 'production' ? 'https://melhorenvio.com.br' : 'https://sandbox.melhorenvio.com.br');

export type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...args) => fetch(...args);
export function setMelhorEnvioFetch(f: FetchLike | null): void {
  fetchImpl = f ?? ((...args) => fetch(...args));
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!env.MELHORENVIO_TOKEN) throw new HttpError(503, 'Integração de frete não configurada.', 'shipping_not_configured');
  let resp: Response;
  try {
    resp = await fetchImpl(`${BASE()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.MELHORENVIO_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': env.MELHORENVIO_USER_AGENT },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, 'Não foi possível consultar a transportadora agora. Tente novamente.', 'shipping_unreachable');
  }
  const text = await resp.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* não-JSON */ }
  if (!resp.ok) {
    console.warn(`[melhorenvio] ${method} ${path} → HTTP ${resp.status}`);
    throw new HttpError(resp.status >= 500 ? 502 : 422, 'A transportadora recusou a solicitação.', 'shipping_provider_error', { providerStatus: resp.status, message: (json as { message?: string } | null)?.message });
  }
  return json as T;
}

export interface MeProduct { id: string; width: number; height: number; length: number; weight: number; insurance_value: number; quantity: number }
export interface MeQuote {
  id: number; name: string; error?: string; price?: string; custom_price?: string; delivery_time?: number; custom_delivery_time?: number;
  delivery_range?: { min: number; max: number }; custom_delivery_range?: { min: number; max: number }; company?: { id: number; name: string };
}

export function calculate(toCep: string, products: MeProduct[]): Promise<MeQuote[]> {
  return call<MeQuote[]>('POST', '/api/v2/me/shipment/calculate', {
    from: { postal_code: (env.SHIPPING_ORIGIN_CEP ?? '').replace(/\D/g, '') },
    to: { postal_code: toCep },
    products,
    options: { receipt: false, own_hand: false },
    ...(env.MELHORENVIO_SERVICES ? { services: env.MELHORENVIO_SERVICES } : {}),
  });
}

export interface MeParty {
  name: string; phone?: string; email?: string; document?: string; company_document?: string; address: string; complement?: string | null; number: string;
  district: string; city: string; state_abbr: string; country_id: 'BR'; postal_code: string;
}

/** Compra de etiqueta: inserir no carrinho → pagar (saldo da conta) → gerar → obter URL de impressão. */
export async function purchaseLabel(input: {
  serviceId: number; from: MeParty; to: MeParty; products: { name: string; quantity: number; unitary_value: number }[];
  volume: { height: number; width: number; length: number; weight: number }; insuranceValue: number; orderNumber: string; invoiceKey?: string | null;
}): Promise<{ meOrderId: string; labelUrl: string | null; tracking: string | null }> {
  const cart = await call<{ id: string }>('POST', '/api/v2/me/cart', {
    service: input.serviceId, from: input.from, to: input.to, products: input.products, volumes: [input.volume],
    options: {
      insurance_value: input.insuranceValue, receipt: false, own_hand: false, reverse: false,
      non_commercial: !input.invoiceKey, ...(input.invoiceKey ? { invoice: { key: input.invoiceKey } } : {}),
      platform: 'GAZU', tags: [{ tag: input.orderNumber }],
    },
  });
  await call('POST', '/api/v2/me/shipment/checkout', { orders: [cart.id] });
  await call('POST', '/api/v2/me/shipment/generate', { orders: [cart.id] });
  const print = await call<{ url?: string }>('POST', '/api/v2/me/shipment/print', { mode: 'public', orders: [cart.id] });
  const tracking = await trackShipments([cart.id]).catch(() => ({} as Record<string, MeTracking>));
  return { meOrderId: cart.id, labelUrl: print.url ?? null, tracking: tracking[cart.id]?.tracking ?? null };
}

export interface MeTracking { id: string; status: string; tracking: string | null; melhorenvio_tracking?: string | null; created_at?: string; posted_at?: string | null; delivered_at?: string | null; canceled_at?: string | null }

export function trackShipments(ids: string[]): Promise<Record<string, MeTracking>> {
  return call<Record<string, MeTracking>>('POST', '/api/v2/me/shipment/tracking', { orders: ids });
}

/** Mapeia o status do Melhor Envio para o status interno do envio. */
export function mapMeStatus(status: string): 'label_purchased' | 'shipped' | 'delivered' | 'cancelled' | 'delivery_failed' | null {
  switch (status) {
    case 'pending': case 'released': case 'generated': case 'paid': return 'label_purchased';
    case 'posted': return 'shipped';
    case 'delivered': return 'delivered';
    case 'canceled': case 'cancelled': return 'cancelled';
    case 'undelivered': return 'delivery_failed';
    default: return null;
  }
}
