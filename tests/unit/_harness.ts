import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/server/app.ts';
import { getDb } from '../../src/server/db.ts';
import { seedDatabase } from '../../src/server/cli/seed-data.ts';
import { hashPassword } from '../../src/server/auth/password.ts';

export interface Client {
  base: string;
  req<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Headers }>;
}

let started: Promise<string> | null = null;

/** Sobe o app real (HTTP) uma única vez por arquivo de teste, com catálogo de demonstração. */
export function boot(): Promise<string> {
  started ??= (async () => {
    const db = getDb();
    db.migrate();
    seedDatabase(db);
    const server = createApp();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    server.unref();
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  })();
  return started;
}

/** Cliente HTTP com cookie de sessão e cabeçalho Origin (o servidor exige mesma origem em POST/PUT/DELETE). */
export async function client(): Promise<Client> {
  const base = await boot();
  let cookie = '';
  return {
    base,
    async req(method, path, body, headers = {}) {
      const resp = await fetch(base + path, {
        method,
        headers: { Origin: base, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
      const set = resp.headers.getSetCookie?.() ?? [];
      for (const c of set) {
        const [pair] = c.split(';');
        if (pair?.startsWith('gazu_session=')) cookie = pair.endsWith('=') ? '' : pair;
      }
      const text = await resp.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* não-JSON */ }
      return { status: resp.status, body: parsed as any, headers: resp.headers };
    },
  };
}

let seq = 0;
/** Cria e autentica um cliente novo. */
export async function customer(): Promise<Client & { email: string }> {
  const c = await client();
  const email = `cliente${Date.now()}${++seq}@teste.dev`;
  const r = await c.req('POST', '/api/auth/register', { name: 'Cliente Teste', email, password: 'senhaSegura123', acceptTerms: true });
  if (r.status !== 200) throw new Error(`cadastro falhou: ${r.status} ${JSON.stringify(r.body)}`);
  return Object.assign(c, { email });
}

/** Cria um administrador diretamente no banco (como faz o comando admin:create) e autentica. */
export async function admin(): Promise<Client> {
  await boot();
  const db = getDb();
  const email = `admin${++seq}@teste.dev`;
  const id = crypto.randomUUID();
  db.run("INSERT INTO users (id, email, password_hash, role, email_verified_at) VALUES (?, ?, ?, 'admin', ?)", id, email, await hashPassword('adminSeguro123'), new Date().toISOString());
  db.run('INSERT INTO profiles (user_id, full_name) VALUES (?, ?)', id, 'Admin');
  const c = await client();
  const r = await c.req('POST', '/api/auth/login', { email, password: 'adminSeguro123' });
  if (r.status !== 200) throw new Error(`login admin falhou: ${r.status}`);
  return c;
}

/** Primeira variante com estoque de um produto. */
export function inStockVariant(minStock = 1): { id: number; stock: number; productId: number; priceCents: number } {
  const v = getDb().get<{ id: number; stock: number; product_id: number; price: number }>(
    `SELECT v.id, v.stock, v.product_id, p.price_cents AS price FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.stock >= ? AND v.is_active = 1 AND p.is_active = 1 ORDER BY v.id LIMIT 1`, minStock);
  if (!v) throw new Error('sem variante com estoque');
  return { id: v.id, stock: v.stock, productId: v.product_id, priceCents: v.price };
}

export const ADDRESS = { recipient: 'Cliente Teste', cep: '01310100', street: 'Avenida Paulista', number: '1000', complement: null, district: 'Bela Vista', city: 'São Paulo', state: 'SP', label: 'Casa', isDefault: false };

/** Cria um pedido válido (cotação → escolha de frete → pedido) e retorna o DTO. */
export async function placeOrder(c: Client, items: { variantId: number; quantity: number }[], couponCode: string | null = null) {
  const q = await c.req('POST', '/api/cart/quote', { items, couponCode, cep: ADDRESS.cep, shippingOptionId: null });
  const ship = q.body.shippingOptions[0];
  const q2 = await c.req('POST', '/api/cart/quote', { items, couponCode, cep: ADDRESS.cep, shippingOptionId: ship.id });
  const o = await c.req('POST', '/api/checkout/orders', { items, couponCode, shippingOptionId: ship.id, expectedTotalCents: q2.body.totalCents, address: ADDRESS, saveAddress: false });
  return { quote: q2.body, res: o };
}
