// "Servidor" da versão HTML autônoma (index.html).
// Porta para o navegador as mesmas regras de src/server (catálogo, filtros, sacola, cupons, frete simulado,
// pedidos com reserva de estoque, pagamento SIMULADO, conta do cliente e painel), guardando os dados
// no armazenamento local do navegador. Não há servidor, banco real, e-mail nem cobrança: é uma demonstração.
import { z, ZodError } from 'zod';
import { AUDIENCE_LABEL, ORDER_STATUS_LABEL, onlyDigits, UF } from '../shared/format';
import type {
  AddressDTO, BreadcrumbDTO, CartItemInput, CartLineDTO, CatalogResultDTO, CategoryDTO, ColorDTO, CouponResultDTO, FacetValue, ImageDTO, MeDTO,
  OrderDTO, PaymentDTO, ProductCardDTO, ProductDetailDTO, PublicConfigDTO, ShippingOptionDTO, VariantDTO,
} from '../shared/types';

// ---------------------------------------------------------------- tipos das "tabelas"
export interface ProductRow { id: number; slug: string; name: string; description: string; details: string | null; audience: ProductCardDTO['audience']; product_type: string; primary_category_id: number | null; price_cents: number; promo_price_cents: number | null; promo_starts_at: string | null; promo_ends_at: string | null; is_active: number; is_featured: number; is_demo: number; color_confirmed: number; seo_title: string | null; seo_description: string | null; created_at: string; updated_at: string }
export interface ImageRow { id: number; product_id: number; url: string; srcset: string | null; width: number | null; height: number | null; alt: string; color_name: string | null; object_position: string; position: number }
export interface VariantRow { id: number; product_id: number; sku: string; color_name: string; color_hex: string | null; size: string; size_order: number; price_cents: number | null; stock: number; is_active: number }
export interface CategoryRow { id: number; slug: string; name: string; description: string | null; parent_id: number | null; position: number; is_active: number; image_url: string | null }
export interface CouponRow { id: number; code: string; description: string; discount_type: 'percent' | 'fixed'; value: number; min_order_cents: number; starts_at: string | null; ends_at: string | null; max_uses: number | null; max_uses_per_user: number | null; is_active: number; is_demo: number; created_at: string; category_ids: number[]; product_ids: number[] }
interface ShippingRuleRow { id: number; name: string; cep_start: string; cep_end: string; price_cents: number; min_days: number; max_days: number; free_above_cents: number | null; is_active: number; position: number }
interface UserRow { id: string; email: string; password_hash: string; role: 'customer' | 'admin'; name: string; phone: string | null; email_verified_at: string | null; created_at: string }
interface AddressRow { id: number; user_id: string; label: string; recipient: string; cep: string; street: string; number: string; complement: string | null; district: string; city: string; state: string; is_default: number }
interface OrderRow { id: number; number: string; user_id: string; status: OrderDTO['status']; subtotal_cents: number; discount_cents: number; shipping_cents: number; total_cents: number; coupon_id: number | null; coupon_code: string | null; shipping_label: string; shipping_days_text: string | null; shipping_is_demo: number; ship_recipient: string; ship_cep: string; ship_street: string; ship_number: string; ship_complement: string | null; ship_district: string; ship_city: string; ship_state: string; tracking_code: string | null; tracking_url: string | null; is_demo: number; expires_at: string | null; stock_released: number; created_at: string }
interface OrderItemRow { id: number; order_id: number; product_id: number; variant_id: number; sku: string; product_name: string; product_slug: string; color_name: string; size: string; image_url: string | null; unit_price_cents: number; quantity: number; line_total_cents: number }
interface PaymentRow { id: number; order_id: number; provider: 'demo'; method: 'demo'; status: PaymentDTO['status']; status_detail: string | null; amount_cents: number; expires_at: string | null; created_at: string }
interface EventRow { id: number; order_id: number; type: string; message: string; actor: string; created_at: string }
interface MovementRow { id: number; variant_id: number; delta: number; reason: string; order_id: number | null; actor: string; note: string | null; created_at: string }
interface RedemptionRow { id: number; coupon_id: number; order_id: number; user_id: string; discount_cents: number; status: 'reserved' | 'confirmed' | 'released' }
interface AuditRow { id: number; actor: string; action: string; entity: string; entity_id: string; created_at: string }

export interface Settings {
  announcements: string[]; heroTagline: string[]; heroCollectionLabel: string[]; showAccessoriesOnHome: boolean;
  contact: { email: string; phone: string; whatsapp: string; serviceHours: string };
  company: { legalName: string; cnpj: string; address: string };
  social: { instagram: string; tiktok: string; facebook: string };
}

export interface SeedData {
  categories: CategoryRow[]; products: ProductRow[]; product_categories: { product_id: number; category_id: number }[]; product_images: ImageRow[];
  product_variants: VariantRow[]; coupons: CouponRow[]; shipping_rules: ShippingRuleRow[]; settings: Settings;
}

interface State extends SeedData {
  version: number;
  seq: Record<string, number>;
  users: UserRow[]; sessionUserId: string | null;
  carts: Record<string, CartItemInput[]>; favorites: Record<string, number[]>;
  addresses: AddressRow[]; orders: OrderRow[]; order_items: OrderItemRow[]; payments: PaymentRow[]; order_events: EventRow[];
  inventory_movements: MovementRow[]; coupon_redemptions: RedemptionRow[]; audit_log: AuditRow[];
}

// ---------------------------------------------------------------- infraestrutura
const STORAGE_KEY = 'gazu.standalone.v1';
export const DEMO_ADMIN = { email: 'admin@gazu.demo', password: 'gazu2026' };
const ORDER_WINDOW_MIN = 60;

export class HttpErr extends Error {
  constructor(readonly status: number, message: string, readonly code = 'error', readonly details?: unknown) { super(message); }
}

let S: State;
let resolveAsset: (u: string) => string = (u) => u;
const nowIso = () => new Date().toISOString();
const nextId = (t: string) => (S.seq[t] = (S.seq[t] ?? 0) + 1);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function persist(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); }
  catch { throw new HttpErr(507, 'O armazenamento deste navegador está cheio. Remova imagens enviadas ou limpe os dados de demonstração.', 'storage_full'); }
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
  return `${salt}$${await sha256(salt + pw)}`;
}
async function verifyPassword(pw: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false;
  const [salt, h] = stored.split('$');
  return (await sha256(salt + pw)) === h;
}
const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** Inicializa o banco local: usa os dados salvos neste navegador ou cria a partir do catálogo embutido. */
export async function initBackend(seed: SeedData, assetResolver: (u: string) => string): Promise<void> {
  resolveAsset = assetResolver;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { const parsed = JSON.parse(raw) as State; if (parsed.version === 1) { S = parsed; return; } }
  } catch { /* dados corrompidos: recria */ }
  S = {
    ...clone(seed), version: 1, seq: {}, users: [], sessionUserId: null, carts: {}, favorites: {}, addresses: [], orders: [], order_items: [], payments: [],
    order_events: [], inventory_movements: [], coupon_redemptions: [], audit_log: [],
  };
  const max = (rows: { id: number }[]) => rows.reduce((m, r) => Math.max(m, r.id), 0);
  S.seq = { categories: max(S.categories), products: max(S.products), product_images: max(S.product_images), product_variants: max(S.product_variants), coupons: max(S.coupons), shipping_rules: max(S.shipping_rules) };
  S.users.push({ id: randomId(), email: DEMO_ADMIN.email, password_hash: await hashPassword(DEMO_ADMIN.password), role: 'admin', name: 'Administrador (demonstração)', phone: null, email_verified_at: nowIso(), created_at: nowIso() });
  try { persist(); } catch { /* sem armazenamento: funciona só em memória */ }
}

export function resetDemoData(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignorado */ }
}

// ---------------------------------------------------------------- catálogo
const img = (u: string | null | undefined): string | null => (u ? resolveAsset(u) : null);
const toImage = (r: ImageRow): ImageDTO => ({ url: img(r.url)!, srcset: null, width: r.width, height: r.height, alt: r.alt, position: r.object_position, colorName: r.color_name });
const toCategory = (r: CategoryRow): CategoryDTO => ({ id: r.id, slug: r.slug, name: r.name, description: r.description, imageUrl: img(r.image_url), parentId: r.parent_id, position: r.position, isActive: Boolean(r.is_active) });

function activePromo(p: ProductRow, now = nowIso()): number | null {
  if (!p.promo_price_cents || p.promo_price_cents >= p.price_cents) return null;
  if (p.promo_starts_at && p.promo_starts_at > now) return null;
  if (p.promo_ends_at && p.promo_ends_at < now) return null;
  return p.promo_price_cents;
}
const effectivePrice = (p: ProductRow) => activePromo(p) ?? p.price_cents;
function variantUnitPrice(p: ProductRow, v: Pick<VariantRow, 'price_cents'>): { unit: number; original: number } {
  if (v.price_cents) return { unit: v.price_cents, original: v.price_cents };
  return { unit: effectivePrice(p), original: p.price_cents };
}
const productById = (id: number) => S.products.find((p) => p.id === id);
const catsOf = (productId: number) => S.product_categories.filter((pc) => pc.product_id === productId).map((pc) => pc.category_id);
const activeVariants = (productId: number) => S.product_variants.filter((v) => v.product_id === productId && v.is_active).sort((a, b) => a.size_order - b.size_order);
const imagesOf = (productId: number) => S.product_images.filter((i) => i.product_id === productId).sort((a, b) => a.position - b.position);

function descendantIds(rootId: number, activeOnly = true): number[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) for (const c of S.categories) if (c.parent_id === out[i] && (!activeOnly || c.is_active)) out.push(c.id);
  return out;
}
function categoryChain(id: number | null): CategoryRow[] {
  const chain: CategoryRow[] = [];
  let cur = id;
  for (let g = 0; cur && g < 6; g++) { const row = S.categories.find((c) => c.id === cur); if (!row) break; chain.unshift(row); cur = row.parent_id; }
  return chain;
}
const crumbs = (chain: CategoryRow[]): BreadcrumbDTO[] => [{ name: 'Início', href: '/' }, ...chain.map((c) => ({ name: c.name, href: `/categoria/${c.slug}` }))];

function productCount(catIds: number[]): number {
  const set = new Set(catIds);
  return new Set(S.product_categories.filter((pc) => set.has(pc.category_id) && productById(pc.product_id)?.is_active).map((pc) => pc.product_id)).size;
}
function listCategories(includeInactive = false): CategoryDTO[] {
  return S.categories.filter((c) => includeInactive || c.is_active).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((c) => ({ ...toCategory(c), productCount: productCount([c.id]) }));
}
function categoryTree(includeInactive = false): CategoryDTO[] {
  const flat = listCategories(includeInactive);
  const byId = new Map(flat.map((c) => [c.id, { ...c, children: [] as CategoryDTO[] }]));
  const roots: CategoryDTO[] = [];
  for (const c of byId.values()) {
    if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId)!.children!.push(c);
    else if (!c.parentId) roots.push(c);
  }
  for (const r of roots) r.productCount = productCount([r.id, ...(r.children ?? []).map((c) => c.id)]);
  return roots;
}

function cardsFor(rows: ProductRow[]): ProductCardDTO[] {
  return rows.map((r) => {
    const vs = activeVariants(r.id);
    const colors = new Map<string, ColorDTO>();
    for (const v of vs) colors.set(v.color_name, { name: v.color_name, hex: v.color_hex });
    const first = imagesOf(r.id)[0];
    return {
      id: r.id, slug: r.slug, name: r.name, type: r.product_type, audience: r.audience, priceCents: r.price_cents, promoPriceCents: activePromo(r),
      image: first ? toImage(first) : null, colors: [...colors.values()], available: vs.reduce((s, v) => s + v.stock, 0) > 0, isDemo: Boolean(r.is_demo), createdAt: r.created_at,
    };
  });
}

interface CatalogQuery { category?: string; q?: string; audience?: string[]; size?: string[]; color?: string[]; type?: string[]; minPrice?: number; maxPrice?: number; inStock?: boolean; sort?: string; page?: number; perPage?: number }

function parseCatalogQuery(sp: URLSearchParams): CatalogQuery {
  const list = (v: string | null) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) : undefined);
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  const s = sp.get('ordem');
  return {
    category: sp.get('categoria') ?? undefined, q: sp.get('q')?.slice(0, 80) ?? undefined, audience: list(sp.get('publico')), size: list(sp.get('tamanho')), color: list(sp.get('cor')), type: list(sp.get('tipo')),
    minPrice: num(sp.get('min')), maxPrice: num(sp.get('max')), inStock: sp.get('estoque') === '1',
    sort: s === 'menor-preco' ? 'price_asc' : s === 'maior-preco' ? 'price_desc' : s === 'recentes' ? 'newest' : 'relevance', page: num(sp.get('pagina')), perPage: num(sp.get('por_pagina')),
  };
}

function searchCatalog(q: CatalogQuery): CatalogResultDTO {
  const perPage = Math.min(Math.max(q.perPage ?? 24, 1), 60);
  const page = Math.max(q.page ?? 1, 1);
  let category: CatalogResultDTO['category'] = null;
  let base = S.products.filter((p) => p.is_active);
  if (q.category && q.category !== 'novidades') {
    const cat = S.categories.find((c) => c.slug === q.category && c.is_active);
    if (!cat) return { items: [], total: 0, page, perPage, pages: 1, facets: { audience: [], size: [], color: [], type: [], price: { min: 0, max: 0 } }, category: null };
    const ids = new Set(descendantIds(cat.id));
    base = base.filter((p) => catsOf(p.id).some((c) => ids.has(c)));
    const subs = S.categories.filter((c) => c.parent_id === cat.id && c.is_active).sort((a, b) => a.position - b.position);
    category = { ...toCategory(cat), breadcrumbs: crumbs(categoryChain(cat.id)), subcategories: subs.map(toCategory) };
  } else if (q.category === 'novidades') {
    category = { id: 0, slug: 'novidades', name: 'Novidades', description: 'As peças mais recentes da GAZU.', imageUrl: null, parentId: null, position: 0, isActive: true, breadcrumbs: [{ name: 'Início', href: '/' }, { name: 'Novidades', href: '/categoria/novidades' }], subcategories: [] };
  }
  const tokens = q.q ? norm(q.q).split(/\s+/).filter(Boolean).slice(0, 8) : [];
  if (tokens.length) {
    base = base.filter((p) => {
      const catNames = catsOf(p.id).map((id) => S.categories.find((c) => c.id === id)?.name ?? '');
      const vs = S.product_variants.filter((v) => v.product_id === p.id);
      const hay = norm([p.name, p.description, p.product_type, ...catNames, ...vs.map((v) => `${v.color_name} ${v.sku}`)].join(' '));
      return tokens.every((t) => hay.includes(t));
    });
  }
  let rows = base;
  if (q.audience?.length) rows = rows.filter((p) => q.audience!.includes(p.audience));
  if (q.type?.length) rows = rows.filter((p) => q.type!.includes(p.product_type));
  if (q.size?.length || q.color?.length || q.inStock) {
    rows = rows.filter((p) => activeVariants(p.id).some((v) => (!q.size?.length || q.size.includes(v.size)) && (!q.color?.length || q.color.includes(v.color_name)) && (!q.inStock || v.stock > 0)));
  }
  if (q.minPrice !== undefined) rows = rows.filter((p) => effectivePrice(p) >= q.minPrice!);
  if (q.maxPrice !== undefined) rows = rows.filter((p) => effectivePrice(p) <= q.maxPrice!);
  rows = [...rows].sort(
    q.sort === 'price_asc' ? (a, b) => effectivePrice(a) - effectivePrice(b) || a.id - b.id
    : q.sort === 'price_desc' ? (a, b) => effectivePrice(b) - effectivePrice(a) || a.id - b.id
    : q.sort === 'newest' || q.category === 'novidades' ? (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id
    : (a, b) => b.is_featured - a.is_featured || a.id - b.id,
  );
  const count = <K extends string>(vals: K[]) => { const m = new Map<K, number>(); for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1); return m; };
  const audience: FacetValue[] = [...count(base.map((p) => p.audience))].sort((a, b) => b[1] - a[1]).map(([value, c]) => ({ value, label: AUDIENCE_LABEL[value] ?? value, count: c }));
  const type: FacetValue[] = [...count(base.map((p) => p.product_type))].sort((a, b) => a[0].localeCompare(b[0])).map(([value, c]) => ({ value, label: value, count: c }));
  const sizeMap = new Map<string, { count: Set<number>; ord: number }>();
  const colorMap = new Map<string, { count: Set<number>; hex: string | null }>();
  for (const p of base) for (const v of activeVariants(p.id)) {
    const s = sizeMap.get(v.size) ?? { count: new Set<number>(), ord: v.size_order }; s.count.add(p.id); s.ord = Math.min(s.ord, v.size_order); sizeMap.set(v.size, s);
    const c = colorMap.get(v.color_name) ?? { count: new Set<number>(), hex: v.color_hex }; c.count.add(p.id); colorMap.set(v.color_name, c);
  }
  const size: FacetValue[] = [...sizeMap].sort((a, b) => a[1].ord - b[1].ord).map(([value, s]) => ({ value, label: value, count: s.count.size }));
  const color: FacetValue[] = [...colorMap].sort((a, b) => b[1].count.size - a[1].count.size || a[0].localeCompare(b[0])).slice(0, 40).map(([value, c]) => ({ value, label: value, count: c.count.size, hex: c.hex }));
  const prices = base.map(effectivePrice);
  return {
    items: cardsFor(rows.slice((page - 1) * perPage, page * perPage)), total: rows.length, page, perPage, pages: Math.max(1, Math.ceil(rows.length / perPage)),
    facets: { audience, size, color, type, price: { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 } }, category,
  };
}

function productBySlug(slug: string): ProductDetailDTO | null {
  const p = S.products.find((x) => x.slug === slug && x.is_active);
  if (!p) return null;
  const card = cardsFor([p])[0]!;
  const variants: VariantDTO[] = activeVariants(p.id).sort((a, b) => a.color_name.localeCompare(b.color_name) || a.size_order - b.size_order).map((v) => {
    const pr = variantUnitPrice(p, v);
    return { id: v.id, sku: v.sku, colorName: v.color_name, colorHex: v.color_hex, size: v.size, sizeOrder: v.size_order, priceCents: pr.original, promoPriceCents: pr.unit < pr.original ? pr.unit : null, stock: v.stock };
  });
  const chain = categoryChain(p.primary_category_id);
  const rootId = chain[0]?.id ?? p.primary_category_id ?? 0;
  const dept = new Set(descendantIds(rootId, false));
  const related = S.products.filter((x) => x.is_active && x.id !== p.id && catsOf(x.id).some((c) => dept.has(c)))
    .map((x) => ({ x, same: catsOf(x.id).includes(p.primary_category_id ?? -1) ? 1 : 0, stock: activeVariants(x.id).reduce((s, v) => s + v.stock, 0) > 0 ? 1 : 0 }))
    .sort((a, b) => b.same - a.same || b.stock - a.stock || b.x.is_featured - a.x.is_featured || a.x.id - b.x.id).slice(0, 6).map((r) => r.x);
  return {
    ...card, description: p.description, details: p.details, images: imagesOf(p.id).map(toImage), variants, breadcrumbs: [...crumbs(chain), { name: p.name, href: `/produto/${p.slug}` }],
    categorySlugs: catsOf(p.id).map((id) => S.categories.find((c) => c.id === id)?.slug ?? ''), colorConfirmed: Boolean(p.color_confirmed), related: cardsFor(related),
  };
}

function homeSections() {
  const shown = new Set<number>();
  const fresh = (list: ProductRow[], n: number) => { const out = list.filter((p) => !shown.has(p.id)).slice(0, n); out.forEach((p) => shown.add(p.id)); return cardsFor(out); };
  const active = S.products.filter((p) => p.is_active);
  const inCat = (slug: string) => { const c = S.categories.find((x) => x.slug === slug); if (!c) return []; const ids = new Set(descendantIds(c.id)); return active.filter((p) => catsOf(p.id).some((x) => ids.has(x))).sort((a, b) => b.is_featured - a.is_featured || a.id - b.id); };
  const NON_CLOTHING = ['Tênis', 'Boné', 'Chapéu', 'Colar', 'Pulseira', 'Relógio', 'Anel', 'Bolsa'];
  return {
    featured: fresh(active.filter((p) => p.is_featured).sort((a, b) => a.id - b.id), 8),
    newest: fresh([...active].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id), 8),
    clothing: fresh(active.filter((p) => !NON_CLOTHING.includes(p.product_type)).sort((a, b) => Number(b.audience === 'feminino') - Number(a.audience === 'feminino') || b.id - a.id), 8),
    sneakers: fresh(inCat('tenis'), 8),
    accessories: fresh(inCat('acessorios'), 8),
  };
}

// ---------------------------------------------------------------- sacola, cupom, frete
function normalizeItems(items: CartItemInput[]): CartItemInput[] {
  const m = new Map<number, number>();
  for (const it of items) { if (!Number.isSafeInteger(it.variantId) || it.variantId <= 0) continue; const q = Math.floor(Number(it.quantity)); if (!(q > 0)) continue; m.set(it.variantId, Math.min(20, (m.get(it.variantId) ?? 0) + q)); }
  return [...m].slice(0, 50).map(([variantId, quantity]) => ({ variantId, quantity }));
}
function buildLines(input: CartItemInput[]): CartLineDTO[] {
  const lines: CartLineDTO[] = [];
  for (const it of normalizeItems(input)) {
    const v = S.product_variants.find((x) => x.id === it.variantId);
    const p = v && productById(v.product_id);
    if (!v || !p) continue;
    const pr = variantUnitPrice(p, v);
    const issue = !p.is_active || !v.is_active ? 'unavailable' : v.stock <= 0 ? 'out_of_stock' : v.stock < it.quantity ? 'insufficient_stock' : null;
    const first = imagesOf(p.id)[0];
    lines.push({
      variantId: v.id, productId: p.id, productSlug: p.slug, name: p.name, colorName: v.color_name, size: v.size, image: first ? toImage(first) : null,
      unitPriceCents: pr.unit, originalPriceCents: pr.original, quantity: it.quantity, lineTotalCents: pr.unit * it.quantity, stock: Math.max(0, v.stock), issue, isDemo: Boolean(p.is_demo),
      variants: activeVariants(p.id).sort((a, b) => a.color_name.localeCompare(b.color_name) || a.size_order - b.size_order).map((x) => ({ id: x.id, colorName: x.color_name, size: x.size, stock: x.stock })),
    });
  }
  return lines;
}
function evaluateCoupon(codeInput: string, lines: CartLineDTO[], subtotal: number, userId: string | null) {
  const fail = (message: string, coupon: CouponRow | null = null) => ({ valid: false, discountCents: 0, message, coupon });
  const code = codeInput.trim().toUpperCase();
  const now = nowIso();
  const c = S.coupons.find((x) => x.code === code);
  if (!c || !c.is_active) return fail('Cupom inválido ou inativo.');
  if (c.starts_at && c.starts_at > now) return fail('Este cupom ainda não está válido.', c);
  if (c.ends_at && c.ends_at < now) return fail('Este cupom expirou.', c);
  if (subtotal < c.min_order_cents) return fail(`Pedido mínimo de R$ ${(c.min_order_cents / 100).toFixed(2).replace('.', ',')} para este cupom.`, c);
  const used = S.coupon_redemptions.filter((r) => r.coupon_id === c.id && r.status !== 'released');
  if (c.max_uses !== null && used.length >= c.max_uses) return fail('Este cupom atingiu o limite de utilizações.', c);
  if (c.max_uses_per_user !== null && userId && used.filter((r) => r.user_id === userId).length >= c.max_uses_per_user) return fail('Você já utilizou este cupom o número máximo de vezes.', c);
  let eligible = subtotal;
  if (c.category_ids.length || c.product_ids.length) {
    const cats = new Set(c.category_ids.flatMap((id) => descendantIds(id, false)));
    eligible = lines.filter((l) => c.product_ids.includes(l.productId) || catsOf(l.productId).some((x) => cats.has(x))).reduce((s, l) => s + l.lineTotalCents, 0);
    if (eligible <= 0) return fail('Este cupom não se aplica aos produtos do carrinho.', c);
  }
  const discount = c.discount_type === 'percent' ? Math.floor((eligible * c.value) / 100) : Math.min(c.value, eligible);
  if (discount <= 0) return fail('Este cupom não gera desconto para este carrinho.', c);
  return { valid: true, discountCents: Math.min(discount, subtotal), message: c.is_demo ? 'Cupom de demonstração aplicado.' : 'Cupom aplicado.', coupon: c };
}
function quoteShipping(cepInput: string, subtotal: number): { configured: boolean; options: ShippingOptionDTO[]; message: string | null } {
  const cep = onlyDigits(cepInput);
  if (!/^\d{8}$/.test(cep) || /^0{8}$/.test(cep)) return { configured: true, options: [], message: 'CEP inválido. Informe os 8 dígitos.' };
  const rules = S.shipping_rules.filter((r) => r.is_active && cep >= r.cep_start && cep <= r.cep_end).sort((a, b) => a.position - b.position || a.price_cents - b.price_cents);
  if (rules.length) {
    return { configured: true, message: null, options: rules.map((r) => ({ id: `manual:${r.id}`, label: r.name, priceCents: r.free_above_cents !== null && subtotal >= r.free_above_cents ? 0 : r.price_cents, minDays: r.min_days, maxDays: r.max_days, isDemo: false, note: r.free_above_cents !== null ? `Grátis acima de R$ ${(r.free_above_cents / 100).toFixed(2).replace('.', ',')}` : null })) };
  }
  return {
    configured: true, message: 'Frete em modo de demonstração: valores e prazos simulados, não são cotações reais.',
    options: [
      { id: 'demo:padrao', label: 'Entrega padrão (simulação)', priceCents: 1990, minDays: 5, maxDays: 9, isDemo: true, note: 'Valor simulado para demonstração' },
      { id: 'demo:expressa', label: 'Entrega expressa (simulação)', priceCents: 3490, minDays: 2, maxDays: 4, isDemo: true, note: 'Valor simulado para demonstração' },
    ],
  };
}
function quoteCart(input: { items: CartItemInput[]; couponCode?: string | null; cep?: string | null; shippingOptionId?: string | null }, userId: string | null) {
  const lines = buildLines(input.items);
  const ok = lines.filter((l) => !l.issue);
  const subtotal = ok.reduce((s, l) => s + l.lineTotalCents, 0);
  let coupon: CouponResultDTO | null = null;
  let discount = 0;
  if (input.couponCode?.trim()) {
    const ev = evaluateCoupon(input.couponCode, ok, subtotal, userId);
    coupon = { code: input.couponCode.trim().toUpperCase(), description: ev.coupon?.description ?? '', discountCents: ev.discountCents, valid: ev.valid, message: ev.message };
    if (ev.valid) discount = ev.discountCents;
  }
  let shipping: ShippingOptionDTO | null = null;
  let shippingOptions: ShippingOptionDTO[] = [];
  let shippingMessage: string | null = null;
  if (input.cep) { const q = quoteShipping(input.cep, subtotal - discount); shippingOptions = q.options; shippingMessage = q.message; shipping = q.options.find((o) => o.id === input.shippingOptionId) ?? null; }
  const shippingCents = shipping?.priceCents ?? 0;
  return { lines, itemCount: lines.reduce((s, l) => s + l.quantity, 0), subtotalCents: subtotal, coupon, discountCents: discount, shipping, shippingCents, totalCents: Math.max(0, subtotal - discount) + shippingCents, hasIssues: lines.some((l) => l.issue !== null), shippingOptions, shippingMessage, shippingConfigured: true };
}

// ---------------------------------------------------------------- pedidos e pagamento simulado
const daysText = (o: { minDays: number; maxDays: number }) => (o.minDays === o.maxDays ? `${o.maxDays} dias úteis` : `${o.minDays} a ${o.maxDays} dias úteis`);
function moveStock(variantId: number, delta: number, reason: string, actor: string, orderId: number | null = null, note: string | null = null): number {
  const v = S.product_variants.find((x) => x.id === variantId);
  if (!v) throw new HttpErr(404, 'Variante não encontrada.', 'not_found');
  if (v.stock + delta < 0) throw new HttpErr(409, `Estoque insuficiente para ${v.sku}.`, 'insufficient_stock');
  v.stock += delta;
  S.inventory_movements.push({ id: nextId('inventory_movements'), variant_id: variantId, delta, reason, order_id: orderId, actor, note, created_at: nowIso() });
  return v.stock;
}
const addEvent = (orderId: number, type: string, message: string, actor: string) => S.order_events.push({ id: nextId('order_events'), order_id: orderId, type, message, actor, created_at: nowIso() });
function releaseOrder(o: OrderRow, actor: string): void {
  if (o.stock_released) return;
  for (const it of S.order_items.filter((i) => i.order_id === o.id)) moveStock(it.variant_id, it.quantity, 'order_release', actor, o.id);
  for (const r of S.coupon_redemptions) if (r.order_id === o.id) r.status = 'released';
  o.stock_released = 1;
}
function getOrder(o: OrderRow, withCustomer = false): OrderDTO {
  const dto: OrderDTO = {
    id: o.id, number: o.number, status: o.status, subtotalCents: o.subtotal_cents, discountCents: o.discount_cents, shippingCents: o.shipping_cents, totalCents: o.total_cents, couponCode: o.coupon_code,
    shippingLabel: o.shipping_label, shippingDaysText: o.shipping_days_text, shippingIsDemo: Boolean(o.shipping_is_demo),
    address: { recipient: o.ship_recipient, cep: o.ship_cep, street: o.ship_street, number: o.ship_number, complement: o.ship_complement, district: o.ship_district, city: o.ship_city, state: o.ship_state },
    trackingCode: o.tracking_code, trackingUrl: o.tracking_url, isDemo: Boolean(o.is_demo), expiresAt: o.expires_at, createdAt: o.created_at,
    items: S.order_items.filter((i) => i.order_id === o.id).map((i) => ({ sku: i.sku, productName: i.product_name, productSlug: i.product_slug, colorName: i.color_name, size: i.size, imageUrl: img(i.image_url), unitPriceCents: i.unit_price_cents, quantity: i.quantity, lineTotalCents: i.line_total_cents })),
    payments: S.payments.filter((p) => p.order_id === o.id).sort((a, b) => b.id - a.id).map((p) => ({ id: p.id, provider: p.provider, method: p.method, status: p.status, statusDetail: p.status_detail, amountCents: p.amount_cents, pixQrCode: null, pixQrBase64: null, pixTicketUrl: null, cardLastFour: null, installments: null, expiresAt: p.expires_at, createdAt: p.created_at })),
    events: S.order_events.filter((e) => e.order_id === o.id).sort((a, b) => a.id - b.id).map((e) => ({ type: e.type, message: e.message, actor: e.actor.startsWith('admin:') ? 'admin' : e.actor.startsWith('customer:') ? 'customer' : e.actor, createdAt: e.created_at })),
  };
  if (withCustomer) { const u = S.users.find((x) => x.id === o.user_id); if (u) dto.customer = { id: u.id, email: u.email, name: u.name }; }
  return dto;
}
function expireStale(): void {
  const now = nowIso();
  for (const o of S.orders) {
    if (o.status !== 'pending_payment' || !o.expires_at || o.expires_at >= now) continue;
    o.status = 'cancelled';
    for (const p of S.payments) if (p.order_id === o.id && p.status === 'pending') { p.status = 'cancelled'; p.status_detail = 'expired'; }
    releaseOrder(o, 'system');
    addEvent(o.id, 'expired', 'Prazo de pagamento expirado. Pedido cancelado e estoque devolvido.', 'system');
  }
}
function ownedOrder(number: string, u: UserRow, allowAdmin = false): OrderRow {
  const o = S.orders.find((x) => x.number === number);
  if (!o || (o.user_id !== u.id && !(allowAdmin && u.role === 'admin'))) throw new HttpErr(404, 'Pedido não encontrado.', 'not_found');
  return o;
}
function cancelOrder(o: OrderRow, reason: string, actor: string): void {
  if (o.status !== 'pending_payment') throw new HttpErr(409, 'Somente pedidos aguardando pagamento podem ser cancelados diretamente. Pedidos pagos exigem estorno pelo provedor.', 'invalid_transition');
  if (S.payments.some((p) => p.order_id === o.id && p.status === 'approved')) throw new HttpErr(409, 'Há um pagamento aprovado neste pedido.', 'invalid_transition');
  o.status = 'cancelled';
  for (const p of S.payments) if (p.order_id === o.id && p.status === 'pending') { p.status = 'cancelled'; p.status_detail = 'order_cancelled'; }
  releaseOrder(o, actor);
  addEvent(o.id, 'cancelled', reason, actor);
}

// ---------------------------------------------------------------- validação (mesmas regras do servidor)
const email = z.string().trim().toLowerCase().email('E-mail inválido.').max(160);
const password = z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.').max(128);
const cepSchema = z.string().transform(onlyDigits).refine((v) => /^\d{8}$/.test(v), 'CEP inválido.');
const cartItemsSchema = z.array(z.object({ variantId: z.number().int().positive(), quantity: z.number().int().min(1).max(20) })).max(50);
const addressSchema = z.object({
  label: z.string().trim().max(40).default('Endereço'), recipient: z.string().trim().min(3, 'Informe o nome do destinatário.').max(120), cep: cepSchema,
  street: z.string().trim().min(2, 'Informe a rua.').max(160), number: z.string().trim().min(1, 'Informe o número.').max(20), complement: z.string().trim().max(80).optional().nullable(),
  district: z.string().trim().min(2, 'Informe o bairro.').max(80), city: z.string().trim().min(2, 'Informe a cidade.').max(80),
  state: z.string().trim().toUpperCase().refine((v) => (UF as readonly string[]).includes(v), 'UF inválida.'), isDefault: z.boolean().optional(),
});
const money = z.number().int().min(1).max(100_000_00);
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.').max(120);
const isoDate = z.string().datetime({ offset: true }).optional().nullable();
const productSchema = z.object({
  name: z.string().trim().min(2).max(160), slug, description: z.string().trim().max(4000).default(''), details: z.string().trim().max(4000).optional().nullable(),
  audience: z.enum(['masculino', 'feminino', 'unissex', 'menino', 'menina']), productType: z.string().trim().min(2).max(60), priceCents: money, promoPriceCents: money.optional().nullable(),
  promoStartsAt: isoDate, promoEndsAt: isoDate, categoryIds: z.array(z.number().int().positive()).min(1, 'Selecione ao menos uma categoria.').max(10), primaryCategoryId: z.number().int().positive(),
  isActive: z.boolean(), isFeatured: z.boolean(), isDemo: z.boolean(), colorConfirmed: z.boolean(), seoTitle: z.string().trim().max(70).optional().nullable(), seoDescription: z.string().trim().max(170).optional().nullable(),
}).refine((p) => !p.promoPriceCents || p.promoPriceCents < p.priceCents, { message: 'O preço promocional deve ser menor que o preço.', path: ['promoPriceCents'] })
  .refine((p) => p.categoryIds.includes(p.primaryCategoryId), { message: 'A categoria principal deve estar entre as categorias selecionadas.', path: ['primaryCategoryId'] });
const variantSchema = z.object({
  sku: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._-]+$/, 'SKU com caracteres inválidos.'), colorName: z.string().trim().min(1).max(60), colorHex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  size: z.string().trim().min(1).max(20), sizeOrder: z.number().int().min(0).max(999).default(0), priceCents: money.optional().nullable(), isActive: z.boolean().default(true), initialStock: z.number().int().min(0).max(100000).optional(),
});
const couponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(40).regex(/^[A-Z0-9_-]+$/, 'Use letras, números, _ ou -.'), description: z.string().trim().max(200).default(''), discountType: z.enum(['percent', 'fixed']),
  value: z.number().int().positive(), minOrderCents: z.number().int().min(0).default(0), startsAt: isoDate, endsAt: isoDate, maxUses: z.number().int().positive().optional().nullable(),
  maxUsesPerUser: z.number().int().positive().optional().nullable(), isActive: z.boolean(), categoryIds: z.array(z.number().int().positive()).default([]), productIds: z.array(z.number().int().positive()).default([]),
}).refine((c) => c.discountType !== 'percent' || c.value <= 90, { message: 'Percentual máximo: 90%.', path: ['value'] })
  .refine((c) => !c.startsAt || !c.endsAt || c.startsAt < c.endsAt, { message: 'A data final deve ser posterior à inicial.', path: ['endsAt'] });
const ruleSchema = z.object({
  name: z.string().trim().min(2).max(80), cepStart: cepSchema, cepEnd: cepSchema, priceCents: z.number().int().min(0).max(100_000_00), minDays: z.number().int().min(0).max(120), maxDays: z.number().int().min(0).max(120),
  freeAboveCents: z.number().int().positive().optional().nullable(), isActive: z.boolean(), position: z.number().int().min(0).max(999).default(0),
}).refine((r) => r.cepStart <= r.cepEnd, { message: 'CEP inicial deve ser menor ou igual ao final.', path: ['cepEnd'] }).refine((r) => r.minDays <= r.maxDays, { message: 'Prazo mínimo deve ser menor ou igual ao máximo.', path: ['maxDays'] });
const categorySchema = z.object({ name: z.string().trim().min(2).max(80), slug, description: z.string().trim().max(400).optional().nullable(), parentId: z.number().int().positive().optional().nullable(), position: z.number().int().min(0).max(999).default(0), isActive: z.boolean().default(true), imageUrl: z.string().trim().max(300).optional().nullable() });
const passwordProblems = (pw: string) => (pw.length < 8 ? 'A senha deve ter pelo menos 8 caracteres.' : !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw) ? 'Use letras e números na senha.' : null);

// ---------------------------------------------------------------- rotas
interface Ctx { params: Record<string, string>; query: URLSearchParams; body: unknown; user: UserRow | null }
type Handler = (c: Ctx) => unknown | Promise<unknown>;
const routes: { method: string; re: RegExp; keys: string[]; h: Handler; mutates: boolean }[] = [];
function route(method: string, path: string, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k: string) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, h, mutates: method !== 'GET' });
}
const requireUser = (c: Ctx): UserRow => { if (!c.user) throw new HttpErr(401, 'Faça login para continuar.', 'unauthenticated'); return c.user; };
const requireAdmin = (c: Ctx): UserRow => { const u = requireUser(c); if (u.role !== 'admin') throw new HttpErr(403, 'Acesso restrito a administradores.', 'forbidden'); return u; };
const intParam = (v: string | undefined) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new HttpErr(400, 'Parâmetro inválido.', 'bad_request'); return n; };
const me = (u: UserRow): MeDTO => ({ id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: Boolean(u.email_verified_at), hasPassword: true, googleLinked: false });
const audit = (u: UserRow, action: string, entity: string, id: string | number) => S.audit_log.push({ id: nextId('audit_log'), actor: `admin:${u.id}`, action, entity, entity_id: String(id), created_at: nowIso() });

export function publicConfig(): PublicConfigDTO {
  return {
    demoMode: true, googleAuth: false,
    payments: { provider: 'demo', pix: false, creditCard: false, demo: true, mpPublicKey: null, maxInstallments: 1 },
    shipping: { provider: 'demo', configured: true }, settings: clone(S.settings), categories: categoryTree(),
    standalone: { notice: 'Versão HTML de demonstração — dados salvos apenas neste navegador; pagamento e frete simulados.', demoLogin: DEMO_ADMIN },
  };
}

// Públicas
route('GET', '/api/config', () => publicConfig());
route('GET', '/api/categories', () => ({ categories: categoryTree() }));
route('GET', '/api/home', () => homeSections());
route('GET', '/api/catalog', (c) => searchCatalog(parseCatalogQuery(c.query)));
route('GET', '/api/products/:slug', (c) => { const p = productBySlug(c.params.slug!); if (!p) throw new HttpErr(404, 'Produto não encontrado.', 'not_found'); return p; });
route('GET', '/api/search/suggest', (c) => { const q = (c.query.get('q') ?? '').trim(); if (q.length < 2) return { items: [], total: 0 }; const r = searchCatalog({ q, perPage: 6 }); return { items: r.items, total: r.total }; });
route('POST', '/api/products/lookup', (c) => { const b = z.object({ ids: z.array(z.number().int().positive()).max(100).optional() }).parse(c.body); const ids = b.ids ?? []; return { items: cardsFor(ids.map((id) => S.products.find((p) => p.id === id && p.is_active)).filter((p): p is ProductRow => Boolean(p))) }; });
route('GET', '/api/cep/:cep', async (c) => {
  const cep = onlyDigits(c.params.cep ?? '');
  if (!/^\d{8}$/.test(cep)) throw new HttpErr(400, 'CEP inválido.', 'invalid_cep');
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: ctrl.signal }); clearTimeout(t);
    const j = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (!r.ok || j.erro) return { found: false };
    return { found: true, street: j.logradouro ?? '', district: j.bairro ?? '', city: j.localidade ?? '', state: j.uf ?? '' };
  } catch { return { found: false, unavailable: true }; }
});
route('POST', '/api/cart/quote', (c) => {
  const b = z.object({ items: cartItemsSchema, couponCode: z.string().trim().max(40).optional().nullable(), cep: z.string().max(12).optional().nullable(), shippingOptionId: z.string().max(40).optional().nullable() }).parse(c.body);
  return quoteCart(b, c.user?.id ?? null);
});
route('POST', '/api/shipping/quote', (c) => { const b = z.object({ cep: cepSchema, subtotalCents: z.number().int().min(0).default(0) }).parse(c.body); return quoteShipping(b.cep, b.subtotalCents); });

// Sacola e favoritos da conta
route('GET', '/api/cart', (c) => ({ items: S.carts[requireUser(c).id] ?? [] }));
route('PUT', '/api/cart', (c) => { const u = requireUser(c); const b = z.object({ items: cartItemsSchema }).parse(c.body); S.carts[u.id] = normalizeItems(b.items).filter((i) => S.product_variants.some((v) => v.id === i.variantId)); return { items: S.carts[u.id] }; });
route('POST', '/api/cart/merge', (c) => {
  const u = requireUser(c); const b = z.object({ items: cartItemsSchema }).parse(c.body);
  const m = new Map<number, number>((S.carts[u.id] ?? []).map((i) => [i.variantId, i.quantity]));
  for (const it of normalizeItems(b.items)) m.set(it.variantId, Math.max(m.get(it.variantId) ?? 0, it.quantity)); // mantém a maior quantidade (não soma)
  S.carts[u.id] = [...m].map(([variantId, quantity]) => ({ variantId, quantity })).filter((i) => S.product_variants.some((v) => v.id === i.variantId));
  return { items: S.carts[u.id] };
});
route('GET', '/api/favorites', (c) => { const ids = S.favorites[requireUser(c).id] ?? []; return { ids, items: cardsFor(ids.map((id) => productById(id)).filter((p): p is ProductRow => Boolean(p))) }; });
route('PUT', '/api/favorites/:productId', (c) => { const u = requireUser(c); const id = Number(c.params.productId); const ok = Boolean(S.products.find((p) => p.id === id && p.is_active)); if (ok) S.favorites[u.id] = [id, ...(S.favorites[u.id] ?? []).filter((x) => x !== id)]; return { ok }; });
route('DELETE', '/api/favorites/:productId', (c) => { const u = requireUser(c); S.favorites[u.id] = (S.favorites[u.id] ?? []).filter((x) => x !== Number(c.params.productId)); return { ok: true }; });
route('POST', '/api/favorites/merge', (c) => { const u = requireUser(c); const b = z.object({ ids: z.array(z.number().int().positive()).max(200) }).parse(c.body); const cur = S.favorites[u.id] ?? []; S.favorites[u.id] = [...cur, ...b.ids.filter((id) => !cur.includes(id) && productById(id))]; return { ids: S.favorites[u.id] }; });

// Autenticação (local)
route('GET', '/api/auth/me', (c) => ({ user: c.user ? me(c.user) : null }));
route('POST', '/api/auth/register', async (c) => {
  const b = z.object({ name: z.string().trim().min(2, 'Informe seu nome.').max(120), email, password, acceptTerms: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar os termos e a política de privacidade.' }) }) }).parse(c.body);
  const problem = passwordProblems(b.password);
  if (problem) throw new HttpErr(400, problem, 'weak_password', { fieldErrors: { password: [problem] } });
  if (S.users.some((u) => u.email === b.email)) throw new HttpErr(409, 'Já existe uma conta com este e-mail. Entre ou recupere sua senha.', 'email_taken', { fieldErrors: { email: ['E-mail já cadastrado.'] } });
  const u: UserRow = { id: randomId(), email: b.email, password_hash: await hashPassword(b.password), role: 'customer', name: b.name, phone: null, email_verified_at: nowIso(), created_at: nowIso() };
  S.users.push(u);
  S.sessionUserId = u.id;
  return { ok: true };
});
route('POST', '/api/auth/login', async (c) => {
  const b = z.object({ email, password: z.string().min(1).max(128) }).parse(c.body);
  const u = S.users.find((x) => x.email === b.email);
  if (!u || !(await verifyPassword(b.password, u.password_hash))) throw new HttpErr(401, 'E-mail ou senha incorretos.', 'invalid_credentials');
  S.sessionUserId = u.id;
  return { ok: true };
});
route('POST', '/api/auth/logout', () => { S.sessionUserId = null; return { ok: true }; });
route('POST', '/api/auth/forgot-password', () => ({ message: 'Na versão HTML de demonstração não há envio de e-mail. No site completo, você receberia um link para redefinir a senha.' }));
route('POST', '/api/auth/reset-password', () => { throw new HttpErr(400, 'Redefinição por link não está disponível na versão de demonstração.', 'invalid_token'); });
route('POST', '/api/auth/resend-verification', () => ({ ok: true }));
route('POST', '/api/auth/change-password', async (c) => {
  const u = requireUser(c); const b = z.object({ currentPassword: z.string().max(128).optional(), newPassword: password }).parse(c.body);
  if (!(await verifyPassword(b.currentPassword ?? '', u.password_hash))) throw new HttpErr(400, 'Senha atual incorreta.', 'invalid_password', { fieldErrors: { currentPassword: ['Senha atual incorreta.'] } });
  const problem = passwordProblems(b.newPassword);
  if (problem) throw new HttpErr(400, problem, 'weak_password', { fieldErrors: { newPassword: [problem] } });
  u.password_hash = await hashPassword(b.newPassword);
  return { ok: true };
});

// Conta
route('GET', '/api/account/profile', (c) => { const u = requireUser(c); return { name: u.name, phone: u.phone ?? '', email: u.email }; });
route('PUT', '/api/account/profile', (c) => { const u = requireUser(c); const b = z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().max(30).optional().nullable() }).parse(c.body); u.name = b.name; u.phone = b.phone ?? null; return { ok: true }; });
const listAddresses = (uid: string): AddressDTO[] => S.addresses.filter((a) => a.user_id === uid).sort((a, b) => b.is_default - a.is_default || b.id - a.id)
  .map((a) => ({ id: a.id, label: a.label, recipient: a.recipient, cep: a.cep, street: a.street, number: a.number, complement: a.complement, district: a.district, city: a.city, state: a.state, isDefault: Boolean(a.is_default) }));
function saveAddress(uid: string, a: z.infer<typeof addressSchema>, id?: number): number {
  const mine = S.addresses.filter((x) => x.user_id === uid);
  if (!id && mine.length >= 10) throw new HttpErr(400, 'Limite de 10 endereços atingido.', 'too_many_addresses');
  const makeDefault = Boolean(a.isDefault) || mine.length === 0;
  if (makeDefault) for (const x of mine) x.is_default = 0;
  const data = { label: a.label, recipient: a.recipient, cep: a.cep, street: a.street, number: a.number, complement: a.complement ?? null, district: a.district, city: a.city, state: a.state };
  if (id) { const row = mine.find((x) => x.id === id); if (!row) throw new HttpErr(404, 'Endereço não encontrado.', 'not_found'); Object.assign(row, data); if (makeDefault) row.is_default = 1; return id; }
  const nid = nextId('addresses');
  S.addresses.push({ id: nid, user_id: uid, ...data, is_default: makeDefault ? 1 : 0 });
  return nid;
}
route('GET', '/api/account/addresses', (c) => ({ addresses: listAddresses(requireUser(c).id) }));
route('POST', '/api/account/addresses', (c) => { const u = requireUser(c); const id = saveAddress(u.id, addressSchema.parse(c.body)); return { id, addresses: listAddresses(u.id) }; });
route('PUT', '/api/account/addresses/:id', (c) => { const u = requireUser(c); saveAddress(u.id, addressSchema.parse(c.body), intParam(c.params.id)); return { addresses: listAddresses(u.id) }; });
route('DELETE', '/api/account/addresses/:id', (c) => {
  const u = requireUser(c); const id = intParam(c.params.id);
  const row = S.addresses.find((a) => a.id === id && a.user_id === u.id);
  if (!row) throw new HttpErr(404, 'Endereço não encontrado.', 'not_found');
  S.addresses = S.addresses.filter((a) => a.id !== id);
  if (row.is_default) { const next = S.addresses.filter((a) => a.user_id === u.id).sort((a, b) => b.id - a.id)[0]; if (next) next.is_default = 1; }
  return { addresses: listAddresses(u.id) };
});
route('GET', '/api/account/orders', (c) => { const u = requireUser(c); return { orders: S.orders.filter((o) => o.user_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((o) => getOrder(o)) }; });
route('GET', '/api/account/orders/:number', (c) => getOrder(ownedOrder(c.params.number!, requireUser(c))));
route('POST', '/api/account/orders/:number/cancel', (c) => { const u = requireUser(c); const o = ownedOrder(c.params.number!, u); cancelOrder(o, 'Pedido cancelado pelo cliente.', `customer:${u.id}`); return getOrder(o); });

// Checkout
route('POST', '/api/checkout/orders', (c) => {
  const u = requireUser(c);
  const b = z.object({ items: cartItemsSchema.min(1, 'Seu carrinho está vazio.'), couponCode: z.string().trim().max(40).optional().nullable(), addressId: z.number().int().positive().optional(), address: addressSchema.optional(), saveAddress: z.boolean().optional(), shippingOptionId: z.string().min(1).max(40), expectedTotalCents: z.number().int().nonnegative().optional() }).parse(c.body);
  let addr: Omit<AddressRow, 'id' | 'user_id' | 'is_default' | 'label'>;
  if (b.addressId) { const a = S.addresses.find((x) => x.id === b.addressId && x.user_id === u.id); if (!a) throw new HttpErr(400, 'Endereço inválido.', 'invalid_address'); addr = a; }
  else if (b.address) { addr = { ...b.address, complement: b.address.complement ?? null }; if (b.saveAddress) saveAddress(u.id, b.address); }
  else throw new HttpErr(400, 'Informe o endereço de entrega.', 'address_required');
  const quote = quoteCart({ items: b.items, couponCode: b.couponCode, cep: addr.cep, shippingOptionId: b.shippingOptionId }, u.id);
  if (!quote.lines.length) throw new HttpErr(400, 'Seu carrinho está vazio.', 'empty_cart');
  const problem = quote.lines.find((l) => l.issue);
  if (problem) throw new HttpErr(409, problem.issue === 'insufficient_stock' ? `Estoque insuficiente para ${problem.name} (${problem.colorName}, ${problem.size}). Disponível: ${problem.stock}.` : `${problem.name} (${problem.colorName}, ${problem.size}) está indisponível.`, 'stock_problem');
  if (b.couponCode && quote.coupon && !quote.coupon.valid) throw new HttpErr(409, quote.coupon.message ?? 'Cupom inválido.', 'invalid_coupon');
  if (!quote.shipping) throw new HttpErr(409, quote.shippingMessage ?? 'Selecione uma opção de entrega válida para o CEP informado.', 'invalid_shipping');
  if (b.expectedTotalCents !== undefined && b.expectedTotalCents !== quote.totalCents) throw new HttpErr(409, 'Os valores do pedido foram atualizados. Revise o resumo antes de continuar.', 'total_changed', { totalCents: quote.totalCents });
  const ev = b.couponCode ? evaluateCoupon(b.couponCode, quote.lines, quote.subtotalCents, u.id) : null;
  const id = nextId('orders');
  const o: OrderRow = {
    id, number: `GZ${100000 + id}`, user_id: u.id, status: 'pending_payment', subtotal_cents: quote.subtotalCents, discount_cents: quote.discountCents, shipping_cents: quote.shippingCents, total_cents: quote.totalCents,
    coupon_id: ev?.valid ? ev.coupon!.id : null, coupon_code: ev?.valid ? ev.coupon!.code : null, shipping_label: quote.shipping.label, shipping_days_text: daysText(quote.shipping), shipping_is_demo: quote.shipping.isDemo ? 1 : 0,
    ship_recipient: addr.recipient, ship_cep: addr.cep, ship_street: addr.street, ship_number: addr.number, ship_complement: addr.complement, ship_district: addr.district, ship_city: addr.city, ship_state: addr.state,
    tracking_code: null, tracking_url: null, is_demo: 1, expires_at: new Date(Date.now() + ORDER_WINDOW_MIN * 60_000).toISOString(), stock_released: 0, created_at: nowIso(),
  };
  S.orders.push(o);
  for (const l of quote.lines) {
    moveStock(l.variantId, -l.quantity, 'order_reserve', `customer:${u.id}`, id);
    const v = S.product_variants.find((x) => x.id === l.variantId)!;
    const first = imagesOf(l.productId)[0];
    S.order_items.push({ id: nextId('order_items'), order_id: id, product_id: l.productId, variant_id: l.variantId, sku: v.sku, product_name: l.name, product_slug: l.productSlug, color_name: l.colorName, size: l.size, image_url: first?.url ?? null, unit_price_cents: l.unitPriceCents, quantity: l.quantity, line_total_cents: l.lineTotalCents });
  }
  if (ev?.valid) S.coupon_redemptions.push({ id: nextId('coupon_redemptions'), coupon_id: ev.coupon!.id, order_id: id, user_id: u.id, discount_cents: quote.discountCents, status: 'reserved' });
  addEvent(id, 'created', 'Pedido criado. Estoque reservado até a confirmação do pagamento.', `customer:${u.id}`);
  S.carts[u.id] = [];
  return getOrder(o);
});
route('POST', '/api/checkout/orders/:number/pay', (c) => {
  const u = requireUser(c); const o = ownedOrder(c.params.number!, u);
  const b = z.object({ method: z.enum(['pix', 'credit_card', 'demo']) }).parse(c.body);
  if (b.method !== 'demo') throw new HttpErr(503, 'Na versão HTML de demonstração apenas o pagamento simulado está disponível.', 'demo_only');
  if (o.status !== 'pending_payment') throw new HttpErr(409, 'Este pedido não está aguardando pagamento.', 'not_payable');
  if (!S.payments.some((p) => p.order_id === o.id && p.status === 'pending')) {
    S.payments.push({ id: nextId('payments'), order_id: o.id, provider: 'demo', method: 'demo', status: 'pending', status_detail: null, amount_cents: o.total_cents, expires_at: o.expires_at, created_at: nowIso() });
    addEvent(o.id, 'payment_created', 'Pagamento SIMULADO criado (modo demonstração — nenhum valor é cobrado).', 'provider:demo');
  }
  return getOrder(o);
});
route('GET', '/api/checkout/orders/:number/status', (c) => getOrder(ownedOrder(c.params.number!, requireUser(c))));
route('POST', '/api/checkout/payments/:id/simulate', (c) => {
  const u = requireUser(c); const b = z.object({ outcome: z.enum(['approved', 'rejected', 'cancelled']) }).parse(c.body);
  const p = S.payments.find((x) => x.id === intParam(c.params.id));
  const o = p && S.orders.find((x) => x.id === p.order_id);
  if (!p || !o || (o.user_id !== u.id && u.role !== 'admin')) throw new HttpErr(404, 'Pagamento não encontrado.', 'not_found');
  if (p.status === b.outcome) return getOrder(o);
  p.status = b.outcome; p.status_detail = `demo_${b.outcome}`;
  if (b.outcome === 'approved' && o.status === 'pending_payment') {
    o.status = 'paid'; o.expires_at = null;
    for (const r of S.coupon_redemptions) if (r.order_id === o.id) r.status = 'confirmed';
    addEvent(o.id, 'paid', 'Pagamento aprovado e confirmado pelo provedor.', 'provider:demo');
  } else if (b.outcome !== 'approved') {
    addEvent(o.id, `payment_${b.outcome}`, b.outcome === 'rejected' ? 'Pagamento recusado. O cliente pode tentar novamente.' : 'Pagamento cancelado/expirado no provedor.', 'provider:demo');
  }
  return getOrder(o);
});

// ---------------------------------------------------------------- painel administrativo
function productAdminDetail(id: number) {
  const p = productById(id);
  if (!p) throw new HttpErr(404, 'Produto não encontrado.', 'not_found');
  return {
    id: p.id, slug: p.slug, name: p.name, description: p.description, details: p.details, audience: p.audience, productType: p.product_type, priceCents: p.price_cents, promoPriceCents: p.promo_price_cents,
    promoStartsAt: p.promo_starts_at, promoEndsAt: p.promo_ends_at, primaryCategoryId: p.primary_category_id, isActive: Boolean(p.is_active), isFeatured: Boolean(p.is_featured), isDemo: Boolean(p.is_demo),
    colorConfirmed: Boolean(p.color_confirmed), seoTitle: p.seo_title, seoDescription: p.seo_description, createdAt: p.created_at, updatedAt: p.updated_at, categoryIds: catsOf(p.id),
    images: imagesOf(p.id).map((i) => ({ id: i.id, url: img(i.url), srcset: null, alt: i.alt, colorName: i.color_name, position: i.position, objectPosition: i.object_position, width: i.width, height: i.height })),
    variants: S.product_variants.filter((v) => v.product_id === p.id).sort((a, b) => a.color_name.localeCompare(b.color_name) || a.size_order - b.size_order)
      .map((v) => ({ id: v.id, sku: v.sku, colorName: v.color_name, colorHex: v.color_hex, size: v.size, sizeOrder: v.size_order, priceCents: v.price_cents, stock: v.stock, isActive: Boolean(v.is_active) })),
  };
}
const PAID = ['paid', 'processing', 'shipped', 'delivered'];
route('GET', '/api/admin/dashboard', (c) => {
  requireAdmin(c);
  const real = S.orders.filter((o) => !o.is_demo);
  const low = S.product_variants.filter((v) => v.is_active && productById(v.product_id)?.is_active && v.stock <= 2);
  return {
    orders: { total: real.length, pending: real.filter((o) => o.status === 'pending_payment').length, paid: real.filter((o) => PAID.includes(o.status)).length, toShip: real.filter((o) => ['paid', 'processing'].includes(o.status)).length },
    revenueCents: real.filter((o) => PAID.includes(o.status)).reduce((s, o) => s + o.total_cents, 0), demoOrders: S.orders.length - real.length,
    products: { active: S.products.filter((p) => p.is_active).length, demo: S.products.filter((p) => p.is_demo).length },
    lowStock: [...low].sort((a, b) => a.stock - b.stock || productById(a.product_id)!.name.localeCompare(productById(b.product_id)!.name)).slice(0, 12)
      .map((v) => ({ id: v.id, sku: v.sku, colorName: v.color_name, size: v.size, stock: v.stock, name: productById(v.product_id)!.name, productId: v.product_id })),
    lowStockCount: low.length,
    recentOrders: [...S.orders].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8).map((o) => ({ number: o.number, status: o.status, totalCents: o.total_cents, isDemo: o.is_demo, createdAt: o.created_at })),
  };
});
route('GET', '/api/admin/products', (c) => {
  requireAdmin(c);
  const q = norm((c.query.get('q') ?? '').trim()); const status = c.query.get('status'); const page = Math.max(1, Number(c.query.get('pagina') ?? 1) || 1);
  const stockOf = (id: number) => S.product_variants.filter((v) => v.product_id === id && v.is_active).reduce((s, v) => s + v.stock, 0);
  let rows = [...S.products];
  if (q) rows = rows.filter((p) => norm(p.name).includes(q) || p.slug.includes(q) || S.product_variants.some((v) => v.product_id === p.id && norm(v.sku).includes(q)));
  if (status === 'ativos') rows = rows.filter((p) => p.is_active); if (status === 'inativos') rows = rows.filter((p) => !p.is_active);
  if (status === 'demo') rows = rows.filter((p) => p.is_demo); if (status === 'sem-estoque') rows = rows.filter((p) => stockOf(p.id) === 0);
  rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id);
  return {
    items: rows.slice((page - 1) * 30, page * 30).map((p) => ({ id: p.id, slug: p.slug, name: p.name, priceCents: p.price_cents, promoPriceCents: p.promo_price_cents, isActive: p.is_active, isFeatured: p.is_featured, isDemo: p.is_demo, image: img(imagesOf(p.id)[0]?.url), stock: stockOf(p.id), variantCount: S.product_variants.filter((v) => v.product_id === p.id).length, category: S.categories.find((x) => x.id === p.primary_category_id)?.name ?? null })),
    total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / 30)),
  };
});
route('GET', '/api/admin/products/:id', (c) => { requireAdmin(c); return productAdminDetail(intParam(c.params.id)); });
function writeProduct(u: UserRow, b: z.infer<typeof productSchema>, id?: number) {
  if (S.products.some((p) => p.slug === b.slug && p.id !== id)) throw new HttpErr(409, 'Já existe um produto com este slug.', 'slug_taken', { fieldErrors: { slug: ['Slug em uso.'] } });
  if (!b.categoryIds.every((cid) => S.categories.some((c) => c.id === cid))) throw new HttpErr(400, 'Categoria inexistente.', 'bad_category');
  const data = { slug: b.slug, name: b.name, description: b.description, details: b.details ?? null, audience: b.audience, product_type: b.productType, primary_category_id: b.primaryCategoryId, price_cents: b.priceCents, promo_price_cents: b.promoPriceCents ?? null, promo_starts_at: b.promoStartsAt ?? null, promo_ends_at: b.promoEndsAt ?? null, is_active: b.isActive ? 1 : 0, is_featured: b.isFeatured ? 1 : 0, is_demo: b.isDemo ? 1 : 0, color_confirmed: b.colorConfirmed ? 1 : 0, seo_title: b.seoTitle ?? null, seo_description: b.seoDescription ?? null, updated_at: nowIso() };
  if (id) { const p = productById(id); if (!p) throw new HttpErr(404, 'Produto não encontrado.', 'not_found'); Object.assign(p, data); }
  else { id = nextId('products'); S.products.push({ id, ...data, created_at: nowIso() }); }
  S.product_categories = S.product_categories.filter((pc) => pc.product_id !== id).concat([...new Set(b.categoryIds)].map((cid) => ({ product_id: id!, category_id: cid })));
  audit(u, 'product.save', 'product', id);
  return productAdminDetail(id);
}
route('POST', '/api/admin/products', (c) => writeProduct(requireAdmin(c), productSchema.parse(c.body)));
route('PUT', '/api/admin/products/:id', (c) => writeProduct(requireAdmin(c), productSchema.parse(c.body), intParam(c.params.id)));
route('POST', '/api/admin/products/:id/variants', (c) => {
  const u = requireAdmin(c); const pid = intParam(c.params.id); const b = variantSchema.parse(c.body);
  if (!productById(pid)) throw new HttpErr(404, 'Produto não encontrado.', 'not_found');
  if (S.product_variants.some((v) => v.sku === b.sku)) throw new HttpErr(409, 'SKU já utilizado.', 'sku_taken', { fieldErrors: { sku: ['SKU em uso.'] } });
  if (S.product_variants.some((v) => v.product_id === pid && v.color_name === b.colorName && v.size === b.size)) throw new HttpErr(409, 'Esta combinação de cor e tamanho já existe.', 'variant_exists');
  const id = nextId('product_variants');
  S.product_variants.push({ id, product_id: pid, sku: b.sku, color_name: b.colorName, color_hex: b.colorHex ?? null, size: b.size, size_order: b.sizeOrder, price_cents: b.priceCents ?? null, stock: 0, is_active: b.isActive ? 1 : 0 });
  if (b.initialStock) moveStock(id, b.initialStock, 'initial', `admin:${u.id}`, null, 'Estoque inicial');
  audit(u, 'variant.create', 'variant', id);
  return productAdminDetail(pid);
});
route('PUT', '/api/admin/variants/:id', (c) => {
  const u = requireAdmin(c); const id = intParam(c.params.id); const b = variantSchema.omit({ initialStock: true }).parse(c.body);
  const v = S.product_variants.find((x) => x.id === id); if (!v) throw new HttpErr(404, 'Variante não encontrada.', 'not_found');
  if (S.product_variants.some((x) => x.sku === b.sku && x.id !== id)) throw new HttpErr(409, 'SKU já utilizado.', 'sku_taken');
  Object.assign(v, { sku: b.sku, color_name: b.colorName, color_hex: b.colorHex ?? null, size: b.size, size_order: b.sizeOrder, price_cents: b.priceCents ?? null, is_active: b.isActive ? 1 : 0 });
  audit(u, 'variant.update', 'variant', id);
  return productAdminDetail(v.product_id);
});
route('POST', '/api/admin/variants/:id/stock', (c) => {
  const u = requireAdmin(c); const id = intParam(c.params.id);
  const b = z.object({ delta: z.number().int().min(-100000).max(100000).refine((v) => v !== 0, 'Informe um ajuste diferente de zero.'), reason: z.enum(['adjustment', 'restock']), note: z.string().trim().max(200).optional() }).parse(c.body);
  const v = S.product_variants.find((x) => x.id === id); if (!v) throw new HttpErr(404, 'Variante não encontrada.', 'not_found');
  moveStock(id, b.delta, b.reason, `admin:${u.id}`, null, b.note ?? null);
  return productAdminDetail(v.product_id);
});
route('GET', '/api/admin/variants/:id/movements', (c) => { requireAdmin(c); const id = intParam(c.params.id); return { movements: S.inventory_movements.filter((m) => m.variant_id === id).sort((a, b) => b.id - a.id).slice(0, 100).map((m) => ({ id: m.id, delta: m.delta, reason: m.reason, orderId: m.order_id, actor: m.actor, note: m.note, createdAt: m.created_at })) }; });
route('POST', '/api/admin/products/:id/images', (c) => {
  const u = requireAdmin(c); const pid = intParam(c.params.id); const p = productById(pid); if (!p) throw new HttpErr(404, 'Produto não encontrado.', 'not_found');
  const b = c.body as { dataUrl: string; width: number; height: number };
  const id = nextId('product_images');
  S.product_images.push({ id, product_id: pid, url: b.dataUrl, srcset: null, width: b.width, height: b.height, alt: (c.query.get('alt') ?? p.name).slice(0, 160), color_name: c.query.get('cor') || null, object_position: 'center', position: imagesOf(pid).reduce((m, i) => Math.max(m, i.position), -1) + 1 });
  audit(u, 'image.upload', 'product', pid);
  return productAdminDetail(pid);
});
route('PUT', '/api/admin/images/:id', (c) => {
  requireAdmin(c); const id = intParam(c.params.id);
  const b = z.object({ alt: z.string().trim().max(160), colorName: z.string().trim().max(60).nullable(), position: z.number().int().min(0).max(99), objectPosition: z.string().regex(/^[a-z0-9% ]{1,30}$/).default('center') }).parse(c.body);
  const im = S.product_images.find((x) => x.id === id); if (!im) throw new HttpErr(404, 'Imagem não encontrada.', 'not_found');
  Object.assign(im, { alt: b.alt, color_name: b.colorName || null, position: b.position, object_position: b.objectPosition });
  return productAdminDetail(im.product_id);
});
route('DELETE', '/api/admin/images/:id', (c) => { requireAdmin(c); const id = intParam(c.params.id); const im = S.product_images.find((x) => x.id === id); if (!im) throw new HttpErr(404, 'Imagem não encontrada.', 'not_found'); S.product_images = S.product_images.filter((x) => x.id !== id); return productAdminDetail(im.product_id); });
route('GET', '/api/admin/categories', (c) => { requireAdmin(c); return { categories: listCategories(true), tree: categoryTree(true) }; });
function saveCategory(c: Ctx, id?: number) {
  const u = requireAdmin(c); const b = categorySchema.parse(c.body);
  if (S.categories.some((x) => x.slug === b.slug && x.id !== id)) throw new HttpErr(409, 'Slug em uso.', 'slug_taken', { fieldErrors: { slug: ['Slug em uso.'] } });
  if (b.parentId && (b.parentId === id || !S.categories.some((x) => x.id === b.parentId))) throw new HttpErr(400, 'Categoria-mãe inválida.', 'bad_parent');
  const data = { name: b.name, slug: b.slug, description: b.description ?? null, parent_id: b.parentId ?? null, position: b.position, is_active: b.isActive ? 1 : 0, image_url: b.imageUrl ?? null };
  if (id) { const row = S.categories.find((x) => x.id === id); if (!row) throw new HttpErr(404, 'Categoria não encontrada.', 'not_found'); Object.assign(row, data); }
  else { id = nextId('categories'); S.categories.push({ id, ...data }); }
  audit(u, 'category.save', 'category', id);
  return { categories: listCategories(true) };
}
route('POST', '/api/admin/categories', (c) => saveCategory(c));
route('PUT', '/api/admin/categories/:id', (c) => saveCategory(c, intParam(c.params.id)));
route('GET', '/api/admin/orders', (c) => {
  requireAdmin(c);
  const status = c.query.get('status'); const q = (c.query.get('q') ?? '').trim().toLowerCase(); const page = Math.max(1, Number(c.query.get('pagina') ?? 1) || 1);
  let rows = [...S.orders];
  if (status) rows = rows.filter((o) => o.status === status);
  if (q) rows = rows.filter((o) => o.number.toLowerCase().includes(q) || (S.users.find((u) => u.id === o.user_id)?.email ?? '').includes(q) || o.ship_recipient.toLowerCase().includes(q));
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    items: rows.slice((page - 1) * 30, page * 30).map((o) => ({ number: o.number, status: o.status, totalCents: o.total_cents, isDemo: o.is_demo, createdAt: o.created_at, email: S.users.find((u) => u.id === o.user_id)?.email ?? '', recipient: o.ship_recipient, paymentStatus: S.payments.filter((p) => p.order_id === o.id).sort((a, b) => b.id - a.id)[0]?.status ?? null, items: S.order_items.filter((i) => i.order_id === o.id).reduce((s, i) => s + i.quantity, 0) })),
    total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / 30)),
  };
});
route('GET', '/api/admin/orders/:number', (c) => { requireAdmin(c); const o = S.orders.find((x) => x.number === c.params.number); if (!o) throw new HttpErr(404, 'Pedido não encontrado.', 'not_found'); return getOrder(o, true); });
const ADMIN_TRANSITIONS: Record<string, string[]> = { paid: ['processing'], processing: ['shipped'], shipped: ['delivered'] };
route('PATCH', '/api/admin/orders/:number', (c) => {
  const u = requireAdmin(c); const o = S.orders.find((x) => x.number === c.params.number); if (!o) throw new HttpErr(404, 'Pedido não encontrado.', 'not_found');
  const b = z.object({ status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']).optional(), trackingCode: z.string().trim().max(60).optional().nullable(), trackingUrl: z.string().trim().url().max(300).optional().nullable().or(z.literal('')), note: z.string().trim().max(300).optional() }).parse(c.body);
  const actor = `admin:${u.id}`;
  if (b.status && b.status !== o.status) {
    if (b.status === 'cancelled') cancelOrder(o, b.note || 'Pedido cancelado pelo administrador.', actor);
    else {
      if (!(ADMIN_TRANSITIONS[o.status] ?? []).includes(b.status)) throw new HttpErr(409, `Transição não permitida: ${o.status} → ${b.status}.`, 'invalid_transition');
      if (b.status === 'shipped' && !(b.trackingCode ?? o.tracking_code)) throw new HttpErr(400, 'Informe o código de rastreamento para marcar como enviado.', 'tracking_required');
      o.status = b.status;
      addEvent(o.id, `status:${b.status}`, b.note || `Status alterado para "${ORDER_STATUS_LABEL[b.status] ?? b.status}".`, actor);
    }
  }
  if (b.trackingCode !== undefined || b.trackingUrl !== undefined) {
    const code = b.trackingCode === undefined ? o.tracking_code : b.trackingCode || null;
    const url = b.trackingUrl === undefined ? o.tracking_url : b.trackingUrl || null;
    if (code !== o.tracking_code || url !== o.tracking_url) { o.tracking_code = code; o.tracking_url = url; addEvent(o.id, 'tracking', code ? `Código de rastreamento registrado: ${code}` : 'Rastreamento removido.', actor); }
  }
  return getOrder(o, true);
});
route('GET', '/api/admin/coupons', (c) => {
  requireAdmin(c);
  return { coupons: [...S.coupons].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((cp) => {
    const rs = S.coupon_redemptions.filter((r) => r.coupon_id === cp.id);
    return { id: cp.id, code: cp.code, description: cp.description, discountType: cp.discount_type, value: cp.value, minOrderCents: cp.min_order_cents, startsAt: cp.starts_at, endsAt: cp.ends_at, maxUses: cp.max_uses, maxUsesPerUser: cp.max_uses_per_user, isActive: Boolean(cp.is_active), isDemo: Boolean(cp.is_demo), usage: { confirmed: rs.filter((r) => r.status === 'confirmed').length, reserved: rs.filter((r) => r.status === 'reserved').length, discountTotalCents: rs.filter((r) => r.status === 'confirmed').reduce((s, r) => s + r.discount_cents, 0) }, categoryIds: cp.category_ids, productIds: cp.product_ids };
  }) };
});
function saveCoupon(c: Ctx, id?: number) {
  const u = requireAdmin(c); const b = couponSchema.parse(c.body);
  if (S.coupons.some((x) => x.code === b.code && x.id !== id)) throw new HttpErr(409, 'Código já existe.', 'code_taken', { fieldErrors: { code: ['Código em uso.'] } });
  const data = { code: b.code, description: b.description, discount_type: b.discountType, value: b.value, min_order_cents: b.minOrderCents, starts_at: b.startsAt ?? null, ends_at: b.endsAt ?? null, max_uses: b.maxUses ?? null, max_uses_per_user: b.maxUsesPerUser ?? null, is_active: b.isActive ? 1 : 0, category_ids: b.categoryIds, product_ids: b.productIds };
  if (id) { const row = S.coupons.find((x) => x.id === id); if (!row) throw new HttpErr(404, 'Cupom não encontrado.', 'not_found'); Object.assign(row, data); }
  else { id = nextId('coupons'); S.coupons.push({ id, ...data, is_demo: 0, created_at: nowIso() }); }
  audit(u, 'coupon.save', 'coupon', id);
  return { ok: true, id };
}
route('POST', '/api/admin/coupons', (c) => saveCoupon(c));
route('PUT', '/api/admin/coupons/:id', (c) => saveCoupon(c, intParam(c.params.id)));
route('GET', '/api/admin/shipping-rules', (c) => { requireAdmin(c); return { rules: [...S.shipping_rules].sort((a, b) => a.position - b.position || a.id - b.id).map((r) => ({ id: r.id, name: r.name, cepStart: r.cep_start, cepEnd: r.cep_end, priceCents: r.price_cents, minDays: r.min_days, maxDays: r.max_days, freeAboveCents: r.free_above_cents, isActive: r.is_active, position: r.position })) }; });
function saveRule(c: Ctx, id?: number) {
  const u = requireAdmin(c); const b = ruleSchema.parse(c.body);
  const data = { name: b.name, cep_start: b.cepStart, cep_end: b.cepEnd, price_cents: b.priceCents, min_days: b.minDays, max_days: b.maxDays, free_above_cents: b.freeAboveCents ?? null, is_active: b.isActive ? 1 : 0, position: b.position };
  if (id) { const row = S.shipping_rules.find((x) => x.id === id); if (!row) throw new HttpErr(404, 'Regra não encontrada.', 'not_found'); Object.assign(row, data); }
  else { id = nextId('shipping_rules'); S.shipping_rules.push({ id, ...data }); }
  audit(u, 'shipping.save', 'shipping_rule', id);
  return { ok: true, id };
}
route('POST', '/api/admin/shipping-rules', (c) => saveRule(c));
route('PUT', '/api/admin/shipping-rules/:id', (c) => saveRule(c, intParam(c.params.id)));
route('DELETE', '/api/admin/shipping-rules/:id', (c) => { requireAdmin(c); const id = intParam(c.params.id); S.shipping_rules = S.shipping_rules.filter((r) => r.id !== id); return { ok: true }; });
route('GET', '/api/admin/settings', (c) => { requireAdmin(c); return clone(S.settings); });
route('PUT', '/api/admin/settings', (c) => {
  requireAdmin(c);
  const s = c.body as Settings;
  const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  S.settings = {
    announcements: (s.announcements ?? []).map((a) => str(a, 120)).filter(Boolean).slice(0, 5), heroTagline: (s.heroTagline ?? []).map((a) => str(a, 30)).filter(Boolean).slice(0, 4),
    heroCollectionLabel: (s.heroCollectionLabel ?? []).map((a) => str(a, 30)).filter(Boolean).slice(0, 4), showAccessoriesOnHome: Boolean(s.showAccessoriesOnHome),
    contact: { email: str(s.contact?.email, 120), phone: str(s.contact?.phone, 40), whatsapp: str(s.contact?.whatsapp, 40), serviceHours: str(s.contact?.serviceHours, 120) },
    company: { legalName: str(s.company?.legalName, 160), cnpj: str(s.company?.cnpj, 20), address: str(s.company?.address, 240) },
    social: { instagram: str(s.social?.instagram, 200), tiktok: str(s.social?.tiktok, 200), facebook: str(s.social?.facebook, 200) },
  };
  if (!S.settings.heroTagline.length || !S.settings.heroCollectionLabel.length) throw new HttpErr(400, 'Preencha a chamada e o selo do hero.', 'validation_error');
  return clone(S.settings);
});
route('GET', '/api/admin/customers', (c) => {
  requireAdmin(c); const q = (c.query.get('q') ?? '').trim().toLowerCase();
  return { customers: S.users.filter((u) => !q || u.email.includes(q) || u.name.toLowerCase().includes(q)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100)
    .map((u) => ({ id: u.id, email: u.email, role: u.role, createdAt: u.created_at, emailVerified: u.email_verified_at ? 1 : 0, name: u.name, orders: S.orders.filter((o) => o.user_id === u.id).length })) };
});

// ---------------------------------------------------------------- despacho
/** Executa uma "requisição" local. Alterações são gravadas apenas se a operação inteira der certo (transação). */
export async function handle(method: string, url: string, body: unknown): Promise<unknown> {
  const u = new URL(url, 'http://gazu.local');
  const r = routes.find((x) => x.method === method && x.re.test(u.pathname));
  if (!r) throw new HttpErr(routes.some((x) => x.re.test(u.pathname)) ? 405 : 404, 'Rota não encontrada.', 'not_found');
  const m = r.re.exec(u.pathname)!;
  const params: Record<string, string> = {};
  r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
  const snapshot = r.mutates ? JSON.stringify(S) : null;
  try {
    expireStale();
    const user = S.users.find((x) => x.id === S.sessionUserId) ?? null;
    const out = await r.h({ params, query: u.searchParams, body, user });
    if (r.mutates) persist();
    return out === undefined ? { ok: true } : clone(out);
  } catch (e) {
    if (snapshot) S = JSON.parse(snapshot) as State; // desfaz alterações parciais
    if (e instanceof ZodError) {
      const flat = e.flatten();
      const first = Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0] ?? 'Dados inválidos.';
      throw new HttpErr(400, String(first), 'validation_error', { fieldErrors: flat.fieldErrors, formErrors: flat.formErrors });
    }
    throw e;
  }
}
