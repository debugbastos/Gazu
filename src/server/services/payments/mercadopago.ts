import crypto from 'node:crypto';
import { env } from '../../config.ts';
import { HttpError } from '../../http.ts';
import type { PaymentStatus } from '../../../shared/types.ts';

// Cliente mínimo da API REST do Mercado Pago (Checkout Transparente / API de Pagamentos).
// Documentação: https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post
// As credenciais ficam SOMENTE no servidor (variáveis de ambiente).

const API = 'https://api.mercadopago.com';

export type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...args) => fetch(...args);
/** Permite substituir o fetch nos testes automatizados. */
export function setMercadoPagoFetch(f: FetchLike | null): void {
  fetchImpl = f ?? ((...args) => fetch(...args));
}

export interface MpPayment {
  id: number | string;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  transaction_amount_refunded?: number;
  date_approved?: string | null;
  fee_details?: { type?: string; amount: number; fee_payer?: string }[];
  transaction_details?: { net_received_amount?: number; external_resource_url?: string | null; total_paid_amount?: number };
  barcode?: { content?: string } | null;
  external_reference?: string;
  payment_method_id?: string;
  payment_type_id?: string;
  installments?: number;
  date_of_expiration?: string | null;
  card?: { last_four_digits?: string | null } | null;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
}

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  if (!env.MP_ACCESS_TOKEN) throw new HttpError(503, 'Pagamentos não configurados.', 'payments_not_configured');
  const headers: Record<string, string> = { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  let resp: Response;
  try {
    resp = await fetchImpl(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new HttpError(502, 'Não foi possível comunicar com o provedor de pagamento. Tente novamente.', 'provider_unreachable');
  }
  const text = await resp.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
  if (!resp.ok) {
    const msg = (json as { message?: string } | null)?.message;
    // Não registramos o corpo completo para evitar vazar dados do pagador nos logs.
    console.warn(`[mercadopago] ${method} ${path} → HTTP ${resp.status}${msg ? ` (${msg})` : ''}`);
    throw new HttpError(resp.status >= 500 ? 502 : 422, 'O provedor de pagamento recusou a solicitação.', 'provider_error', { providerStatus: resp.status });
  }
  return json as T;
}

/** Data no formato aceito pelo MP (yyyy-MM-ddTHH:mm:ss.SSS-03:00). */
export function mpDate(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3600_000);
  return local.toISOString().replace('Z', '-03:00');
}

export interface PixRequest { amountCents: number; description: string; payerEmail: string; externalReference: string; expiresAt: Date; idempotencyKey: string }
export function createPixPayment(r: PixRequest): Promise<MpPayment> {
  return call<MpPayment>('POST', '/v1/payments', {
    transaction_amount: r.amountCents / 100,
    description: r.description,
    payment_method_id: 'pix',
    payer: { email: r.payerEmail },
    external_reference: r.externalReference,
    notification_url: new URL('/api/webhooks/mercadopago', env.APP_URL).toString(),
    date_of_expiration: mpDate(r.expiresAt),
  }, r.idempotencyKey);
}

export interface CardRequest {
  amountCents: number; description: string; token: string; installments: number; paymentMethodId: string; issuerId?: string | null;
  payerEmail: string; identificationType?: string | null; identificationNumber?: string | null; externalReference: string; idempotencyKey: string;
}
export function createCardPayment(r: CardRequest): Promise<MpPayment> {
  return call<MpPayment>('POST', '/v1/payments', {
    transaction_amount: r.amountCents / 100,
    description: r.description,
    token: r.token,
    installments: r.installments,
    payment_method_id: r.paymentMethodId,
    issuer_id: r.issuerId ? Number(r.issuerId) : undefined,
    payer: {
      email: r.payerEmail,
      identification: r.identificationType && r.identificationNumber ? { type: r.identificationType, number: r.identificationNumber } : undefined,
    },
    external_reference: r.externalReference,
    notification_url: new URL('/api/webhooks/mercadopago', env.APP_URL).toString(),
    statement_descriptor: 'GAZU',
  }, r.idempotencyKey);
}

export interface BoletoRequest {
  amountCents: number; description: string; externalReference: string; idempotencyKey: string; expiresAt: Date;
  payer: { email: string; firstName: string; lastName: string; cpf: string; address: { zipCode: string; streetName: string; streetNumber: string; neighborhood: string; city: string; federalUnit: string } };
}
/** Boleto bancário (payment_method_id "bolbradesco"). Link do boleto: transaction_details.external_resource_url. */
export function createBoletoPayment(r: BoletoRequest): Promise<MpPayment> {
  return call<MpPayment>('POST', '/v1/payments', {
    transaction_amount: r.amountCents / 100,
    description: r.description,
    payment_method_id: 'bolbradesco',
    external_reference: r.externalReference,
    notification_url: new URL('/api/webhooks/mercadopago', env.APP_URL).toString(),
    date_of_expiration: mpDate(r.expiresAt),
    payer: {
      email: r.payer.email, first_name: r.payer.firstName, last_name: r.payer.lastName,
      identification: { type: 'CPF', number: r.payer.cpf },
      address: { zip_code: r.payer.address.zipCode, street_name: r.payer.address.streetName, street_number: r.payer.address.streetNumber, neighborhood: r.payer.address.neighborhood, city: r.payer.address.city, federal_unit: r.payer.address.federalUnit },
    },
  }, r.idempotencyKey);
}

export interface MpRefund { id: number | string; payment_id: number | string; amount: number; status: string }
/** Estorno total (sem amount) ou parcial. Requer X-Idempotency-Key para não estornar duas vezes. */
export function createRefund(paymentId: string, amountCents: number | null, idempotencyKey: string): Promise<MpRefund> {
  if (!/^\d{1,20}$/.test(paymentId)) throw new HttpError(400, 'Identificador de pagamento inválido.', 'bad_payment_id');
  return call<MpRefund>('POST', `/v1/payments/${paymentId}/refunds`, amountCents === null ? {} : { amount: amountCents / 100 }, idempotencyKey);
}

/** Cancela no provedor uma cobrança ainda pendente (Pix/boleto não pagos). */
export function cancelPayment(paymentId: string): Promise<MpPayment> {
  if (!/^\d{1,20}$/.test(paymentId)) throw new HttpError(400, 'Identificador de pagamento inválido.', 'bad_payment_id');
  return call<MpPayment>('PUT', `/v1/payments/${paymentId}`, { status: 'cancelled' });
}

/** Opções de parcelamento informadas pelo provedor para um valor (usado na página de produto). */
export async function getInstallments(amountCents: number, paymentMethodId = 'master'): Promise<{ installments: number; installment_rate: number; installment_amount: number; total_amount: number }[]> {
  const res = await call<{ payer_costs?: { installments: number; installment_rate: number; installment_amount: number; total_amount: number }[] }[]>(
    'GET', `/v1/payment_methods/installments?amount=${(amountCents / 100).toFixed(2)}&payment_method_id=${encodeURIComponent(paymentMethodId)}`,
  );
  return res[0]?.payer_costs ?? [];
}

export function getPayment(id: string): Promise<MpPayment> {
  if (!/^\d{1,20}$/.test(id)) throw new HttpError(400, 'Identificador de pagamento inválido.', 'bad_payment_id');
  return call<MpPayment>('GET', `/v1/payments/${id}`);
}

/**
 * Mapeia o status do MP para o status interno do pagamento (documentado em docs/INTEGRACOES.md):
 * pending → pendente · in_process/in_mediation/authorized → em processamento · approved → aprovado
 * (ou estornado parcialmente, se houver valor devolvido) · rejected → recusado · cancelled → cancelado
 * (ou expirado, quando o detalhe indica expiração) · refunded/charged_back → estornado.
 * Status desconhecidos nunca viram "aprovado".
 */
export function mapMpStatus(p: Pick<MpPayment, 'status' | 'transaction_amount_refunded' | 'transaction_amount'> & { status_detail?: string }): PaymentStatus {
  switch (p.status) {
    case 'approved':
      return p.transaction_amount_refunded && p.transaction_amount_refunded > 0 ? 'partially_refunded' : 'approved';
    case 'pending':
      return 'pending';
    case 'authorized':
    case 'in_process':
    case 'in_mediation':
      return 'in_process';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return /expir/i.test(p.status_detail ?? '') ? 'expired' : 'cancelled';
    case 'refunded':
    case 'charged_back':
      return 'refunded';
    default:
      return 'pending';
  }
}

/** Valores financeiros informados pelo provedor (taxas, líquido, estornado). */
export function mpFinancials(p: MpPayment): { feeCents: number | null; netCents: number | null; refundedCents: number } {
  // fee_details ausente = taxa desconhecida (null); lista vazia = provedor informou que não há taxa (0).
  const fees = Array.isArray(p.fee_details) ? p.fee_details.filter((f) => !f.fee_payer || f.fee_payer === 'collector') : null;
  return {
    feeCents: fees ? Math.round(fees.reduce((s, f) => s + (f.amount ?? 0), 0) * 100) : null,
    netCents: typeof p.transaction_details?.net_received_amount === 'number' ? Math.round(p.transaction_details.net_received_amount * 100) : null,
    refundedCents: Math.round((p.transaction_amount_refunded ?? 0) * 100),
  };
}

/**
 * Valida o cabeçalho x-signature das notificações (webhooks) do Mercado Pago.
 * Manifesto: `id:{data.id};request-id:{x-request-id};ts:{ts};` assinado com HMAC-SHA256 usando a chave secreta do webhook.
 * Também rejeita notificações muito antigas (proteção contra replay).
 */
export function verifyMpSignature(opts: { signatureHeader: string | undefined; requestId: string | undefined; dataId: string | undefined; secret: string; toleranceSec?: number; now?: number }): boolean {
  const { signatureHeader, requestId, dataId, secret } = opts;
  if (!signatureHeader || !dataId) return false;
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=').map((s) => s?.trim());
    if (k === 'ts') ts = v;
    if (k === 'v1') v1 = v;
  }
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const ok = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  if (!ok) return false;
  const tol = opts.toleranceSec ?? 600;
  const tsNum = Number(ts);
  const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
  return Math.abs((opts.now ?? Date.now()) - tsMs) <= tol * 1000;
}
