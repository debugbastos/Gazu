import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { Link } from '../../lib/router';
import { useStore } from '../../lib/store';
import {
  formatCep, formatDate, formatDateTime, formatPrice, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, RETURN_STATUS_LABEL, RETURN_TYPE_LABEL, SHIPMENT_STATUS_LABEL,
} from '../../../shared/format';
import type { OrderDTO, PaymentDTO, ReturnDTO, ReturnType } from '../../../shared/types';
import { CardForm } from '../checkout/CardForm';
import { Icon } from '../ui/Icon';
import { Button, Dialog, Field, Notice, TextareaField } from '../ui/ui';

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

function CopyField({ value, label }: { value: string; label: string }) {
  const { notify } = useStore();
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); notify(`${label} copiado.`, 'success'); } catch { notify('Não foi possível copiar. Selecione o código manualmente.', 'error'); }
  };
  return (
    <div className="pix__code">
      <textarea readOnly value={value} aria-label={label} rows={3} />
      <Button variant="secondary" size="sm" icon="copy" onClick={() => void copy()}>Copiar</Button>
    </div>
  );
}

function PixPanel({ payment }: { payment: PaymentDTO }) {
  return (
    <div className="pix">
      {payment.pixQrBase64 ? <img className="pix__qr" src={`data:image/png;base64,${payment.pixQrBase64}`} alt="QR Code para pagamento via Pix" width={220} height={220} /> : null}
      <div className="pix__info">
        <p><strong>Pague com Pix</strong> pelo app do seu banco: escaneie o QR Code ou use o código “copia e cola”.</p>
        {payment.pixQrCode ? <CopyField value={payment.pixQrCode} label="Código Pix" /> : null}
        {payment.expiresAt ? <p className="muted small">Válido até {formatDateTime(payment.expiresAt)}.</p> : null}
        <p className="muted small">A confirmação é feita automaticamente pelo provedor. Esta página é atualizada sozinha.</p>
      </div>
    </div>
  );
}

function BoletoPanel({ payment }: { payment: PaymentDTO }) {
  return (
    <div className="pix boleto">
      <div className="pix__info">
        <p><strong>Boleto gerado.</strong> Pague no app do banco, internet banking ou lotérica até o vencimento.</p>
        {payment.boletoBarcode ? <CopyField value={payment.boletoBarcode} label="Linha digitável do boleto" /> : null}
        {payment.boletoUrl ? <a className="btn btn--secondary btn--sm" href={payment.boletoUrl} target="_blank" rel="noopener noreferrer"><span className="btn__label">Abrir boleto</span><Icon name="external" size={16} /></a> : null}
        {payment.expiresAt ? <p className="muted small">Vencimento: {formatDate(payment.expiresAt)}. A compensação pode levar até 3 dias úteis após o pagamento.</p> : null}
      </div>
    </div>
  );
}

function BoletoForm({ onSubmit, busy, name }: { onSubmit: (b: { firstName: string; lastName: string; cpf: string }) => void; busy: boolean; name: string }) {
  const [first = '', ...rest] = name.trim().split(/\s+/);
  const [v, setV] = useState({ firstName: first, lastName: rest.join(' '), cpf: '' });
  return (
    <form className="form-stack boleto-form" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <div className="form-grid">
        <Field label="Nome" value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} required autoComplete="given-name" />
        <Field label="Sobrenome" value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} required autoComplete="family-name" />
      </div>
      <Field label="CPF do pagador" value={v.cpf} onChange={(e) => setV({ ...v, cpf: e.target.value })} required inputMode="numeric" placeholder="000.000.000-00" maxLength={14} hint="Exigido pelo banco para emitir o boleto. Usado somente nesta cobrança." />
      <Button block loading={busy}>Gerar boleto</Button>
    </form>
  );
}

/** Painel de pagamento de um pedido aguardando pagamento (cliente com conta ou visitante). */
export function PaymentPanel({ order, onOrder }: { order: OrderDTO; onOrder: (o: OrderDTO) => void }) {
  const { config, user } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<'pix' | 'credit_card' | 'boleto' | 'demo' | null>(null);
  const [inst, setInst] = useState<{ available: boolean; maxNoInterest: number; maxInstallments: number } | null>(null);
  const pending = order.payments.find((p) => p.status === 'pending' || p.status === 'in_process');
  const pay = async (m: 'pix' | 'credit_card' | 'boleto' | 'demo', extra?: Record<string, unknown>) => {
    setBusy(m);
    setError(null);
    try {
      onOrder(await api.post<OrderDTO>(`/api/checkout/orders/${order.number}/pay`, { method: m, ...extra }));
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

  useEffect(() => {
    if (!config.payments.creditCard) return;
    api.get<typeof inst>(`/api/checkout/installments?amount=${order.totalCents}`).then(setInst).catch(() => setInst(null));
  }, [config.payments.creditCard, order.totalCents]);

  // Atualiza o status enquanto houver cobrança pendente (o servidor consulta o provedor).
  useEffect(() => {
    if (!pending || pending.provider !== 'mercadopago') return;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      api.get<OrderDTO>(`/api/checkout/orders/${order.number}/status`).then(onOrder).catch(() => undefined);
    }, pending.method === 'boleto' ? 30000 : 6000);
    return () => window.clearInterval(t);
  }, [pending, order.number, onOrder]);

  const none = !config.payments.pix && !config.payments.creditCard && !config.payments.boleto && !config.payments.demo;
  const lastFailed = order.payments[0] && ['rejected', 'cancelled', 'expired'].includes(order.payments[0].status) ? order.payments[0] : null;
  const cardHint = inst?.available ? (inst.maxNoInterest > 1 ? `Em até ${inst.maxNoInterest}x sem juros${inst.maxInstallments > inst.maxNoInterest ? ` ou ${inst.maxInstallments}x com juros do provedor` : ''}` : inst.maxInstallments > 1 ? `Em até ${inst.maxInstallments}x (juros informados pelo provedor)` : 'À vista') : config.payments.maxInstallments > 1 ? 'Parcelamento conforme o provedor' : 'À vista';

  return (
    <section className="pay-panel" aria-labelledby="pay-title">
      <h2 id="pay-title">Pagamento</h2>
      {order.expiresAt ? <p className="muted small">Conclua o pagamento até {formatDateTime(order.expiresAt)}. Depois disso o pedido é cancelado e o estoque liberado.</p> : null}
      {lastFailed && !pending ? <Notice tone="error" title={lastFailed.status === 'rejected' ? 'Pagamento recusado' : lastFailed.status === 'expired' ? 'Cobrança expirada' : 'Pagamento cancelado'}>Você pode tentar novamente com o mesmo ou outro meio de pagamento.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {none ? <Notice tone="warning">Os meios de pagamento ainda não foram habilitados pela loja.</Notice> : null}

      {pending?.provider === 'mercadopago' && pending.method === 'pix' ? <PixPanel payment={pending} /> : null}
      {pending?.provider === 'mercadopago' && pending.method === 'boleto' ? <BoletoPanel payment={pending} /> : null}
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
            {config.payments.creditCard ? <button role="radio" aria-checked={method === 'credit_card'} className={`pay-method${method === 'credit_card' ? ' is-selected' : ''}`} onClick={() => setMethod('credit_card')}><strong>Cartão de crédito</strong><small>{cardHint}</small></button> : null}
            {config.payments.boleto ? <button role="radio" aria-checked={method === 'boleto'} className={`pay-method${method === 'boleto' ? ' is-selected' : ''}`} onClick={() => setMethod('boleto')}><strong>Boleto</strong><small>Vence em {config.payments.boletoDays} dias</small></button> : null}
            {config.payments.demo ? <button role="radio" aria-checked={method === 'demo'} className={`pay-method${method === 'demo' ? ' is-selected' : ''}`} onClick={() => setMethod('demo')}><strong>Pagamento simulado</strong><small>Somente demonstração</small></button> : null}
          </div>
          {method === 'pix' ? <Button block loading={busy === 'pix'} onClick={() => void pay('pix').catch(() => undefined)}>Gerar Pix</Button> : null}
          {method === 'boleto' ? <BoletoForm busy={busy === 'boleto'} name={order.customer?.name ?? user?.name ?? ''} onSubmit={(b) => void pay('boleto', { boleto: b }).catch(() => undefined)} /> : null}
          {method === 'demo' ? <Button block loading={busy === 'demo'} onClick={() => void pay('demo').catch(() => undefined)}>Iniciar pagamento simulado</Button> : null}
          {method === 'credit_card' && config.payments.mpPublicKey ? (
            <CardForm publicKey={config.payments.mpPublicKey} amountCents={order.totalCents} email={order.customer?.email ?? user?.email ?? ''} maxInstallments={inst?.maxInstallments ?? config.payments.maxInstallments} onSubmit={(card) => pay('credit_card', { card })} />
          ) : null}
          <p className="muted small"><Icon name="lock" size={14} /> Pagamento processado pelo Mercado Pago. A GAZU não recebe nem armazena dados do cartão.</p>
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Trocas e devoluções pelo próprio pedido
// ---------------------------------------------------------------------------------------------
interface ReturnsInfo { eligibility: { deliveredAt: string | null; options: { type: ReturnType; allowed: boolean; deadline: string | null; reason: string | null }[] }; returns: ReturnDTO[] }

function ReturnsBlock({ order }: { order: OrderDTO }) {
  const { notify } = useStore();
  const [info, setInfo] = useState<ReturnsInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReturnType>('withdrawal');
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState<Record<number, number>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<ReturnsInfo>(`/api/orders/${order.number}/returns`).then(setInfo).catch(() => setInfo(null));
  useEffect(() => { if (order.canRequestReturn || order.returns?.length) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [order.number, order.status]);
  if (!info) return null;
  const allowed = info.eligibility.options.filter((o) => o.allowed);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([id, q]) => ({ orderItemId: Number(id), quantity: q }));
    if (!items.length) { setError('Selecione ao menos um item.'); return; }
    setSending(true);
    try {
      await api.post(`/api/orders/${order.number}/returns`, { type, reason, items });
      setOpen(false); setReason(''); setQty({});
      notify('Solicitação registrada. Você receberá as próximas instruções por e-mail.', 'success');
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : errorMessage(err));
    } finally { setSending(false); }
  };
  return (
    <section className="order-block" aria-labelledby="ret-t">
      <h2 id="ret-t">Trocas e devoluções</h2>
      {info.returns.map((r) => (
        <div key={r.id} className="return-card">
          <p><strong>{r.number}</strong> · {RETURN_TYPE_LABEL[r.type]} · <span className="tag">{RETURN_STATUS_LABEL[r.status]}</span></p>
          <ul className="muted small">{r.items.map((i) => <li key={i.orderItemId}>{i.quantity}× {i.productName} ({i.colorName}, {i.size})</li>)}</ul>
          <ol className="timeline">{[...r.events].reverse().map((e, i) => <li key={i}><time>{formatDateTime(e.createdAt)}</time><span>{e.message}</span></li>)}</ol>
        </div>
      ))}
      {allowed.length ? (
        <>
          <p className="muted small">{info.eligibility.options.filter((o) => o.deadline).map((o) => `${RETURN_TYPE_LABEL[o.type]}: ${o.allowed ? `até ${formatDate(o.deadline!)}` : 'prazo encerrado'}`).join(' · ')}</p>
          <Button variant="secondary" size="sm" icon="returns" onClick={() => setOpen(true)}>Solicitar troca ou devolução</Button>
        </>
      ) : order.status === 'delivered' ? <p className="muted small">Os prazos para solicitar troca ou devolução deste pedido terminaram. Fale com o <Link to={`/atendimento?pedido=${order.number}&assunto=troca`} className="link-underline">atendimento</Link> se precisar.</p> : null}
      <Dialog open={open} onClose={() => setOpen(false)} title="Solicitar troca ou devolução">
        <form className="dialog__body form-stack" onSubmit={submit}>
          <fieldset className="addr-options">
            <legend className="field-legend">Tipo de solicitação</legend>
            {allowed.map((o) => (
              <label key={o.type} className={`addr-option${type === o.type ? ' is-selected' : ''}`}>
                <input type="radio" name="rtype" checked={type === o.type} onChange={() => setType(o.type)} />
                <span><strong>{RETURN_TYPE_LABEL[o.type]}</strong>{o.deadline ? <small> · até {formatDate(o.deadline)}</small> : null}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="field-legend">Itens</legend>
            <ul className="return-items">
              {order.items.map((it) => (
                <li key={it.id}>
                  <span>{it.productName} · {it.colorName}, {it.size}</span>
                  <select aria-label={`Quantidade de ${it.productName}`} value={qty[it.id!] ?? 0} onChange={(e) => setQty({ ...qty, [it.id!]: Number(e.target.value) })}>
                    {Array.from({ length: it.quantity + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </fieldset>
          <TextareaField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} required maxLength={2000} />
          {type === 'defect' ? <p className="muted small">Se possível, envie fotos do defeito pelo <Link to={`/atendimento?pedido=${order.number}&assunto=defeito`} className="link-underline">atendimento</Link>.</p> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={sending}>Enviar solicitação</Button></div>
        </form>
      </Dialog>
    </section>
  );
}

export function OrderView({ order, onOrder, showPayment }: { order: OrderDTO; onOrder: (o: OrderDTO) => void; showPayment?: boolean }) {
  const [cancelling, setCancelling] = useState(false);
  const { notify, config } = useStore();
  const cancel = async () => {
    if (!window.confirm('Cancelar este pedido? O estoque reservado será liberado.')) return;
    setCancelling(true);
    try { onOrder(await api.post<OrderDTO>(`/api/orders/${order.number}/cancel`)); notify('Pedido cancelado.', 'info'); } catch (e) { notify(errorMessage(e), 'error'); } finally { setCancelling(false); }
  };
  const approved = order.payments.find((p) => p.status === 'approved' || p.status === 'partially_refunded');
  const shipments = (order.shipments ?? []).filter((s) => s.status !== 'cancelled');
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
      {order.guest ? <Notice tone="info" title="Compra sem cadastro">Guarde o e-mail de confirmação: o link dele dá acesso a este pedido em outro dispositivo. Quer acompanhar tudo em um só lugar? <Link to="/cadastro" className="link-underline">Crie sua conta com o mesmo e-mail</Link>.</Notice> : null}
      {order.status === 'paid' && approved ? <Notice tone="success" title="Obrigado pela compra!">Seu pagamento foi confirmado pelo provedor. Você receberá as atualizações de envio por e-mail.</Notice> : null}
      {order.events.some((e) => e.type === 'payment_after_cancel') ? <Notice tone="warning">Recebemos um pagamento após o cancelamento deste pedido. Nossa equipe vai entrar em contato para o estorno ou reativação.</Notice> : null}
      <Progress status={order.status} />

      <div className="two-col">
        <div>
          {showPayment && order.status === 'pending_payment' ? <PaymentPanel order={order} onOrder={onOrder} /> : null}
          <section className="order-block" aria-labelledby="items-t">
            <h2 id="items-t">Itens</h2>
            <ul className="review-list">
              {order.items.map((it) => (
                <li key={it.id ?? it.sku}>
                  {it.imageUrl ? <img src={it.imageUrl} alt="" /> : <span />}
                  <span>
                    <Link to={`/produto/${it.productSlug}`}><strong>{it.productName}</strong></Link>
                    <small>{it.colorName} · Tam. {it.size} · {it.quantity} × {formatPrice(it.unitPriceCents)} · SKU {it.sku}</small>
                    {order.canReview && !order.guest && config.settings.reviews?.enabled !== false ? <Link to={`/produto/${it.productSlug}#avaliacoes`} className="link-btn"><Icon name="star" size={14} /> Avaliar produto</Link> : null}
                  </span>
                  <span>{formatPrice(it.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="order-block" aria-labelledby="ship-t">
            <h2 id="ship-t">Entrega</h2>
            <p><strong>{order.address.recipient}</strong><br />{order.address.street}, {order.address.number}{order.address.complement ? ` — ${order.address.complement}` : ''}<br />{order.address.district} · {order.address.city}/{order.address.state} · {formatCep(order.address.cep)}</p>
            <p>{order.shippingLabel}{order.shippingDaysText ? ` · ${order.shippingDaysText}` : ''}{order.shippingIsDemo ? ' (simulação)' : ''}</p>
            {shipments.length ? shipments.map((s) => (
              <div key={s.id} className="shipment">
                <p className="tracking"><Icon name="truck" size={18} /> <strong>{SHIPMENT_STATUS_LABEL[s.status] ?? s.status}</strong>{s.carrier ? ` · ${s.carrier}` : ''}{s.trackingCode ? <> · Rastreamento: <strong>{s.trackingCode}</strong></> : null}{s.trackingUrl ? <> · <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="link-underline">Acompanhar entrega</a></> : null}</p>
                {s.events.length ? <ol className="timeline">{[...s.events].reverse().map((e, i) => <li key={i}><time>{formatDateTime(e.occurredAt)}</time><span>{e.description}{e.location ? ` — ${e.location}` : ''}</span></li>)}</ol> : null}
              </div>
            )) : order.trackingCode ? (
              <p className="tracking"><Icon name="truck" size={18} /> Rastreamento: <strong>{order.trackingCode}</strong>{order.trackingUrl ? <> · <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="link-underline">Acompanhar entrega</a></> : null}</p>
            ) : order.status === 'paid' || order.status === 'processing' ? <p className="muted small">O código de rastreamento aparecerá aqui quando o pedido for enviado.</p> : null}
          </section>
          {order.payments.length ? (
            <section className="order-block" aria-labelledby="pay-t">
              <h2 id="pay-t">Pagamentos</h2>
              <ul className="pay-history">
                {order.payments.map((p) => (
                  <li key={p.id}>
                    <span>{PAYMENT_METHOD_LABEL[p.method]}{p.cardLastFour ? ` final ${p.cardLastFour}` : ''}{p.installments && p.installments > 1 ? ` · ${p.installments}x` : ''}</span>
                    <span className={`pstatus pstatus--${p.status}`}>{PAYMENT_STATUS_LABEL[p.status]}</span>
                    <span>{formatPrice(p.amountCents)}{p.refundedCents ? <small> · estornado {formatPrice(p.refundedCents)}</small> : null}</span>
                    <small>{formatDateTime(p.createdAt)}</small>
                  </li>
                ))}
              </ul>
              {order.refunds?.length ? (
                <ul className="pay-history">
                  {order.refunds.map((r) => <li key={r.id}><span>Estorno</span><span className={`pstatus pstatus--${r.status === 'approved' ? 'refunded' : r.status === 'requested' ? 'pending' : 'rejected'}`}>{r.status === 'approved' ? 'Confirmado' : r.status === 'requested' ? 'Solicitado ao provedor' : 'Não concluído'}</span><span>{formatPrice(r.amountCents)}</span><small>{formatDateTime(r.confirmedAt ?? r.createdAt)}</small></li>)}
                </ul>
              ) : null}
            </section>
          ) : null}
          <ReturnsBlock order={order} />
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
            <Link to={`/atendimento?pedido=${order.number}&assunto=pedido`} className="link-underline">Preciso de ajuda com este pedido</Link>
            {!order.guest ? <Link to="/conta/pedidos" className="link-underline">Ver todos os pedidos</Link> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
