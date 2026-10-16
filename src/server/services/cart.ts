import { getDb, nowIso } from '../db.ts';
import type { CartItemInput, CartLineDTO, CartQuoteDTO, CouponResultDTO, ImageDTO, ShippingOptionDTO } from '../../shared/types.ts';
import { variantUnitPrice } from './catalog.ts';
import { evaluateCoupon } from './coupons.ts';
import { quoteShipping } from './shipping.ts';

export const MAX_QTY_PER_LINE = 20;
export const MAX_LINES = 50;

interface JoinedRow {
  variant_id: number; sku: string; color_name: string; size: string; v_price: number | null; stock: number; v_active: number;
  product_id: number; slug: string; name: string; price_cents: number; promo_price_cents: number | null; promo_starts_at: string | null; promo_ends_at: string | null;
  p_active: number; is_demo: number;
}

/** Normaliza a lista: remove inválidos, soma duplicados e limita quantidades. */
export function normalizeItems(items: CartItemInput[]): CartItemInput[] {
  const map = new Map<number, number>();
  for (const it of items) {
    if (!Number.isSafeInteger(it.variantId) || it.variantId <= 0) continue;
    const q = Math.floor(Number(it.quantity));
    if (!Number.isFinite(q) || q <= 0) continue;
    map.set(it.variantId, Math.min(MAX_QTY_PER_LINE, (map.get(it.variantId) ?? 0) + q));
  }
  return [...map.entries()].slice(0, MAX_LINES).map(([variantId, quantity]) => ({ variantId, quantity }));
}

/** Constrói as linhas do carrinho com preços e estoque lidos do banco (nunca do navegador). */
export function buildLines(itemsInput: CartItemInput[]): CartLineDTO[] {
  const items = normalizeItems(itemsInput);
  if (!items.length) return [];
  const db = getDb();
  const ids = items.map((i) => i.variantId);
  const rows = db.all<JoinedRow>(
    `SELECT v.id AS variant_id, v.sku, v.color_name, v.size, v.price_cents AS v_price, v.stock, v.is_active AS v_active,
            p.id AS product_id, p.slug, p.name, p.price_cents, p.promo_price_cents, p.promo_starts_at, p.promo_ends_at, p.is_active AS p_active, p.is_demo
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  const byId = new Map(rows.map((r) => [r.variant_id, r]));
  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const images = new Map<number, ImageDTO>();
  const siblings = new Map<number, CartLineDTO['variants']>();
  if (productIds.length) {
    const ph = productIds.map(() => '?').join(',');
    for (const im of db.all<{ product_id: number; url: string; srcset: string | null; width: number | null; height: number | null; alt: string; object_position: string; color_name: string | null }>(
      `SELECT * FROM product_images WHERE product_id IN (${ph}) ORDER BY position`, ...productIds)) {
      if (!images.has(im.product_id)) images.set(im.product_id, { url: im.url, srcset: im.srcset, width: im.width, height: im.height, alt: im.alt, position: im.object_position, colorName: im.color_name });
    }
    for (const v of db.all<{ id: number; product_id: number; color_name: string; size: string; stock: number }>(
      `SELECT id, product_id, color_name, size, stock FROM product_variants WHERE is_active = 1 AND product_id IN (${ph}) ORDER BY color_name, size_order`, ...productIds)) {
      if (!siblings.has(v.product_id)) siblings.set(v.product_id, []);
      siblings.get(v.product_id)!.push({ id: v.id, colorName: v.color_name, size: v.size, stock: v.stock });
    }
  }
  const now = nowIso();
  const lines: CartLineDTO[] = [];
  for (const it of items) {
    const r = byId.get(it.variantId);
    if (!r) continue; // variante inexistente: descartada silenciosamente
    const price = variantUnitPrice(r, { price_cents: r.v_price });
    void now;
    const unavailable = !r.p_active || !r.v_active;
    const issue = unavailable ? 'unavailable' : r.stock <= 0 ? 'out_of_stock' : r.stock < it.quantity ? 'insufficient_stock' : null;
    lines.push({
      variantId: r.variant_id,
      productId: r.product_id,
      productSlug: r.slug,
      name: r.name,
      colorName: r.color_name,
      size: r.size,
      image: images.get(r.product_id) ?? null,
      unitPriceCents: price.unit,
      originalPriceCents: price.original,
      quantity: it.quantity,
      lineTotalCents: price.unit * it.quantity,
      stock: Math.max(0, r.stock),
      issue,
      isDemo: Boolean(r.is_demo),
      variants: siblings.get(r.product_id) ?? [],
    });
  }
  return lines;
}

export interface QuoteInput {
  items: CartItemInput[];
  couponCode?: string | null;
  userId?: string | null;
  cep?: string | null;
  shippingOptionId?: string | null;
}

export function quoteCart(input: QuoteInput): CartQuoteDTO & { shippingOptions: ShippingOptionDTO[]; shippingMessage: string | null; shippingConfigured: boolean } {
  const lines = buildLines(input.items);
  const purchasable = lines.filter((l) => !l.issue);
  const subtotal = purchasable.reduce((s, l) => s + l.lineTotalCents, 0);
  let coupon: CouponResultDTO | null = null;
  let discount = 0;
  if (input.couponCode && input.couponCode.trim()) {
    const ev = evaluateCoupon(input.couponCode, purchasable, subtotal, input.userId ?? null);
    coupon = { code: input.couponCode.trim().toUpperCase(), description: ev.coupon?.description ?? '', discountCents: ev.discountCents, valid: ev.valid, message: ev.message };
    if (ev.valid) discount = ev.discountCents;
  }
  let shipping: ShippingOptionDTO | null = null;
  let shippingOptions: ShippingOptionDTO[] = [];
  let shippingMessage: string | null = null;
  let shippingConfigured = true;
  if (input.cep) {
    const q = quoteShipping(input.cep, subtotal - discount);
    shippingOptions = q.options;
    shippingMessage = q.message;
    shippingConfigured = q.configured;
    shipping = q.options.find((o) => o.id === input.shippingOptionId) ?? null;
  }
  const shippingCents = shipping?.priceCents ?? 0;
  return {
    lines,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    subtotalCents: subtotal,
    coupon,
    discountCents: discount,
    shipping,
    shippingCents,
    totalCents: Math.max(0, subtotal - discount) + shippingCents,
    hasIssues: lines.some((l) => l.issue !== null),
    shippingOptions,
    shippingMessage,
    shippingConfigured,
  };
}

// ---- Carrinho persistido para clientes autenticados ----

export function getUserCartItems(userId: string): CartItemInput[] {
  return getDb().all<{ variant_id: number; quantity: number }>(
    'SELECT ci.variant_id, ci.quantity FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = ? ORDER BY ci.added_at', userId,
  ).map((r) => ({ variantId: r.variant_id, quantity: r.quantity }));
}

export function setUserCartItems(userId: string, items: CartItemInput[]): void {
  const db = getDb();
  const clean = normalizeItems(items);
  db.tx(() => {
    db.run('INSERT INTO carts (user_id) VALUES (?) ON CONFLICT(user_id) DO UPDATE SET updated_at = ?', userId, nowIso());
    const cart = db.get<{ id: number }>('SELECT id FROM carts WHERE user_id = ?', userId)!;
    db.run('DELETE FROM cart_items WHERE cart_id = ?', cart.id);
    const existing = new Set(clean.length ? db.all<{ id: number }>(`SELECT id FROM product_variants WHERE id IN (${clean.map(() => '?').join(',')})`, ...clean.map((c) => c.variantId)).map((r) => r.id) : []);
    for (const it of clean) if (existing.has(it.variantId)) db.run('INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES (?, ?, ?)', cart.id, it.variantId, it.quantity);
  });
}

/**
 * Estratégia de mesclagem ao entrar na conta: para a mesma variante, mantém a MAIOR quantidade
 * (não soma), evitando duplicar itens que já tinham sido adicionados em outro dispositivo.
 */
export function mergeCarts(userId: string, guestItems: CartItemInput[]): CartItemInput[] {
  const merged = new Map<number, number>();
  for (const it of getUserCartItems(userId)) merged.set(it.variantId, it.quantity);
  for (const it of normalizeItems(guestItems)) merged.set(it.variantId, Math.max(merged.get(it.variantId) ?? 0, it.quantity));
  const items = [...merged.entries()].map(([variantId, quantity]) => ({ variantId, quantity }));
  setUserCartItems(userId, items);
  return getUserCartItems(userId);
}
