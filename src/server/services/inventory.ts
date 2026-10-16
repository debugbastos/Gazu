import { getDb } from '../db.ts';
import { HttpError } from '../http.ts';

export type MovementReason = 'initial' | 'adjustment' | 'order_reserve' | 'order_release' | 'restock';

/**
 * Altera o estoque de forma atômica. A atualização condicional (stock + delta >= 0)
 * impede vender acima do disponível mesmo com pedidos simultâneos.
 * Deve ser chamada dentro de db.tx() quando fizer parte de uma operação maior.
 */
export function moveStock(variantId: number, delta: number, reason: MovementReason, actor: string, orderId: number | null = null, note: string | null = null): number {
  if (!Number.isInteger(delta) || delta === 0) throw new HttpError(400, 'Quantidade de ajuste inválida.', 'bad_delta');
  const db = getDb();
  const r = db.run('UPDATE product_variants SET stock = stock + ? WHERE id = ? AND stock + ? >= 0', delta, variantId, delta);
  if (r.changes !== 1) {
    const exists = db.get<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', variantId);
    if (!exists) throw new HttpError(404, 'Variante não encontrada.', 'variant_not_found');
    throw new HttpError(409, 'Estoque insuficiente para esta operação.', 'insufficient_stock', { variantId, available: exists.stock });
  }
  db.run('INSERT INTO inventory_movements (variant_id, delta, reason, order_id, actor, note) VALUES (?, ?, ?, ?, ?, ?)', variantId, delta, reason, orderId, actor, note);
  return db.get<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', variantId)!.stock;
}
