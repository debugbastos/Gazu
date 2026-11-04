import { defaultPackage, env, features } from '../config.ts';
import { getDb } from '../db.ts';
import type { CartItemInput, ShippingOptionDTO } from '../../shared/types.ts';
import { onlyDigits } from '../../shared/format.ts';
import { calculate, type MeProduct } from './melhorenvio.ts';
import { logError } from './monitoring.ts';

// Frete:
// - "melhorenvio": cotação REAL pela API do Melhor Envio (transportadoras/Correios) — requer token e CEP de origem.
// - "manual": política operacional definida pelo administrador (faixas de CEP, valor e prazo) em /admin/frete.
// - "demo": opções SIMULADAS, claramente identificadas, apenas em desenvolvimento (bloqueado em produção).
// O ViaCEP (consulta de endereço) não é usado para cotar frete.

export interface ShippingQuoteResult {
  configured: boolean;
  options: ShippingOptionDTO[];
  message: string | null;
}

export const validCep = (cep: string): boolean => /^\d{8}$/.test(onlyDigits(cep)) && !/^0{8}$/.test(onlyDigits(cep));

// Cotações da transportadora ficam em cache por 15 minutos: o valor mostrado no carrinho é o mesmo
// revalidado na criação do pedido (e evita consultas repetidas à API).
const quoteCache = new Map<string, { at: number; result: ShippingQuoteResult }>();
const CACHE_MS = 15 * 60_000;
export function clearShippingCache(): void { quoteCache.clear(); }

function packageFor(items: CartItemInput[]): MeProduct[] {
  if (!items.length) return [{ id: 'pacote', width: defaultPackage.widthCm, height: defaultPackage.heightCm, length: defaultPackage.lengthCm, weight: defaultPackage.weightGrams / 1000, insurance_value: 0, quantity: 1 }];
  const db = getDb();
  const ids = items.map((i) => i.variantId);
  const rows = db.all<{ id: number; price: number; weight_grams: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null }>(
    `SELECT v.id, COALESCE(v.price_cents, p.price_cents) AS price, p.weight_grams, p.length_cm, p.width_cm, p.height_cm
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id IN (${ids.map(() => '?').join(',')})`, ...ids,
  );
  return items.map((it) => {
    const r = rows.find((x) => x.id === it.variantId);
    return {
      id: String(it.variantId),
      width: r?.width_cm ?? defaultPackage.widthCm, height: r?.height_cm ?? defaultPackage.heightCm, length: r?.length_cm ?? defaultPackage.lengthCm,
      weight: (r?.weight_grams ?? defaultPackage.weightGrams) / 1000, insurance_value: Math.round(r?.price ?? 0) / 100, quantity: it.quantity,
    };
  });
}

export async function quoteShipping(cepInput: string, subtotalCents: number, items: CartItemInput[] = []): Promise<ShippingQuoteResult> {
  const cep = onlyDigits(cepInput);
  if (!validCep(cep)) return { configured: true, options: [], message: 'CEP inválido. Informe os 8 dígitos.' };

  if (env.SHIPPING_PROVIDER === 'demo' && features.demoShipping) {
    return {
      configured: true,
      message: 'Frete em modo de demonstração: valores e prazos simulados, não são cotações reais.',
      options: [
        { id: 'demo:padrao', label: 'Entrega padrão (simulação)', priceCents: 1990, minDays: 5, maxDays: 9, isDemo: true, note: 'Valor simulado para demonstração' },
        { id: 'demo:expressa', label: 'Entrega expressa (simulação)', priceCents: 3490, minDays: 2, maxDays: 4, isDemo: true, note: 'Valor simulado para demonstração' },
      ],
    };
  }

  if (env.SHIPPING_PROVIDER === 'melhorenvio') {
    if (!features.melhorEnvio) return { configured: false, options: [], message: 'A cotação de frete ainda não foi configurada pela loja.' };
    const key = `${cep}|${JSON.stringify(items)}`;
    const hit = quoteCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
    try {
      const quotes = await calculate(cep, packageFor(items));
      const options = quotes.filter((q) => !q.error && (q.custom_price ?? q.price)).map((q): ShippingOptionDTO => {
        const range = q.custom_delivery_range ?? q.delivery_range;
        const days = q.custom_delivery_time ?? q.delivery_time ?? range?.max ?? 0;
        return {
          id: `me:${q.id}`, label: `${q.company?.name ?? 'Transportadora'} ${q.name}`.trim(), priceCents: Math.round(Number(q.custom_price ?? q.price) * 100),
          minDays: range?.min ?? days, maxDays: range?.max ?? days, isDemo: false, note: null,
        };
      }).sort((a, b) => a.priceCents - b.priceCents);
      const result: ShippingQuoteResult = { configured: true, options, message: options.length ? null : 'Nenhuma transportadora atende este CEP para este pacote.' };
      quoteCache.set(key, { at: Date.now(), result });
      return result;
    } catch (e) {
      logError('error', 'shipping:melhorenvio', e, { cep });
      return { configured: true, options: [], message: 'Não foi possível calcular o frete agora. Tente novamente em instantes.' };
    }
  }

  const rules = getDb().all<{ id: number; name: string; price_cents: number; min_days: number; max_days: number; free_above_cents: number | null }>(
    'SELECT * FROM shipping_rules WHERE is_active = 1 AND ? BETWEEN cep_start AND cep_end ORDER BY position, price_cents',
    cep,
  );
  const anyRule = getDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM shipping_rules WHERE is_active = 1')!.n > 0;
  if (!anyRule) return { configured: false, options: [], message: 'O frete ainda não foi configurado pela loja.' };
  if (!rules.length) return { configured: true, options: [], message: 'Ainda não entregamos neste CEP.' };
  return {
    configured: true,
    message: null,
    options: rules.map((r) => ({
      id: `manual:${r.id}`,
      label: r.name,
      priceCents: r.free_above_cents !== null && subtotalCents >= r.free_above_cents ? 0 : r.price_cents,
      minDays: r.min_days,
      maxDays: r.max_days,
      isDemo: false,
      note: r.free_above_cents !== null ? `Grátis acima de R$ ${(r.free_above_cents / 100).toFixed(2).replace('.', ',')}` : null,
    })),
  };
}

export const daysText = (o: Pick<ShippingOptionDTO, 'minDays' | 'maxDays'>): string =>
  o.minDays === o.maxDays ? `${o.maxDays} dias úteis` : `${o.minDays} a ${o.maxDays} dias úteis`;
