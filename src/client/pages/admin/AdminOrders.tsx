import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Link, useSearchParams } from '../../lib/router';
import { useStore } from '../../lib/store';
import { formatCep, formatDateTime, formatPrice, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, RETURN_STATUS_LABEL, SHIPMENT_STATUS_LABEL } from '../../../shared/format';
import type { OrderDTO, ShipmentStatus } from '../../../shared/types';
import { Icon } from '../../components/ui/Icon';
import { Button, Dialog, EmptyState, ErrorState, Field, Loading, Notice, Pagination, SelectField, TextareaField } from '../../components/ui/ui';
import { AdminShell, fromCents, toCents } from './Admin';
import { useCan } from './AdminKit';

interface OrderRow { number: string; status: string; totalCents: number; isDemo: number; createdAt: string; email: string; recipient: string; paymentStatus: string | null; shipmentStatus: string | null; isGuest: number; items: number }

export function AdminOrders() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const { data, error, loading, reload } = useApi<{ items: OrderRow[]; total: number; page: number; pages: number }>(`/api/admin/orders?${sp.toString()}`);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'pagina') n.delete('pagina'); setSp(n); };
  return (
    <AdminShell title="Pedidos">
      <div className="admin-toolbar">
        <form role="search" className="admin-search" onSubmit={(e) => { e.preventDefault(); set('q', q.trim()); }}>
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número, e-mail ou destinatário" aria-label="Buscar pedidos" />
        </form>
        <div className="admin-tabs" role="tablist" aria-label="Status">
          {[['', 'Todos'], ['pending_payment', 'Aguardando'], ['paid', 'Pagos'], ['processing', 'Em separação'], ['shipped', 'Enviados'], ['delivered', 'Entregues'], ['cancelled', 'Cancelados'], ['refunded', 'Reembolsados']].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={(sp.get('status') ?? '') === v} className={(sp.get('status') ?? '') === v ? 'is-active' : ''} onClick={() => set('status', v!)}>{l}</button>
          ))}
        </div>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data && data.items.length === 0 ? <EmptyState title="Nenhum pedido encontrado" /> : data ? (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Pedido</th><th>Pagamento</th><th>Envio</th><th>Data</th></tr></thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.number}>
                    <td><Link to={`/admin/pedidos/${o.number}`} className="admin-link">{o.number}</Link>{o.isDemo ? <span className="demo-tag">Demo</span> : null}</td>
                    <td>{o.recipient}{o.isGuest ? <span className="tag">Visitante</span> : null}<br /><small className="muted">{o.email}</small></td>
                    <td>{o.items}</td>
                    <td>{formatPrice(o.totalCents)}</td>
                    <td><span className={`status status--${o.status}`}>{ORDER_STATUS_LABEL[o.status]}</span></td>
                    <td>{o.paymentStatus ? <span className={`pstatus pstatus--${o.paymentStatus}`}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</span> : <span className="muted">—</span>}</td>
                    <td>{o.shipmentStatus ? SHIPMENT_STATUS_LABEL[o.shipmentStatus] : <span className="muted">—</span>}</td>
                    <td>{formatDateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pages={data.pages} onPage={(pg) => set('pagina', String(pg))} />
        </>
      ) : null}
    </AdminShell>
  );
}

// Transições operacionais permitidas ao administrador. "Pago" só é definido pelo provedor de pagamento.
const NEXT: Record<string, { value: string; label: string }[]> = {
  // Espelha ADMIN_TRANSITIONS/cancelOrder do servidor (que é quem valida de fato).
  pending_payment: [{ value: 'cancelled', label: 'Cancelar pedido' }],
  paid: [{ value: 'processing', label: 'Em separação' }],
  processing: [{ value: 'shipped', label: 'Enviado (exige rastreamento)' }],
  shipped: [{ value: 'delivered', label: 'Entregue' }],
};
const SHIP_STATUSES: ShipmentStatus[] = ['pending', 'preparing', 'label_purchased', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returned', 'cancelled'];

export function AdminOrderDetail({ number }: { number: string }) {
  const { notify } = useStore();
  const can = useCan();
  const { data: o, error, loading, reload, setData } = useApi<OrderDTO>(`/api/admin/orders/${encodeURIComponent(number)}`);
  const [status, setStatus] = useState('');
  const [tracking, setTracking] = useState({ code: '', url: '', carrier: '' });
  const [note, setNote] = useState('');
  const [internal, setInternal] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [shipEdit, setShipEdit] = useState<{ id: number | null; status: string; carrier: string; service: string; trackingCode: string; trackingUrl: string; cost: string; description: string; location: string } | null>(null);
  const [refund, setRefund] = useState<{ amount: string; reason: string } | null>(null);
  useEffect(() => { if (o) { setTracking({ code: o.trackingCode ?? '', url: o.trackingUrl ?? '', carrier: '' }); setStatus(''); } }, [o]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!o) return;
    if (status === 'cancelled' && !window.confirm('Cancelar este pedido? O estoque reservado será devolvido e cobranças pendentes são canceladas no provedor.')) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { trackingCode: tracking.code || null, trackingUrl: tracking.url || '' };
      if (tracking.carrier) body.carrier = tracking.carrier;
      if (status) body.status = status;
      if (note) body.note = note;
      setData(await api.patch<OrderDTO>(`/api/admin/orders/${encodeURIComponent(o.number)}`, body));
      setNote('');
      notify('Pedido atualizado.', 'success');
    } catch (err) { notify(errorMessage(err), 'error'); } finally { setSaving(false); }
  };
  const run = async (key: string, fn: () => Promise<OrderDTO | { order?: OrderDTO } | unknown>, ok: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'number' in (r as object)) setData(r as OrderDTO);
      else if (r && typeof r === 'object' && 'order' in (r as object) && (r as { order?: OrderDTO }).order) setData((r as { order: OrderDTO }).order);
      else reload();
      notify(ok, 'success');
    } catch (err) { notify(errorMessage(err), 'error'); } finally { setBusy(null); }
  };
  const addNote = (e: FormEvent) => { e.preventDefault(); if (!o || !internal.trim()) return; void run('note', () => api.post<OrderDTO>(`/api/admin/orders/${o.number}/notes`, { body: internal }), 'Observação interna registrada.').then(() => setInternal('')); };
  const saveShipment = (e: FormEvent) => {
    e.preventDefault();
    if (!o || !shipEdit) return;
    const body = { status: shipEdit.status || undefined, carrier: shipEdit.carrier || null, service: shipEdit.service || null, trackingCode: shipEdit.trackingCode || null, trackingUrl: shipEdit.trackingUrl || '', costCents: shipEdit.cost.trim() ? toCents(shipEdit.cost) : null, description: shipEdit.description || null, location: shipEdit.location || null };
    void run('ship', () => (shipEdit.id ? api.patch<OrderDTO>(`/api/admin/shipments/${shipEdit.id}`, body) : api.post<OrderDTO>(`/api/admin/orders/${o.number}/shipments`, body)), 'Envio salvo.').then(() => setShipEdit(null));
  };
  const doRefund = (e: FormEvent) => {
    e.preventDefault();
    if (!o || !refund) return;
    if (!window.confirm('Solicitar o estorno ao provedor de pagamento? Esta ação não pode ser desfeita.')) return;
    void run('refund', () => api.post<OrderDTO>(`/api/admin/orders/${o.number}/refunds`, { amountCents: refund.amount.trim() ? toCents(refund.amount) : null, reason: refund.reason }), 'Estorno solicitado. O status final vem da confirmação do provedor.').then(() => setRefund(null));
  };

  const refundable = o ? o.payments.filter((p) => p.status === 'approved' || p.status === 'partially_refunded').reduce((s, p) => s + p.amountCents - (p.refundedCents ?? 0), 0) : 0;

  return (
    <AdminShell title={`Pedido ${number}`} actions={o ? <a className="btn btn--secondary btn--sm" href={`/api/admin/orders/${encodeURIComponent(number)}/packing-slip`} target="_blank" rel="noopener noreferrer"><span className="btn__label">Romaneio (imprimir)</span><Icon name="external" size={14} /></a> : null}>
      <p><Link to="/admin/pedidos" className="link-btn"><Icon name="arrowLeft" size={14} /> Pedidos</Link></p>
      {loading && !o ? <Loading /> : error && !o ? <ErrorState message={error} onRetry={reload} /> : o ? (
        <div className="admin-grid admin-grid--order">
          <div className="admin-stack">
            <section className="admin-card">
              <div className="admin-card__head"><h2>Situação</h2><span className={`status status--${o.status}`}>{ORDER_STATUS_LABEL[o.status]}</span></div>
              {o.isDemo ? <Notice tone="info">Pedido de demonstração — não entra no financeiro e não gera etiqueta real.</Notice> : null}
              {o.events.some((e) => e.type === 'payment_after_cancel') ? <Notice tone="error" title="Pagamento aprovado após cancelamento">Avalie o estorno pelo provedor ou a reativação manual com o cliente.</Notice> : null}
              {can('orders.write') ? (
                <form className="admin-fields" onSubmit={save}>
                  {NEXT[o.status]?.length ? (
                    <SelectField label="Alterar status" value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="">Manter</option>
                      {NEXT[o.status]!.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                    </SelectField>
                  ) : <p className="muted small span-2">Nenhuma transição manual disponível neste status. Pagamento e estorno são confirmados exclusivamente pelo provedor.</p>}
                  <Field label="Transportadora" value={tracking.carrier} onChange={(e) => setTracking({ ...tracking, carrier: e.target.value })} optional />
                  <Field label="Código de rastreamento" value={tracking.code} onChange={(e) => setTracking({ ...tracking, code: e.target.value })} optional />
                  <Field label="Link de rastreamento" type="url" value={tracking.url} onChange={(e) => setTracking({ ...tracking, url: e.target.value })} optional className="span-2" />
                  <Field label="Mensagem no histórico do pedido (visível ao cliente)" value={note} onChange={(e) => setNote(e.target.value)} optional className="span-2" />
                  <div className="span-2"><Button loading={saving}>Salvar</Button></div>
                </form>
              ) : <p className="muted small">Sua função permite apenas visualizar pedidos.</p>}
            </section>

            <section className="admin-card">
              <div className="admin-card__head">
                <h2>Envios</h2>
                {can('orders.write') && !['pending_payment', 'cancelled'].includes(o.status) ? (
                  <div className="admin-row">
                    {o.shippingLabel && (o.shipments ?? []).every((s) => s.provider !== 'melhorenvio' || s.status === 'cancelled') && ['paid', 'processing'].includes(o.status) ? <Button size="sm" variant="secondary" loading={busy === 'label'} onClick={() => void run('label', () => api.post<OrderDTO>(`/api/admin/orders/${o.number}/label`), 'Etiqueta comprada no Melhor Envio.')}>Comprar etiqueta (Melhor Envio)</Button> : null}
                    <Button size="sm" variant="ghost" icon="plus" onClick={() => setShipEdit({ id: null, status: '', carrier: '', service: '', trackingCode: '', trackingUrl: '', cost: '', description: '', location: '' })}>Registrar envio</Button>
                  </div>
                ) : null}
              </div>
              {!(o.shipments ?? []).length ? <p className="muted small">Nenhum envio registrado.</p> : (o.shipments ?? []).map((s) => (
                <div key={s.id} className="shipment-admin">
                  <p><strong>{SHIPMENT_STATUS_LABEL[s.status]}</strong> · {s.provider === 'melhorenvio' ? 'Melhor Envio' : 'Manual'}{s.carrier ? ` · ${s.carrier}` : ''}{s.service ? ` (${s.service})` : ''}{s.trackingCode ? <> · <code>{s.trackingCode}</code></> : null}{s.costCents != null ? ` · custo ${formatPrice(s.costCents)}` : <span className="is-warn"> · custo não informado</span>}</p>
                  <div className="admin-row">
                    {s.labelUrl ? <a className="link-btn" href={s.labelUrl} target="_blank" rel="noopener noreferrer">Etiqueta</a> : null}
                    {s.trackingUrl ? <a className="link-btn" href={s.trackingUrl} target="_blank" rel="noopener noreferrer">Rastreio</a> : null}
                    {can('orders.write') ? <button className="link-btn" onClick={() => setShipEdit({ id: s.id, status: '', carrier: s.carrier ?? '', service: s.service ?? '', trackingCode: s.trackingCode ?? '', trackingUrl: s.trackingUrl ?? '', cost: fromCents(s.costCents ?? null), description: '', location: '' })}>Atualizar</button> : null}
                  </div>
                  <ol className="timeline">{[...s.events].reverse().map((e, i) => <li key={i}><time>{formatDateTime(e.occurredAt)}</time><span>{e.description}{e.location ? ` — ${e.location}` : ''} <small className="muted">({e.source})</small></span></li>)}</ol>
                </div>
              ))}
            </section>

            <section className="admin-card">
              <h2>Itens</h2>
              <ul className="review-list">
                {o.items.map((it) => (
                  <li key={it.id ?? it.sku}>{it.imageUrl ? <img src={it.imageUrl} alt="" /> : <span />}<span><strong>{it.productName}</strong><small>{it.colorName} · {it.size} · {it.quantity} × {formatPrice(it.unitPriceCents)} · {it.sku}{can('finance.read') ? ` · custo ${it.unitCostCents != null ? formatPrice(it.unitCostCents) : 'não informado'}` : ''}</small></span><span>{formatPrice(it.lineTotalCents)}</span></li>
                ))}
              </ul>
              <div className="summary-row"><span>Subtotal</span><span>{formatPrice(o.subtotalCents)}</span></div>
              {o.discountCents ? <div className="summary-row summary-row--discount"><span>Desconto {o.couponCode ?? ''}</span><span>− {formatPrice(o.discountCents)}</span></div> : null}
              <div className="summary-row"><span>Entrega ({o.shippingLabel})</span><span>{formatPrice(o.shippingCents)}</span></div>
              <div className="summary-row summary-row--total"><span>Total</span><strong>{formatPrice(o.totalCents)}</strong></div>
            </section>

            <section className="admin-card">
              <h2>Observações internas</h2>
              <p className="muted small">Visíveis somente para a equipe. Nunca aparecem para o cliente nem nos e-mails.</p>
              {(o.notes ?? []).length ? <ul className="notes">{o.notes!.map((n) => <li key={n.id}><p>{n.body}</p><small className="muted">{n.author} · {formatDateTime(n.createdAt)}</small></li>)}</ul> : null}
              {can('orders.write') ? <form className="admin-form" onSubmit={addNote}><TextareaField label="Nova observação" value={internal} onChange={(e) => setInternal(e.target.value)} rows={3} maxLength={2000} /><Button size="sm" variant="secondary" loading={busy === 'note'} disabled={!internal.trim()}>Adicionar observação</Button></form> : null}
            </section>

            <section className="admin-card">
              <h2>Histórico</h2>
              <ol className="timeline">{[...o.events].reverse().map((e, i) => <li key={i}><time>{formatDateTime(e.createdAt)}</time><span>{e.message} <small className="muted">({e.actor})</small></span></li>)}</ol>
            </section>
          </div>
          <div className="admin-stack">
            <section className="admin-card">
              <h2>Cliente</h2>
              <p className="small">{o.customer?.name}{o.customer?.isGuest ? <span className="tag">Visitante</span> : null}<br />{o.customer?.email}</p>
              <Link to={`/admin/atendimento?q=${encodeURIComponent(o.customer?.email ?? '')}`} className="link-btn">Atendimentos deste cliente</Link>
            </section>
            <section className="admin-card">
              <h2>Entrega</h2>
              <p className="small">{o.address.recipient}<br />{o.address.street}, {o.address.number}{o.address.complement ? ` — ${o.address.complement}` : ''}<br />{o.address.district} · {o.address.city}/{o.address.state}<br />{formatCep(o.address.cep)}</p>
              <p className="small">{o.shippingLabel}{o.shippingDaysText ? ` · ${o.shippingDaysText}` : ''}{o.shippingIsDemo ? ' (simulação)' : ''}</p>
            </section>
            <section className="admin-card">
              <h2>Pagamentos</h2>
              {o.payments.length === 0 ? <p className="muted small">Nenhuma tentativa de pagamento.</p> : (
                <ul className="pay-history">
                  {o.payments.map((p) => (
                    <li key={p.id}>
                      <span>{PAYMENT_METHOD_LABEL[p.method]}{p.cardLastFour ? ` •••• ${p.cardLastFour}` : ''}{p.installments && p.installments > 1 ? ` · ${p.installments}x` : ''}</span>
                      <span className={`pstatus pstatus--${p.status}`}>{PAYMENT_STATUS_LABEL[p.status]}</span>
                      <span>{formatPrice(p.amountCents)}{p.refundedCents ? <small> · estornado {formatPrice(p.refundedCents)}</small> : null}{p.feeCents != null ? <small> · taxa {formatPrice(p.feeCents)}</small> : null}</span>
                      <small>{formatDateTime(p.createdAt)}{p.statusDetail ? ` · ${p.statusDetail}` : ''}{p.provider === 'mercadopago' ? <> · <button className="link-btn" onClick={() => void run(`sync${p.id}`, () => api.post(`/api/admin/payments/${p.id}/sync`), 'Pagamento sincronizado com o provedor.')}>Sincronizar</button></> : null}</small>
                    </li>
                  ))}
                </ul>
              )}
              {(o.refunds ?? []).length ? <ul className="pay-history">{o.refunds!.map((r) => <li key={r.id}><span>Estorno</span><span className={`pstatus pstatus--${r.status === 'approved' ? 'refunded' : r.status === 'requested' ? 'pending' : 'rejected'}`}>{r.status === 'approved' ? 'Confirmado' : r.status === 'requested' ? 'Solicitado' : 'Falhou'}</span><span>{formatPrice(r.amountCents)}</span><small>{r.reason}</small></li>)}</ul> : null}
              {can('payments.refund') && refundable > 0 ? <Button size="sm" variant="secondary" onClick={() => setRefund({ amount: '', reason: '' })}>Estornar pelo provedor</Button> : null}
              <p className="muted small">Pagamento e estorno são confirmados apenas pelo provedor (webhook verificado ou consulta à API). Não há como marcar um pedido como pago manualmente.</p>
            </section>
            {(o.returns ?? []).length ? (
              <section className="admin-card">
                <h2>Trocas e devoluções</h2>
                <ul className="pay-history">{o.returns!.map((r) => <li key={r.id}><Link to={`/admin/trocas?id=${r.id}`} className="admin-link">{r.number}</Link><span className="tag">{RETURN_STATUS_LABEL[r.status] ?? r.status}</span><small>{formatDateTime(r.createdAt)}</small></li>)}</ul>
              </section>
            ) : null}
            {o.attribution ? (
              <section className="admin-card">
                <h2>Origem</h2>
                <p className="small">{o.attribution.campaign ? <>Campanha: <strong>{o.attribution.campaign}</strong><br /></> : null}utm_source: {o.attribution.utmSource ?? '—'} · utm_medium: {o.attribution.utmMedium ?? '—'} · utm_campaign: {o.attribution.utmCampaign ?? '—'}</p>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog open={Boolean(shipEdit)} onClose={() => setShipEdit(null)} title={shipEdit?.id ? 'Atualizar envio' : 'Registrar envio'}>
        {shipEdit ? (
          <form className="dialog__body" onSubmit={saveShipment}>
            <div className="admin-fields">
              <SelectField label="Novo status" value={shipEdit.status} onChange={(e) => setShipEdit({ ...shipEdit, status: e.target.value })}>
                <option value="">{shipEdit.id ? 'Manter' : 'Aguardando preparação'}</option>
                {SHIP_STATUSES.map((s) => <option key={s} value={s}>{SHIPMENT_STATUS_LABEL[s]}</option>)}
              </SelectField>
              <Field label="Transportadora" value={shipEdit.carrier} onChange={(e) => setShipEdit({ ...shipEdit, carrier: e.target.value })} optional />
              <Field label="Serviço" value={shipEdit.service} onChange={(e) => setShipEdit({ ...shipEdit, service: e.target.value })} optional />
              <Field label="Código de rastreamento" value={shipEdit.trackingCode} onChange={(e) => setShipEdit({ ...shipEdit, trackingCode: e.target.value })} optional />
              <Field label="Link de rastreamento" type="url" value={shipEdit.trackingUrl} onChange={(e) => setShipEdit({ ...shipEdit, trackingUrl: e.target.value })} optional className="span-2" />
              <Field label="Custo do frete pago pela loja (R$)" value={shipEdit.cost} onChange={(e) => setShipEdit({ ...shipEdit, cost: e.target.value })} optional inputMode="decimal" hint="Usado no financeiro (margem por pedido)." />
              <Field label="Local do evento" value={shipEdit.location} onChange={(e) => setShipEdit({ ...shipEdit, location: e.target.value })} optional />
              <Field label="Descrição do evento" value={shipEdit.description} onChange={(e) => setShipEdit({ ...shipEdit, description: e.target.value })} optional className="span-2" />
            </div>
            <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setShipEdit(null)}>Cancelar</Button><Button loading={busy === 'ship'}>Salvar envio</Button></div>
          </form>
        ) : null}
      </Dialog>

      <Dialog open={Boolean(refund)} onClose={() => setRefund(null)} title="Estornar pelo provedor">
        {refund ? (
          <form className="dialog__body form-stack" onSubmit={doRefund}>
            <p className="small">Disponível para estorno: <strong>{formatPrice(refundable)}</strong>. Deixe o valor vazio para estornar o total disponível.</p>
            <Field label="Valor (R$)" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} optional inputMode="decimal" />
            <TextareaField label="Motivo" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} required rows={3} maxLength={300} />
            <Notice tone="warning">O pedido só passa a "reembolsado" quando o provedor confirmar. Em pedidos ainda não enviados, o estoque é devolvido automaticamente.</Notice>
            <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setRefund(null)}>Cancelar</Button><Button variant="danger" loading={busy === 'refund'} disabled={refund.reason.trim().length < 3}>Solicitar estorno</Button></div>
          </form>
        ) : null}
      </Dialog>
    </AdminShell>
  );
}
