import { env, features } from '../config.ts';
import { getDb } from '../db.ts';
import type { ShippingOptionDTO } from '../../shared/types.ts';
import { onlyDigits } from '../../shared/format.ts';

// Frete:
// - "manual": política operacional definida pelo administrador (faixas de CEP, valor e prazo) em /admin/frete.
// - "demo": opções SIMULADAS, claramente identificadas, apenas em desenvolvimento (bloqueado em produção).
// Integrações com transportadoras/agregadores podem ser adicionadas implementando `quote()` com a mesma assinatura.

export interface ShippingQuoteResult {
  configured: boolean;
  options: ShippingOptionDTO[];
  message: string | null;
}

export const validCep = (cep: string): boolean => /^\d{8}$/.test(onlyDigits(cep)) && !/^0{8}$/.test(onlyDigits(cep));

export function quoteShipping(cepInput: string, subtotalCents: number): ShippingQuoteResult {
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
