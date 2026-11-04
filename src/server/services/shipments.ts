import { defaultPackage, features } from '../config.ts';
import { getDb, nowIso } from '../db.ts';
import { HttpError } from '../http.ts';
import { emit } from '../events.ts';
import { onlyDigits, SHIPMENT_STATUS_LABEL } from '../../shared/format.ts';
import type { ShipmentStatus } from '../../shared/types.ts';
import { addOrderEvent } from './orders.ts';
import { getSettings } from './settings.ts';
import { mapMeStatus, purchaseLabel, trackShipments, type MeParty } from './melhorenvio.ts';
import { audit } from './audit.ts';
import { logError } from './monitoring.ts';

// Envios: cada pedido pode ter um ou mais envios (ex.: reenvio de troca). O status do envio é separado
// do status do pedido; algumas etapas do envio avançam o pedido (enviado → "Enviado", entregue → "Entregue").

const SHIP_ORDER: ShipmentStatus[] = ['pending', 'preparing', 'label_purchased', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'];

function advanceOrder(orderId: number, shipStatus: ShipmentStatus, actor: string): void {
  const db = getDb();
  const o = db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', orderId)!;
  const now = nowIso();
  if (['shipped', 'in_transit', 'out_for_delivery'].includes(shipStatus) && ['paid', 'processing'].includes(o.status)) {
    db.run("UPDATE orders SET status = 'shipped', updated_at = ? WHERE id = ?", now, orderId);
    addOrderEvent(orderId, 'status:shipped', 'Pedido enviado.', actor);
  } else if (shipStatus === 'delivered' && ['paid', 'processing', 'shipped'].includes(o.status)) {
    db.run("UPDATE orders SET status = 'delivered', updated_at = ? WHERE id = ?", now, orderId);
    addOrderEvent(orderId, 'status:delivered', 'Entrega confirmada.', actor);
  } else if (['preparing', 'label_purchased'].includes(shipStatus) && o.status === 'paid') {
    db.run("UPDATE orders SET status = 'processing', updated_at = ? WHERE id = ?", now, orderId);
    addOrderEvent(orderId, 'status:processing', 'Pedido em preparação.', actor);
  }
}

export interface ShipmentPatch {
  status?: ShipmentStatus; carrier?: string | null; service?: string | null; trackingCode?: string | null; trackingUrl?: string | null; costCents?: number | null;
  description?: string | null; location?: string | null; occurredAt?: string | null;
}

export function createShipment(orderId: number, actor: string, data: ShipmentPatch & { note?: string | null }): number {
  const db = getDb();
  return db.tx(() => {
    const o = db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', orderId);
    if (!o) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
    if (['pending_payment', 'cancelled'].includes(o.status)) throw new HttpError(409, 'Envios só podem ser criados para pedidos pagos.', 'not_paid');
    const id = db.run('INSERT INTO shipments (order_id, status, provider, carrier, service, tracking_code, tracking_url, cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      orderId, 'pending', 'manual', data.carrier ?? null, data.service ?? null, data.trackingCode ?? null, data.trackingUrl ?? null, data.costCents ?? null).lastInsertRowid;
    db.run("INSERT INTO shipment_events (shipment_id, status, description, source, occurred_at) VALUES (?, 'pending', ?, 'admin', ?)", id, data.note?.trim() || 'Envio registrado.', nowIso());
    addOrderEvent(orderId, 'shipment_created', data.note?.trim() || 'Novo envio registrado.', actor);
    audit({ actor, action: 'shipment.create', entity: 'order', entityId: orderId, data });
    return id;
  });
}

export function updateShipment(shipmentId: number, actor: string, patch: ShipmentPatch, source: 'admin' | 'provider' | 'system' = 'admin'): void {
  const db = getDb();
  db.tx(() => {
    const s = db.get<{ id: number; order_id: number; status: ShipmentStatus; tracking_code: string | null }>('SELECT * FROM shipments WHERE id = ?', shipmentId);
    if (!s) throw new HttpError(404, 'Envio não encontrado.', 'not_found');
    const now = nowIso();
    if (patch.status === 'shipped' && !(patch.trackingCode ?? s.tracking_code) && source === 'admin') {
      throw new HttpError(400, 'Informe o código de rastreamento para marcar como enviado.', 'tracking_required');
    }
    db.run(
      `UPDATE shipments SET carrier = COALESCE(?, carrier), service = COALESCE(?, service), tracking_code = COALESCE(?, tracking_code), tracking_url = COALESCE(?, tracking_url),
         cost_cents = COALESCE(?, cost_cents), updated_at = ? WHERE id = ?`,
      patch.carrier ?? null, patch.service ?? null, patch.trackingCode ?? null, patch.trackingUrl ?? null, patch.costCents ?? null, now, s.id,
    );
    if (patch.trackingCode !== undefined && patch.trackingCode) {
      db.run('UPDATE orders SET tracking_code = ?, tracking_url = COALESCE(?, tracking_url), updated_at = ? WHERE id = ?', patch.trackingCode, patch.trackingUrl ?? null, now, s.order_id);
    }
    if (patch.status && patch.status !== s.status) {
      const occurred = patch.occurredAt ?? now;
      db.run(
        `UPDATE shipments SET status = ?, shipped_at = CASE WHEN ? IN ('shipped','in_transit','out_for_delivery','delivered') THEN COALESCE(shipped_at, ?) ELSE shipped_at END,
           delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, ?) ELSE delivered_at END, updated_at = ? WHERE id = ?`,
        patch.status, patch.status, occurred, patch.status, occurred, now, s.id,
      );
      db.run('INSERT INTO shipment_events (shipment_id, status, description, location, source, occurred_at) VALUES (?, ?, ?, ?, ?, ?)',
        s.id, patch.status, patch.description?.trim() || SHIPMENT_STATUS_LABEL[patch.status] || patch.status, patch.location ?? null, source, occurred);
      advanceOrder(s.order_id, patch.status, actor);
      emit('shipment.updated', { orderId: s.order_id, shipmentId: s.id, status: patch.status });
    } else if (patch.description?.trim()) {
      db.run('INSERT INTO shipment_events (shipment_id, status, description, location, source, occurred_at) VALUES (?, ?, ?, ?, ?, ?)', s.id, s.status, patch.description.trim(), patch.location ?? null, source, patch.occurredAt ?? now);
    }
    if (source === 'admin') audit({ actor, action: 'shipment.update', entity: 'shipment', entityId: s.id, data: patch });
  });
}

/** Campos do remetente que faltam para comprar etiquetas. */
export function senderMissing(): string[] {
  const s = getSettings().shippingSender;
  const labels: Record<string, string> = { name: 'nome', phone: 'telefone', email: 'e-mail', document: 'CPF/CNPJ', street: 'rua', number: 'número', district: 'bairro', city: 'cidade', state: 'UF', cep: 'CEP' };
  return Object.entries(labels).filter(([k]) => !String((s as Record<string, string>)[k] ?? '').trim()).map(([, v]) => v);
}

/** Compra a etiqueta no Melhor Envio usando o serviço escolhido pelo cliente no checkout. */
export async function buyMelhorEnvioLabel(orderId: number, actor: string): Promise<number> {
  if (!features.melhorEnvio) throw new HttpError(503, 'Integração com o Melhor Envio não configurada (token e CEP de origem).', 'shipping_not_configured');
  const missing = senderMissing();
  if (missing.length) throw new HttpError(409, `Complete os dados do remetente em Configurações: ${missing.join(', ')}.`, 'sender_incomplete', { missing });
  const db = getDb();
  const o = db.get<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
  if (!['paid', 'processing'].includes(o.status as string)) throw new HttpError(409, 'A etiqueta só pode ser comprada para pedidos pagos ainda não enviados.', 'invalid_status');
  if (o.is_demo) throw new HttpError(409, 'Pedidos de demonstração não geram etiquetas reais.', 'demo_order');
  const match = /^me:(\d+)$/.exec(String(o.shipping_option_id));
  if (!match) throw new HttpError(409, 'Este pedido não usou uma cotação do Melhor Envio; registre o envio manualmente.', 'not_melhorenvio');
  const existing = db.get<{ id: number }>("SELECT id FROM shipments WHERE order_id = ? AND provider = 'melhorenvio' AND status <> 'cancelled'", orderId);
  if (existing) throw new HttpError(409, 'Já existe uma etiqueta ativa para este pedido.', 'label_exists');

  const s = getSettings().shippingSender;
  const customer = db.get<{ email: string; phone: string | null }>('SELECT COALESCE(o.customer_email, u.email) AS email, p.phone FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN profiles p ON p.user_id = u.id WHERE o.id = ?', orderId)!;
  const doc = onlyDigits(s.document);
  const from: MeParty = {
    name: s.name, phone: onlyDigits(s.phone), email: s.email, ...(doc.length > 11 ? { company_document: doc } : { document: doc }),
    address: s.street, complement: s.complement || null, number: s.number, district: s.district, city: s.city, state_abbr: s.state.toUpperCase(), country_id: 'BR', postal_code: onlyDigits(s.cep),
  };
  const to: MeParty = {
    name: String(o.ship_recipient), email: customer.email, phone: onlyDigits(customer.phone ?? ''), address: String(o.ship_street), complement: (o.ship_complement as string) ?? null,
    number: String(o.ship_number), district: String(o.ship_district), city: String(o.ship_city), state_abbr: String(o.ship_state), country_id: 'BR', postal_code: String(o.ship_cep),
  };
  const items = db.all<{ product_name: string; quantity: number; unit_price_cents: number; product_id: number | null }>('SELECT product_name, quantity, unit_price_cents, product_id FROM order_items WHERE order_id = ?', orderId);
  // Volume único: soma dos pesos, maior dimensão de cada eixo (ou embalagem padrão).
  let weight = 0, length = 0, width = 0, height = 0;
  for (const it of items) {
    const p = it.product_id ? db.get<{ weight_grams: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null }>('SELECT weight_grams, length_cm, width_cm, height_cm FROM products WHERE id = ?', it.product_id) : null;
    weight += (p?.weight_grams ?? defaultPackage.weightGrams) * it.quantity;
    length = Math.max(length, p?.length_cm ?? defaultPackage.lengthCm);
    width = Math.max(width, p?.width_cm ?? defaultPackage.widthCm);
    height = Math.max(height, p?.height_cm ?? defaultPackage.heightCm);
  }
  const productsTotal = Number(o.subtotal_cents) / 100;
  try {
    const result = await purchaseLabel({
      serviceId: Number(match[1]), from, to, orderNumber: String(o.number), insuranceValue: productsTotal,
      products: items.map((i) => ({ name: i.product_name, quantity: i.quantity, unitary_value: i.unit_price_cents / 100 })),
      volume: { height, width, length, weight: weight / 1000 },
    });
    const id = db.tx(() => {
      const sid = db.run(
        "INSERT INTO shipments (order_id, status, provider, carrier, service, tracking_code, label_url, provider_shipment_id, cost_cents) VALUES (?, 'label_purchased', 'melhorenvio', ?, ?, ?, ?, ?, ?)",
        orderId, String(o.shipping_label).split(' ')[0] ?? null, String(o.shipping_label), result.tracking, result.labelUrl, result.meOrderId, Number(o.shipping_cents),
      ).lastInsertRowid;
      db.run("INSERT INTO shipment_events (shipment_id, status, description, source, occurred_at) VALUES (?, 'label_purchased', 'Etiqueta comprada no Melhor Envio.', 'provider', ?)", sid, nowIso());
      // O envio manual "em preparação" (se existir) é substituído pela etiqueta.
      db.run("UPDATE shipments SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND provider = 'manual' AND status IN ('pending','preparing') AND id <> ?", nowIso(), orderId, sid);
      advanceOrder(orderId, 'label_purchased', actor);
      addOrderEvent(orderId, 'label_purchased', 'Etiqueta de envio gerada no Melhor Envio.', actor);
      return sid;
    });
    audit({ actor, action: 'shipment.label', entity: 'order', entityId: orderId, data: { meOrderId: result.meOrderId } });
    return id;
  } catch (e) {
    audit({ actor, action: 'shipment.label', entity: 'order', entityId: orderId, result: 'failed', data: { error: (e as Error).message } });
    throw e;
  }
}

/** Sincroniza o rastreio dos envios do Melhor Envio (rotina periódica e botão no painel). */
export async function syncMelhorEnvioTracking(): Promise<{ checked: number; updated: number }> {
  if (!features.melhorEnvio) return { checked: 0, updated: 0 };
  const db = getDb();
  const rows = db.all<{ id: number; provider_shipment_id: string; status: ShipmentStatus; tracking_code: string | null }>(
    "SELECT id, provider_shipment_id, status, tracking_code FROM shipments WHERE provider = 'melhorenvio' AND provider_shipment_id IS NOT NULL AND status NOT IN ('delivered','cancelled','returned') LIMIT 100",
  );
  if (!rows.length) return { checked: 0, updated: 0 };
  let updated = 0;
  try {
    const data = await trackShipments(rows.map((r) => r.provider_shipment_id));
    for (const r of rows) {
      const t = data[r.provider_shipment_id];
      if (!t) continue;
      const mapped = mapMeStatus(t.status);
      const patch: ShipmentPatch = {};
      if (t.tracking && t.tracking !== r.tracking_code) patch.trackingCode = t.tracking;
      if (mapped && mapped !== r.status && SHIP_ORDER.indexOf(mapped) >= SHIP_ORDER.indexOf(r.status)) {
        patch.status = mapped;
        patch.occurredAt = (mapped === 'delivered' ? t.delivered_at : mapped === 'shipped' ? t.posted_at : null) ?? undefined;
      } else if (mapped && (mapped === 'cancelled' || mapped === 'delivery_failed') && mapped !== r.status) {
        patch.status = mapped;
      }
      if (Object.keys(patch).length) {
        updateShipment(r.id, 'provider:melhorenvio', patch, 'provider');
        updated++;
      }
    }
  } catch (e) {
    logError('warn', 'shipping:tracking', e);
    throw e;
  }
  return { checked: rows.length, updated };
}
