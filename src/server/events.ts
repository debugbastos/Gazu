import { getDb } from './db.ts';
import { logError } from './services/monitoring.ts';

// Barramento de eventos de domínio. Os assinantes (notificações, alertas de estoque, analytics)
// só são executados DEPOIS do COMMIT da transação que gerou o evento — se a operação for desfeita,
// nenhuma comunicação é enviada.

export interface DomainEvents {
  'order.created': { orderId: number };
  'order.paid': { orderId: number };
  'order.payment_pending': { orderId: number; paymentId: number };
  'order.status': { orderId: number; status: string };
  'order.cancelled': { orderId: number; reason: string };
  'shipment.updated': { orderId: number; shipmentId: number; status: string };
  'refund.confirmed': { orderId: number; refundId: number; amountCents: number };
  'return.updated': { returnId: number; status: string };
  'stock.restored': { variantId: number };
  'ticket.replied': { ticketId: number; messageId: number };
}
type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => void | Promise<void>;

const handlers = new Map<keyof DomainEvents, Handler<keyof DomainEvents>[]>();

export function on<K extends keyof DomainEvents>(event: K, handler: Handler<K>): void {
  const list = handlers.get(event) ?? [];
  list.push(handler as Handler<keyof DomainEvents>);
  handlers.set(event, list);
}

export function emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
  const list = handlers.get(event);
  if (!list?.length) return;
  getDb().onCommit(() => {
    for (const h of list) {
      Promise.resolve()
        .then(() => h(payload))
        .catch((e: unknown) => logError('error', `event:${event}`, e, { payload }));
    }
  });
}

export function clearHandlers(): void {
  handlers.clear();
}
