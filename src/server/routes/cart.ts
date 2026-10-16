import { z } from 'zod';
import { requireUser, type Router } from '../http.ts';
import { getUserCartItems, mergeCarts, quoteCart, setUserCartItems } from '../services/cart.ts';
import { quoteShipping } from '../services/shipping.ts';
import { cartItemsSchema, cepSchema, quoteSchema } from '../validation.ts';
import { getDb } from '../db.ts';
import { productsByIds } from '../services/catalog.ts';
import { rateLimit } from '../security.ts';

export function registerCartRoutes(r: Router): void {
  // Calcula o carrinho (preços, estoque, cupom e frete) a partir dos itens — sempre no servidor.
  r.post('/api/cart/quote', async (ctx) => {
    const body = await ctx.body(quoteSchema);
    if (body.couponCode) rateLimit(`coupon:${ctx.ip}`, 30, 60_000);
    return quoteCart({ ...body, userId: ctx.user?.id ?? null });
  });

  r.post('/api/shipping/quote', async (ctx) => {
    rateLimit(`ship:${ctx.ip}`, 60, 60_000);
    const body = await ctx.body(z.object({ cep: cepSchema, subtotalCents: z.number().int().min(0).max(100_000_000).default(0) }));
    return quoteShipping(body.cep, body.subtotalCents);
  });

  // Carrinho persistido para clientes autenticados
  r.get('/api/cart', (ctx) => ({ items: getUserCartItems(requireUser(ctx).id) }));
  r.put('/api/cart', async (ctx) => {
    const u = requireUser(ctx);
    const body = await ctx.body(z.object({ items: cartItemsSchema }));
    setUserCartItems(u.id, body.items);
    return { items: getUserCartItems(u.id) };
  });
  r.post('/api/cart/merge', async (ctx) => {
    const u = requireUser(ctx);
    const body = await ctx.body(z.object({ items: cartItemsSchema }));
    return { items: mergeCarts(u.id, body.items) };
  });

  // Favoritos
  r.get('/api/favorites', (ctx) => {
    const u = requireUser(ctx);
    const ids = getDb().all<{ product_id: number }>('SELECT product_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC', u.id).map((x) => x.product_id);
    return { ids, items: productsByIds(ids) };
  });
  r.put('/api/favorites/:productId', (ctx) => {
    const u = requireUser(ctx);
    const id = Number(ctx.params.productId);
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false };
    const exists = getDb().get('SELECT 1 FROM products WHERE id = ? AND is_active = 1', id);
    if (exists) getDb().run('INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)', u.id, id);
    return { ok: Boolean(exists) };
  });
  r.delete('/api/favorites/:productId', (ctx) => {
    const u = requireUser(ctx);
    getDb().run('DELETE FROM favorites WHERE user_id = ? AND product_id = ?', u.id, Number(ctx.params.productId));
    return { ok: true };
  });
  r.post('/api/favorites/merge', async (ctx) => {
    const u = requireUser(ctx);
    const body = await ctx.body(z.object({ ids: z.array(z.number().int().positive()).max(200) }));
    const db = getDb();
    db.tx(() => {
      for (const id of body.ids) if (db.get('SELECT 1 FROM products WHERE id = ?', id)) db.run('INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)', u.id, id);
    });
    const ids = db.all<{ product_id: number }>('SELECT product_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC', u.id).map((x) => x.product_id);
    return { ids };
  });
}
