import { getDb } from '../db.ts';
import { HttpError } from '../http.ts';
import type { FinanceSummaryDTO } from '../../shared/types.ts';

// Módulo financeiro. Todas as fórmulas estão documentadas em docs/FORMULAS-FINANCEIRAS.md.
// Regras:
// - Somente dados reais: pedidos de demonstração (is_demo = 1) nunca entram nos números.
// - Receita é reconhecida na data de APROVAÇÃO do pagamento pelo provedor (payments.approved_at).
// - Estornos entram na data em que o provedor CONFIRMOU (refunds.confirmed_at).
// - Custos ausentes não são estimados: o indicador fica nulo e o motivo aparece em "missing".

export interface Period { from: string; to: string }

/** Normaliza o período (datas YYYY-MM-DD, fuso de Brasília) para limites ISO em UTC. Fim exclusivo. */
export function parsePeriod(fromInput?: string | null, toInput?: string | null, now = new Date()): Period & { fromIso: string; toIso: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const to = toInput && re.test(toInput) ? toInput : today;
  const from = fromInput && re.test(fromInput) ? fromInput : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400_000).toISOString().slice(0, 10);
  if (from > to) throw new HttpError(400, 'Período inválido: a data inicial é posterior à final.', 'bad_period');
  if (Date.parse(to) - Date.parse(from) > 731 * 86400_000) throw new HttpError(400, 'Período máximo: 2 anos.', 'bad_period');
  // 00:00 em Brasília (UTC−3) = 03:00 UTC.
  const fromIso = new Date(Date.parse(`${from}T03:00:00Z`)).toISOString();
  const toIso = new Date(Date.parse(`${to}T03:00:00Z`) + 86400_000).toISOString();
  return { from, to, fromIso, toIso };
}

const PAID_STATES = "('approved','partially_refunded','refunded')";

export function financeSummary(fromInput?: string | null, toInput?: string | null): FinanceSummaryDTO {
  const db = getDb();
  const p = parsePeriod(fromInput, toInput);
  const missing: string[] = [];

  // Pedidos cujo pagamento foi aprovado no período (um pagamento aprovado por pedido).
  const paidOrders = db.all<{ id: number; subtotal_cents: number; discount_cents: number; shipping_cents: number; total_cents: number; packaging_cost_cents: number | null; method: string; amount_cents: number; fee_cents: number | null; approved_at: string }>(
    `SELECT o.id, o.subtotal_cents, o.discount_cents, o.shipping_cents, o.total_cents, o.packaging_cost_cents, pay.method, pay.amount_cents, pay.fee_cents, pay.approved_at
       FROM payments pay JOIN orders o ON o.id = pay.order_id
      WHERE pay.status IN ${PAID_STATES} AND pay.approved_at >= ? AND pay.approved_at < ? AND o.is_demo = 0 AND pay.provider <> 'demo'`,
    p.fromIso, p.toIso,
  );
  const ids = paidOrders.map((o) => o.id);
  const sum = (f: (o: (typeof paidOrders)[number]) => number) => paidOrders.reduce((n, o) => n + f(o), 0);

  const grossSalesCents = sum((o) => o.subtotal_cents);
  const discountsCents = sum((o) => o.discount_cents);
  const shippingChargedCents = sum((o) => o.shipping_cents);
  const paidRevenueCents = sum((o) => o.amount_cents);

  const refundsCents = db.get<{ n: number }>(
    `SELECT COALESCE(SUM(r.amount_cents), 0) AS n FROM refunds r JOIN orders o ON o.id = r.order_id JOIN payments pay ON pay.id = r.payment_id
      WHERE r.status = 'approved' AND r.confirmed_at >= ? AND r.confirmed_at < ? AND o.is_demo = 0 AND pay.provider <> 'demo'`, p.fromIso, p.toIso,
  )!.n;
  const netRevenueCents = paidRevenueCents - refundsCents;

  const feesKnown = paidOrders.every((o) => o.fee_cents !== null);
  const providerFeesCents = paidOrders.length === 0 ? 0 : feesKnown ? sum((o) => o.fee_cents ?? 0) : null;
  if (!feesKnown) missing.push(`Taxa do provedor ausente em ${paidOrders.filter((o) => o.fee_cents === null).length} pagamento(s) (sincronize com o provedor).`);

  let productCostCents: number | null = 0;
  let shippingCostCents: number | null = 0;
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const items = db.get<{ total: number; known: number; missing: number }>(
      `SELECT COALESCE(SUM(CASE WHEN unit_cost_cents IS NOT NULL THEN unit_cost_cents * quantity END), 0) AS known, COUNT(*) AS total, SUM(unit_cost_cents IS NULL) AS missing FROM order_items WHERE order_id IN (${ph})`, ...ids,
    )!;
    productCostCents = items.missing ? null : items.known;
    if (items.missing) missing.push(`Custo do produto não cadastrado em ${items.missing} de ${items.total} item(ns) vendido(s).`);
    const ships = db.all<{ order_id: number; cost: number | null }>(
      `SELECT o.id AS order_id, (SELECT SUM(s.cost_cents) FROM shipments s WHERE s.order_id = o.id AND s.status <> 'cancelled') AS cost,
              (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.status <> 'cancelled' AND s.cost_cents IS NULL) AS unknown
         FROM orders o WHERE o.id IN (${ph})`, ...ids,
    ) as { order_id: number; cost: number | null; unknown?: number }[];
    const unknownShip = ships.filter((s) => s.cost === null || (s.unknown ?? 0) > 0).length;
    shippingCostCents = unknownShip ? null : ships.reduce((n, s) => n + (s.cost ?? 0), 0);
    if (unknownShip) missing.push(`Custo de frete não registrado em ${unknownShip} pedido(s) (informe no envio).`);
  }
  const packKnown = paidOrders.every((o) => o.packaging_cost_cents !== null);
  const packagingCostCents = paidOrders.length === 0 ? 0 : packKnown ? sum((o) => o.packaging_cost_cents ?? 0) : null;
  if (!packKnown) missing.push('Custo de embalagem não informado em parte dos pedidos (Configurações › Operação).');

  const expensesCents = db.get<{ n: number }>('SELECT COALESCE(SUM(amount_cents), 0) AS n FROM expenses WHERE deleted_at IS NULL AND incurred_on >= ? AND incurred_on <= ?', p.from, p.to)!.n;

  const parts = [providerFeesCents, productCostCents, shippingCostCents, packagingCostCents];
  const estimatedProfitCents = parts.some((x) => x === null) ? null : netRevenueCents - parts.reduce<number>((n, x) => n + (x ?? 0), 0) - expensesCents;
  const averageTicketCents = paidOrders.length ? Math.round(paidRevenueCents / paidOrders.length) : null;
  const marginPercent = estimatedProfitCents !== null && netRevenueCents > 0 ? Math.round((estimatedProfitCents / netRevenueCents) * 1000) / 10 : null;

  const cancelledCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE is_demo = 0 AND cancelled_at >= ? AND cancelled_at < ?', p.fromIso, p.toIso)!.n;
  const refundedCount = db.get<{ n: number }>(`SELECT COUNT(DISTINCT r.order_id) AS n FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.status = 'approved' AND r.confirmed_at >= ? AND r.confirmed_at < ? AND o.is_demo = 0`, p.fromIso, p.toIso)!.n;

  const byDayMap = new Map<string, { paidRevenueCents: number; orders: number }>();
  const byMethodMap = new Map<string, { paidRevenueCents: number; orders: number }>();
  for (const o of paidOrders) {
    const day = new Date(Date.parse(o.approved_at) - 3 * 3600_000).toISOString().slice(0, 10);
    const d = byDayMap.get(day) ?? { paidRevenueCents: 0, orders: 0 };
    d.paidRevenueCents += o.amount_cents; d.orders++; byDayMap.set(day, d);
    const m = byMethodMap.get(o.method) ?? { paidRevenueCents: 0, orders: 0 };
    m.paidRevenueCents += o.amount_cents; m.orders++; byMethodMap.set(o.method, m);
  }
  return {
    period: { from: p.from, to: p.to },
    orders: { paidCount: paidOrders.length, cancelledCount, refundedCount },
    grossSalesCents, discountsCents, shippingChargedCents, paidRevenueCents, refundsCents, netRevenueCents,
    providerFeesCents, productCostCents, shippingCostCents, packagingCostCents, expensesCents,
    estimatedProfitCents, averageTicketCents, marginPercent, missing,
    byDay: [...byDayMap.entries()].sort().map(([day, v]) => ({ day, ...v })),
    byMethod: [...byMethodMap.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.paidRevenueCents - a.paidRevenueCents),
    expensesByCategory: db.all<{ category: string; amountCents: number }>('SELECT category, SUM(amount_cents) AS amountCents FROM expenses WHERE deleted_at IS NULL AND incurred_on >= ? AND incurred_on <= ? GROUP BY category ORDER BY amountCents DESC', p.from, p.to),
  };
}

/** Margem por produto no período (somente itens com custo cadastrado entram na margem). */
export function productMargins(fromInput?: string | null, toInput?: string | null) {
  const p = parsePeriod(fromInput, toInput);
  return getDb().all<{ productId: number; name: string; units: number; revenueCents: number; costCents: number | null; itemsWithoutCost: number }>(
    `SELECT i.product_id AS productId, i.product_name AS name, SUM(i.quantity) AS units, SUM(i.line_total_cents) AS revenueCents,
            CASE WHEN SUM(i.unit_cost_cents IS NULL) = 0 THEN SUM(i.unit_cost_cents * i.quantity) END AS costCents, SUM(i.unit_cost_cents IS NULL) AS itemsWithoutCost
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN payments pay ON pay.order_id = o.id AND pay.status IN ${PAID_STATES}
      WHERE pay.approved_at >= ? AND pay.approved_at < ? AND o.is_demo = 0 AND pay.provider <> 'demo'
      GROUP BY i.product_id, i.product_name ORDER BY revenueCents DESC LIMIT 100`, p.fromIso, p.toIso,
  ).map((r) => ({ ...r, marginPercent: r.costCents !== null && r.revenueCents > 0 ? Math.round(((r.revenueCents - r.costCents) / r.revenueCents) * 1000) / 10 : null }));
}

/** Vendas por categoria principal do produto no período (unidades e receita de itens; mesma base da margem por produto). */
export function categorySales(fromInput?: string | null, toInput?: string | null) {
  const p = parsePeriod(fromInput, toInput);
  return getDb().all<{ categoryId: number | null; name: string; units: number; revenueCents: number }>(
    `SELECT c.id AS categoryId, COALESCE(c.name, 'Sem categoria') AS name, SUM(i.quantity) AS units, SUM(i.line_total_cents) AS revenueCents
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN payments pay ON pay.order_id = o.id AND pay.status IN ${PAID_STATES}
       LEFT JOIN products pr ON pr.id = i.product_id LEFT JOIN categories c ON c.id = pr.primary_category_id
      WHERE pay.approved_at >= ? AND pay.approved_at < ? AND o.is_demo = 0 AND pay.provider <> 'demo'
      GROUP BY c.id ORDER BY revenueCents DESC LIMIT 50`, p.fromIso, p.toIso,
  );
}

/**
 * Histórico de movimentações financeiras do período, em ordem cronológica:
 * entradas = pagamentos aprovados pelo provedor; saídas = estornos confirmados, taxas do provedor e despesas lançadas.
 */
export function financialMovements(fromInput?: string | null, toInput?: string | null) {
  const p = parsePeriod(fromInput, toInput);
  const db = getDb();
  type Mov = { at: string; kind: 'payment' | 'fee' | 'refund' | 'expense'; description: string; amountCents: number; ref: string | null };
  const out: Mov[] = [];
  for (const r of db.all<{ approved_at: string; amount_cents: number; fee_cents: number | null; method: string; number: string }>(
    `SELECT pay.approved_at, pay.amount_cents, pay.fee_cents, pay.method, o.number FROM payments pay JOIN orders o ON o.id = pay.order_id
      WHERE pay.status IN ${PAID_STATES} AND pay.approved_at >= ? AND pay.approved_at < ? AND o.is_demo = 0 AND pay.provider <> 'demo'`, p.fromIso, p.toIso,
  )) {
    out.push({ at: r.approved_at, kind: 'payment', description: `Pagamento aprovado (${r.method})`, amountCents: r.amount_cents, ref: r.number });
    if (r.fee_cents) out.push({ at: r.approved_at, kind: 'fee', description: 'Taxa do provedor', amountCents: -r.fee_cents, ref: r.number });
  }
  for (const r of db.all<{ confirmed_at: string; amount_cents: number; number: string; reason: string | null }>(
    `SELECT r.confirmed_at, r.amount_cents, o.number, r.reason FROM refunds r JOIN orders o ON o.id = r.order_id JOIN payments pay ON pay.id = r.payment_id
      WHERE r.status = 'approved' AND r.confirmed_at >= ? AND r.confirmed_at < ? AND o.is_demo = 0 AND pay.provider <> 'demo'`, p.fromIso, p.toIso,
  )) out.push({ at: r.confirmed_at, kind: 'refund', description: `Estorno confirmado${r.reason ? ` — ${r.reason}` : ''}`, amountCents: -r.amount_cents, ref: r.number });
  for (const r of db.all<{ incurred_on: string; amount_cents: number; category: string; description: string }>(
    'SELECT incurred_on, amount_cents, category, description FROM expenses WHERE deleted_at IS NULL AND incurred_on >= ? AND incurred_on <= ?', p.from, p.to,
  )) out.push({ at: `${r.incurred_on}T15:00:00.000Z`, kind: 'expense', description: `Despesa (${r.category}) — ${r.description}`, amountCents: -r.amount_cents, ref: null });
  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(-1000);
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  // Evita injeção de fórmulas em planilhas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const money = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));

/** Exportação CSV (separador ";" e vírgula decimal, padrão de planilhas em pt-BR). */
export function financeCsv(fromInput?: string | null, toInput?: string | null): string {
  const p = parsePeriod(fromInput, toInput);
  const rows = getDb().all<Record<string, unknown>>(
    `SELECT o.number, pay.approved_at, pay.method, pay.installments, o.subtotal_cents, o.discount_cents, o.shipping_cents, o.total_cents, pay.amount_cents, pay.fee_cents, pay.net_received_cents,
            pay.refunded_cents, o.status, o.packaging_cost_cents,
            (SELECT CASE WHEN SUM(unit_cost_cents IS NULL) = 0 THEN SUM(unit_cost_cents * quantity) END FROM order_items WHERE order_id = o.id) AS product_cost,
            (SELECT SUM(cost_cents) FROM shipments WHERE order_id = o.id AND status <> 'cancelled') AS shipping_cost, o.utm_source, o.utm_campaign
       FROM payments pay JOIN orders o ON o.id = pay.order_id
      WHERE pay.status IN ${PAID_STATES} AND pay.approved_at >= ? AND pay.approved_at < ? AND o.is_demo = 0 AND pay.provider <> 'demo' ORDER BY pay.approved_at`, p.fromIso, p.toIso,
  );
  const head = ['pedido', 'aprovado_em', 'metodo', 'parcelas', 'produtos', 'descontos', 'frete_cobrado', 'total_pedido', 'valor_pago', 'taxa_provedor', 'liquido_provedor', 'estornado', 'status_pedido', 'custo_embalagem', 'custo_produtos', 'custo_frete', 'utm_source', 'utm_campaign'];
  const lines = [head.join(';'), ...rows.map((r) => [
    r.number, r.approved_at, r.method, r.installments, money(r.subtotal_cents as number), money(r.discount_cents as number), money(r.shipping_cents as number), money(r.total_cents as number),
    money(r.amount_cents as number), money(r.fee_cents as number | null), money(r.net_received_cents as number | null), money(r.refunded_cents as number), r.status,
    money(r.packaging_cost_cents as number | null), money(r.product_cost as number | null), money(r.shipping_cost as number | null), r.utm_source, r.utm_campaign,
  ].map(csvCell).join(';'))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
