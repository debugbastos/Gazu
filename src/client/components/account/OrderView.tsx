import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { Link } from '../../lib/router';
import { useStore } from '../../lib/store';
import { formatCep, formatDateTime, formatPrice, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from '../../../shared/format';
import type { OrderDTO, PaymentDTO } from '../../../shared/types';
import { CardForm } from '../checkout/CardForm';
import { Icon } from '../ui/Icon';
import { Button, Notice } from '../ui/ui';

export function StatusBadge({ status }: { status: OrderDTO['status'] }) {
  return <span className={`status status--${status}`}>{ORDER_STATUS_LABEL[status] ?? status}</span>;
}

const STEPS: OrderDTO['status'][] = ['pending_payment', 'paid', 'processing', 'shipped', 'delivered'];

function Progress({ status }: { status: OrderDTO['status'] }) {
  if (status === 'cancelled' || status === 'refunded') return null;
  const at = STEPS.indexOf(status);
  return (
    <ol className="order-progress" aria-label="Andamento do pedido">
      {STEPS.map((s, i) => <li key={s} className={i <= at ? 'is-done' : ''} aria-current={i === at ? 'step' : undefined}><span />{ORDER_STATUS_LABEL[s]}</li>)}
    </ol>
  );
}

function PixPanel({ payment }: { payment: PaymentDTO }) {
  const { notify } = useStore();
  const copy = async () => {
    try { await navigator.clipboard.writeText(payment.pixQrCode ?? ''); notify('Código Pix copiado.', 'success'); } catch { notify('Não foi possível copiar. Selecione o código manualmente.', 'error'); }
  };
  return (
    <div className="pix">
      {payment.pixQrBase64 ? <img className="pix__qr" src={`data:image/png;base64,${payment.pixQrBase64}`} alt="QR Code para pagamento via Pix" width={220} height={220} /> : null}
      <div className="pix__info">
        <p><strong>Pague com Pix</strong> pelo app do seu banco: escaneie o QR Code ou use o código “copia e cola”.</p>
        {payment.pixQrCode ? (
          <div className="pix__code">
            <textarea readOnly value={payment.pixQrCode} aria-label="Código Pix copia e cola" rows={3} />
            <Button variant="secondary" size="sm" icon="copy" onClick={() => void copy()}>Copiar código</Button>
          </div>
        ) : null}
        {payment.expiresAt ? <p className="muted small">Válido até {formatDateTime(payment.expiresAt)}.</p> : null}
        <p className="muted small">A confirmação é feita automaticamente pelo provedor. Esta página é atualizada sozinha.</p>
      </div>
    </div>
  );
}

/** Painel de pagamento de um pedido aguardando pagamento. */
export function PaymentPanel({ order, onOrder }: { order: OrderDTO; onOrder: (o: OrderDTO) => void }) {
  const { config, user } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<'pix' | 'credit_card' | 'demo' | null>(null);
  const pending = order.payments.find((p) => p.status === 'pending');
  const pay = async (m: 'pix' | 'credit_card' | 'demo', card?: unknown) => {
    setBusy(m);
    setError(null);
    try {
      onOrder(await api.post<OrderDTO>(`/api/checkout/orders/${order.number}/pay`, { method: m, card }));
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    } finally {
      setBusy(null);
    }
  };
  const simulate = async (paymentId: number, outcome: 'approved' | 'rejected' | 'cancelled') => {
    setBusy(outcome);
    try { onOrder(await api.post<OrderDTO>(`/api/checkout/payments/${paymentId}/simulate`, { outcome })); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };

  // Atualiza o status enquanto houver cobrança pendente (consulta o provedor no servidor).
  useEffect(() => {
    if (!pending || pending.provider !== 'mercadopago') return;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      api.get<OrderDTO>(`/api/checkout/orders/${order.number}/status`).then(onOrder).catch(() => undefined);
    }, 6000);
    return () => window.clearInterval(t);
  }, [pending, order.number, onOrder]);

  const none = !config.payments.pix && !config.payments.creditCard && !config.payments.demo;
  const lastFailed = order.payments[0] && ['rejected', 'cancelled'].includes(order.payments[0].status) ? order.payments[0] : null;

  return (
    <section className="pay-panel" aria-labelledby="pay-title">
      <h2 id="pay-title">Pagamento</h2>
      {order.expiresAt ? <p className="muted small">Conclua o pagamento até {formatDateTime(order.expiresAt)}. Depois disso o pedido é cancelado e o estoque liberado.</p> : null}
      {lastFailed && !pending ? <Notice tone="error" title={lastFailed.status === 'rejected' ? 'Pagamento recusado' : 'Pagamento cancelado'}>Você pode tentar novamente com o mesmo ou outro meio de pagamento.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {none ? <Notice tone="warning">Os meios de pagamento ainda não foram habilitados pela loja.</Notice> : null}

      {pending?.provider === 'mercadopago' && pending.method === 'pix' ? <PixPanel payment={pending} /> : null}
      {pending?.provider === 'mercadopago' && pending.method === 'credit_card' ? <Notice tone="info">Pagamento com cartão em análise pelo provedor. Atualizaremos esta página automaticamente.</Notice> : null}

      {pending?.provider === 'demo' ? (
        <div className="demo-pay">
          <Notice tone="warning" title="Pagamento simulado">Ambiente de demonstração — nenhum valor é cobrado. Escolha o resultado que o “provedor” deve retornar:</Notice>
          <div className="demo-pay__btns">
            <Button loading={busy === 'approved'} onClick={() => void simulate(pending.id, 'approved')}>Simular aprovação</Button>
            <Button variant="secondary" loading={busy === 'rejected'} onClick={() => void simulate(pending.id, 'rejected')}>Simular recusa</Button>
            <Button variant="ghost" loading={busy === 'cancelled'} onClick={() => void simulate(pending.id, 'cancelled')}>Simular cancelamento</Button>
          </div>
        </div>
      ) : null}

      {!pending && !none ? (
        <>
          <div className="pay-methods" role="radiogroup" aria-label="Meio de pagamento">
            {config.payments.pix ? <button role="radio" aria-checked={method === 'pix'} className={`pay-method${method === 'pix' ? ' is-selected' : ''}`} onClick={() => setMethod('pix')}><strong>Pix</strong><small>Aprovação em instantes</small></button> : null}
            {config.payments.creditCard ? <button role="radio" aria-checked={method === 'credit_card'} className={`pay-method${method === 'credit_card' ? ' is-selected' : ''}`} onClick={() => setMethod('credit_card')}><strong>Cartão de crédito</strong><small>{config.payments.maxInstallments > 1 ? `Em até ${config.payments.maxInstallments}x` : 'À vista'}</small></button> : null}
            {config.payments.demo ? <button role="radio" aria-checked={method === 'demo'} className={`pay-method${method === 'demo' ? ' is-selected' : ''}`} onClick={() => setMethod('demo')}><strong>Pagamento simulado</strong><small>Somente demonstração</small></button> : null}
          </div>
          {method === 'pix' ? <Button block loading={busy === 'pix'} onClick={() => void pay('pix').catch(() => undefined)}>Gerar Pix</Button> : null}
          {method === 'demo' ? <Button block loading={busy === 'demo'} onClick={() => void pay('demo').catch(() => undefined)}>Iniciar pagamento simulado</Button> : null}
          {method === 'credit_card' && config.payments.mpPublicKey ? (
            <CardForm publicKey={config.payments.mpPublicKey} amountCents={order.totalCents} email={user?.email ?? ''} maxInstallments={config.payments.maxInstallments} onSubmit={(card) => pay('credit_card', card)} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function OrderView({ order, onOrder, showPayment }: { order: OrderDTO; onOrder: (o: OrderDTO) => void; showPayment?: boolean }) {
  const [cancelling, setCancelling] = useState(false);
  const { notify } = useStore();
  const cancel = async () => {
    if (!window.confirm('Cancelar este pedido? O estoque reservado será liberado.')) return;
    setCancelling(true);
    try { onOrder(await api.post<OrderDTO>(`/api/account/orders/${order.number}/cancel`)); notify('Pedido cancelado.', 'info'); } catch (e) { notify(errorMessage(e), 'error'); } finally { setCancelling(false); }
  };
  const approved = order.payments.find((p) => p.status === 'approved');
  return (
    <div className="order-view">
      <div className="order-view__head">
        <div>
          <p className="eyebrow">Pedido {order.number}</p>
          <h1 className="page-title">{order.status === 'paid' ? 'Pagamento confirmado' : order.status === 'pending_payment' ? 'Aguardando pagamento' : ORDER_STATUS_LABEL[order.status]}</h1>
          <p className="muted">Realizado em {formatDateTime(order.createdAt)}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      {order.isDemo ? <Notice tone="info">Pedido de demonstração (contém produtos, frete ou pagamento simulados).</Notice> : null}
      {order.status === 'paid' && approved ? <Notice tone="success" title="Obrigado pela compra!">Seu pagamento foi confirmado pelo provedor. Você receberá as atualizações de envio aqui em Meus pedidos.</Notice> : null}
      {order.events.some((e) => e.type === 'payment_after_cancel') ? <Notice tone="warning">Recebemos um pagamento após o cancelamento deste pedido. Nossa equipe vai entrar em contato para o estorno ou reativação.</Notice> : null}
      <Progress status={order.status} />

      <div className="two-col">
        <div>
          {showPayment && order.status === 'pending_payment' ? <PaymentPanel order={order} onOrder={onOrder} /> : null}
          <section className="order-block" aria-labelledby="items-t">
            <h2 id="items-t">Itens</h2>
            <ul className="review-list">
              {order.items.map((it) => (
                <li key={it.sku}>
                  {it.imageUrl ? <img src={it.imageUrl} alt="" /> : <span />}
                  <span><Link to={`/produto/${it.productSlug}`}><strong>{it.productName}</strong></Link><small>{it.colorName} · Tam. {it.size} · {it.quantity} × {formatPrice(it.unitPriceCents)}</small></span>
                  <span>{formatPrice(it.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="order-block" aria-labelledby="ship-t">
            <h2 id="ship-t">Entrega</h2>
            <p><strong>{order.address.recipient}</strong><br />{order.address.street}, {order.address.number}{order.address.complement ? ` — ${order.address.complement}` : ''}<br />{order.address.district} · {order.address.city}/{order.address.state} · {formatCep(order.address.cep)}</p>
            <p>{order.shippingLabel}{order.shippingDaysText ? ` · ${order.shippingDaysText}` : ''}{order.shippingIsDemo ? ' (simulação)' : ''}</p>
            {order.trackingCode ? (
              <p className="tracking"><Icon name="truck" size={18} /> Rastreamento: <strong>{order.trackingCode}</strong>{order.trackingUrl ? <> · <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="link-underline">Acompanhar entrega</a></> : null}</p>
            ) : order.status === 'paid' || order.status === 'processing' ? <p className="muted small">O código de rastreamento aparecerá aqui quando o pedido for enviado.</p> : null}
          </section>
          {order.payments.length ? (
            <section className="order-block" aria-labelledby="pay-t">
              <h2 id="pay-t">Pagamentos</h2>
              <ul className="pay-history">
                {order.payments.map((p) => (
                  <li key={p.id}><span>{PAYMENT_METHOD_LABEL[p.method]}{p.cardLastFour ? ` final ${p.cardLastFour}` : ''}</span><span className={`pstatus pstatus--${p.status}`}>{PAYMENT_STATUS_LABEL[p.status]}</span><span>{formatPrice(p.amountCents)}</span><small>{formatDateTime(p.createdAt)}</small></li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="order-block" aria-labelledby="ev-t">
            <h2 id="ev-t">Histórico</h2>
            <ol className="timeline">
              {[...order.events].reverse().map((e, i) => <li key={i}><time>{formatDateTime(e.createdAt)}</time><span>{e.message}</span></li>)}
            </ol>
          </section>
        </div>
        <aside className="two-col__side">
          <div className="summary">
            <h2 className="summary__title">Resumo</h2>
            <div className="summary-row"><span>Subtotal</span><span>{formatPrice(order.subtotalCents)}</span></div>
            {order.discountCents ? <div className="summary-row summary-row--discount"><span>Desconto {order.couponCode ? `(${order.couponCode})` : ''}</span><span>− {formatPrice(order.discountCents)}</span></div> : null}
            <div className="summary-row"><span>Entrega</span><span>{order.shippingCents ? formatPrice(order.shippingCents) : 'Grátis'}</span></div>
            <div className="summary-row summary-row--total"><span>Total</span><strong>{formatPrice(order.totalCents)}</strong></div>
            {order.status === 'pending_payment' ? <Button variant="ghost" size="sm" block loading={cancelling} onClick={() => void cancel()}>Cancelar pedido</Button> : null}
            <Link to="/conta/pedidos" className="link-underline">Ver todos os pedidos</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
