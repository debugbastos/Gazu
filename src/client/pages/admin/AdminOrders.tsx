import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Link, useSearchParams } from '../../lib/router';
import { useStore } from '../../lib/store';
import { formatCep, formatDateTime, formatPrice, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from '../../../shared/format';
import type { OrderDTO } from '../../../shared/types';
import { Icon } from '../../components/ui/Icon';
import { Button, EmptyState, ErrorState, Field, Loading, Notice, Pagination, SelectField } from '../../components/ui/ui';
import { AdminShell } from './Admin';

interface OrderRow { number: string; status: string; totalCents: number; isDemo: number; createdAt: string; email: string; recipient: string; paymentStatus: string | null; items: number }

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
          {[['', 'Todos'], ['pending_payment', 'Aguardando'], ['paid', 'Pagos'], ['processing', 'Em separação'], ['shipped', 'Enviados'], ['delivered', 'Entregues'], ['cancelled', 'Cancelados']].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={(sp.get('status') ?? '') === v} className={(sp.get('status') ?? '') === v ? 'is-active' : ''} onClick={() => set('status', v!)}>{l}</button>
          ))}
        </div>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data && data.items.length === 0 ? <EmptyState title="Nenhum pedido encontrado" /> : data ? (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Pedido</th><th>Pagamento</th><th>Data</th></tr></thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.number}>
                    <td><Link to={`/admin/pedidos/${o.number}`} className="admin-link">{o.number}</Link>{o.isDemo ? <span className="demo-tag">Demo</span> : null}</td>
                    <td>{o.recipient}<br /><small className="muted">{o.email}</small></td>
                    <td>{o.items}</td>
                    <td>{formatPrice(o.totalCents)}</td>
                    <td><span className={`status status--${o.status}`}>{ORDER_STATUS_LABEL[o.status]}</span></td>
                    <td>{o.paymentStatus ? <span className={`pstatus pstatus--${o.paymentStatus}`}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</span> : <span className="muted">—</span>}</td>
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
  // Pedidos pagos não são cancelados pelo painel: o estorno é feito no provedor e chega por webhook.
  pending_payment: [{ value: 'cancelled', label: 'Cancelar pedido' }],
  paid: [{ value: 'processing', label: 'Em separação' }],
  processing: [{ value: 'shipped', label: 'Enviado (exige rastreamento)' }],
  shipped: [{ value: 'delivered', label: 'Entregue' }],
};

export function AdminOrderDetail({ number }: { number: string }) {
  const { notify } = useStore();
  const { data: o, error, loading, reload, setData } = useApi<OrderDTO>(`/api/admin/orders/${encodeURIComponent(number)}`);
  const [status, setStatus] = useState('');
  const [tracking, setTracking] = useState({ code: '', url: '' });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (o) { setTracking({ code: o.trackingCode ?? '', url: o.trackingUrl ?? '' }); setStatus(''); } }, [o]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!o) return;
    if (status === 'cancelled' && !window.confirm('Cancelar este pedido? O estoque reservado será devolvido. Pagamentos aprovados precisam ser estornados no provedor.')) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { trackingCode: tracking.code || null, trackingUrl: tracking.url || '' };
      if (status) body.status = status;
      if (note) body.note = note;
      setData(await api.patch<OrderDTO>(`/api/admin/orders/${encodeURIComponent(o.number)}`, body));
      setNote('');
      notify('Pedido atualizado.', 'success');
    } catch (err) { notify(errorMessage(err), 'error'); } finally { setSaving(false); }
  };

  return (
    <AdminShell title={`Pedido ${number}`}>
      <p><Link to="/admin/pedidos" className="link-btn"><Icon name="arrowLeft" size={14} /> Pedidos</Link></p>
      {loading && !o ? <Loading /> : error && !o ? <ErrorState message={error} onRetry={reload} /> : o ? (
        <div className="admin-grid admin-grid--order">
          <div className="admin-stack">
            <section className="admin-card">
              <div className="admin-card__head"><h2>Situação</h2><span className={`status status--${o.status}`}>{ORDER_STATUS_LABEL[o.status]}</span></div>
              {o.isDemo ? <Notice tone="info">Pedido de demonstração.</Notice> : null}
              <form className="admin-fields" onSubmit={save}>
                {NEXT[o.status]?.length ? (
                  <SelectField label="Alterar status" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">Manter</option>
                    {NEXT[o.status]!.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                  </SelectField>
                ) : <p className="muted small span-2">Nenhuma transição manual disponível neste status. A confirmação de pagamento vem exclusivamente do provedor.</p>}
                <Field label="Código de rastreamento" value={tracking.code} onChange={(e) => setTracking({ ...tracking, code: e.target.value })} optional />
                <Field label="Link de rastreamento" type="url" value={tracking.url} onChange={(e) => setTracking({ ...tracking, url: e.target.value })} optional className="span-2" />
                <Field label="Observação para o histórico" value={note} onChange={(e) => setNote(e.target.value)} optional className="span-2" />
                <div className="span-2"><Button loading={saving}>Salvar</Button></div>
              </form>
            </section>
            <section className="admin-card">
              <h2>Itens</h2>
              <ul className="review-list">
                {o.items.map((it) => (
                  <li key={it.sku}>{it.imageUrl ? <img src={it.imageUrl} alt="" /> : <span />}<span><strong>{it.productName}</strong><small>{it.colorName} · {it.size} · {it.quantity} × {formatPrice(it.unitPriceCents)} · {it.sku}</small></span><span>{formatPrice(it.lineTotalCents)}</span></li>
                ))}
              </ul>
              <div className="summary-row"><span>Subtotal</span><span>{formatPrice(o.subtotalCents)}</span></div>
              {o.discountCents ? <div className="summary-row summary-row--discount"><span>Desconto {o.couponCode ?? ''}</span><span>− {formatPrice(o.discountCents)}</span></div> : null}
              <div className="summary-row"><span>Entrega ({o.shippingLabel})</span><span>{formatPrice(o.shippingCents)}</span></div>
              <div className="summary-row summary-row--total"><span>Total</span><strong>{formatPrice(o.totalCents)}</strong></div>
            </section>
            <section className="admin-card">
              <h2>Histórico</h2>
              <ol className="timeline">{[...o.events].reverse().map((e, i) => <li key={i}><time>{formatDateTime(e.createdAt)}</time><span>{e.message} <small className="muted">({e.actor})</small></span></li>)}</ol>
            </section>
          </div>
          <div className="admin-stack">
            <section className="admin-card">
              <h2>Cliente</h2>
              <p className="small">{o.customer?.name}<br />{o.customer?.email}</p>
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
                  {o.payments.map((p) => <li key={p.id}><span>{PAYMENT_METHOD_LABEL[p.method]}{p.cardLastFour ? ` •••• ${p.cardLastFour}` : ''}</span><span className={`pstatus pstatus--${p.status}`}>{PAYMENT_STATUS_LABEL[p.status]}</span><span>{formatPrice(p.amountCents)}</span><small>{formatDateTime(p.createdAt)}{p.statusDetail ? ` · ${p.statusDetail}` : ''}</small></li>)}
                </ul>
              )}
              <p className="muted small">Status de pagamento é atualizado apenas pelo provedor (webhook verificado ou consulta à API).</p>
            </section>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
