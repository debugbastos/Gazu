import { getDb, nowIso } from '../db.ts';
import type { CartLineDTO } from '../../shared/types.ts';

export interface CouponRow {
  id: number; code: string; description: string; discount_type: 'percent' | 'fixed'; value: number; min_order_cents: number;
  starts_at: string | null; ends_at: string | null; max_uses: number | null; max_uses_per_user: number | null; is_active: number; is_demo: number;
}

export interface CouponEvaluation {
  valid: boolean;
  discountCents: number;
  message: string | null;
  coupon: CouponRow | null;
}

const fail = (message: string, coupon: CouponRow | null = null): CouponEvaluation => ({ valid: false, discountCents: 0, message, coupon });

/** Valida um cupom no servidor e calcula o desconto sobre os itens elegíveis. */
export function evaluateCoupon(codeInput: string, lines: Pick<CartLineDTO, 'productId' | 'lineTotalCents'>[], subtotalCents: number, userId: string | null, now = nowIso()): CouponEvaluation {
  const code = codeInput.trim();
  if (!code || code.length > 40) return fail('Cupom inválido.');
  const db = getDb();
  const c = db.get<CouponRow>('SELECT * FROM coupons WHERE code = ?', code);
  if (!c || !c.is_active) return fail('Cupom inválido ou inativo.');
  if (c.starts_at && c.starts_at > now) return fail('Este cupom ainda não está válido.', c);
  if (c.ends_at && c.ends_at < now) return fail('Este cupom expirou.', c);
  if (subtotalCents < c.min_order_cents) return fail(`Pedido mínimo de R$ ${(c.min_order_cents / 100).toFixed(2).replace('.', ',')} para este cupom.`, c);
  if (c.max_uses !== null) {
    const used = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = ? AND status <> 'released'", c.id)!.n;
    if (used >= c.max_uses) return fail('Este cupom atingiu o limite de utilizações.', c);
  }
  if (c.max_uses_per_user !== null && userId) {
    const used = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ? AND status <> 'released'", c.id, userId)!.n;
    if (used >= c.max_uses_per_user) return fail('Você já utilizou este cupom o número máximo de vezes.', c);
  }
  // Restrições por categoria/produto
  const catIds = db.all<{ category_id: number }>('SELECT category_id FROM coupon_categories WHERE coupon_id = ?', c.id).map((r) => r.category_id);
  const prodIds = new Set(db.all<{ product_id: number }>('SELECT product_id FROM coupon_products WHERE coupon_id = ?', c.id).map((r) => r.product_id));
  let eligible = subtotalCents;
  if (catIds.length || prodIds.size) {
    const inCats = new Set<number>();
    if (catIds.length) {
      const all = db.all<{ product_id: number }>(
        `WITH RECURSIVE t(id) AS (SELECT id FROM categories WHERE id IN (${catIds.map(() => '?').join(',')}) UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id)
         SELECT DISTINCT product_id FROM product_categories WHERE category_id IN (SELECT id FROM t)`, ...catIds);
      for (const r of all) inCats.add(r.product_id);
    }
    eligible = lines.filter((l) => inCats.has(l.productId) || prodIds.has(l.productId)).reduce((s, l) => s + l.lineTotalCents, 0);
    if (eligible <= 0) return fail('Este cupom não se aplica aos produtos do carrinho.', c);
  }
  const discount = c.discount_type === 'percent' ? Math.floor((eligible * c.value) / 100) : Math.min(c.value, eligible);
  if (discount <= 0) return fail('Este cupom não gera desconto para este carrinho.', c);
  return { valid: true, discountCents: Math.min(discount, subtotalCents), message: c.is_demo ? 'Cupom de demonstração aplicado.' : 'Cupom aplicado.', coupon: c };
}
