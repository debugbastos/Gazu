import { useCallback, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Link, useSearchParams } from '../../lib/router';
import { useStore } from '../../lib/store';
import {
  formatDate, formatDateTime, formatPrice, PAYMENT_METHOD_LABEL, RETURN_STATUS_LABEL, RETURN_TYPE_LABEL, SHIPMENT_STATUS_LABEL, TICKET_CATEGORY_LABEL, TICKET_STATUS_LABEL,
} from '../../../shared/format';
import type { AnalyticsReportDTO, FinanceSummaryDTO, ReturnDTO, TicketDTO } from '../../../shared/types';
import { Icon } from '../../components/ui/Icon';
import { Button, Checkbox, Dialog, EmptyState, ErrorState, Field, Loading, Notice, SelectField, TextareaField } from '../../components/ui/ui';
import { AdminShell, toCents } from './Admin';
import { dt, PeriodFilter, ResourcePage, useCan, type ResourceConfig } from './AdminKit';

const money = (c: number | null | undefined) => (c == null ? '—' : formatPrice(c));

// =============================================================================================
// Trocas e devoluções
// =============================================================================================
const RETURN_NEXT: Record<string, { value: string; label: string }[]> = {
  requested: [{ value: 'approved', label: 'Aprovar' }, { value: 'rejected', label: 'Recusar' }],
  approved: [{ value: 'awaiting_item', label: 'Aguardando envio do produto' }, { value: 'received', label: 'Produto recebido' }, { value: 'closed', label: 'Encerrar' }],
  awaiting_item: [{ value: 'received', label: 'Produto recebido' }, { value: 'closed', label: 'Encerrar' }],
  received: [{ value: 'exchanged', label: 'Troca concluída' }, { value: 'closed', label: 'Encerrar' }],
  refunded: [{ value: 'closed', label: 'Encerrar' }],
  exchanged: [{ value: 'closed', label: 'Encerrar' }],
};

export function AdminReturns() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const { data, error, loading, reload } = useApi<{ returns: ReturnDTO[] }>(`/api/admin/returns${status ? `?status=${status}` : ''}`);
  const openId = Number(sp.get('id')) || null;
  return (
    <AdminShell title="Trocas e devoluções">
      <p className="muted small admin-intro">Desistência (7 dias) e defeito (90 dias) seguem o CDC a partir da entrega. Estornos são solicitados ao provedor e a solicitação só fica "reembolsada" após a confirmação dele.</p>
      <div className="admin-tabs">{[['', 'Todas'], ['requested', 'Novas'], ['approved', 'Aprovadas'], ['awaiting_item', 'Aguardando produto'], ['received', 'Recebidas'], ['refunded', 'Reembolsadas'], ['closed', 'Encerradas']].map(([k, l]) => <button key={k} className={status === k ? 'is-active' : ''} onClick={() => { const n = new URLSearchParams(sp); if (k) n.set('status', k!); else n.delete('status'); n.delete('id'); setSp(n); }}>{l}</button>)}</div>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.returns.length ? <EmptyState title="Nenhuma solicitação" /> : (
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Solicitação</th><th>Pedido</th><th>Tipo</th><th>Cliente</th><th>Itens</th><th>Status</th><th>Aberta em</th></tr></thead>
          <tbody>{data.returns.map((r) => (
            <tr key={r.id}><td><button className="admin-link" onClick={() => { const n = new URLSearchParams(sp); n.set('id', String(r.id)); setSp(n); }}>{r.number}</button></td><td><Link to={`/admin/pedidos/${r.orderNumber}`} className="admin-link">{r.orderNumber}</Link></td><td>{RETURN_TYPE_LABEL[r.type]}</td><td>{r.customerName ?? '—'}<br /><small className="muted">{r.customerEmail}</small></td><td>{r.items.reduce((s, i) => s + i.quantity, 0)}</td><td><span className="tag">{RETURN_STATUS_LABEL[r.status]}</span></td><td>{formatDate(r.createdAt)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {openId ? <ReturnDialog id={openId} onClose={() => { const n = new URLSearchParams(sp); n.delete('id'); setSp(n); reload(); }} /> : null}
    </AdminShell>
  );
}

function ReturnDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { notify } = useStore();
  const can = useCan();
  const { data: r, setData, error } = useApi<ReturnDTO>(`/api/admin/returns/${id}`);
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [restock, setRestock] = useState(true);
  const [refund, setRefund] = useState({ amount: '', reason: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    try { setData(await api.patch<ReturnDTO>(`/api/admin/returns/${id}`, { status: status || undefined, message: message || undefined, internal, restock })); setStatus(''); setMessage(''); notify('Solicitação atualizada.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } finally { setBusy(null); }
  };
  const doRefund = async () => {
    const cents = toCents(refund.amount);
    if (!cents || refund.reason.trim().length < 3) { notify('Informe o valor e o motivo do estorno.', 'error'); return; }
    if (!window.confirm(`Solicitar estorno de ${formatPrice(cents)} ao provedor?`)) return;
    setBusy('refund');
    try { setData(await api.post<ReturnDTO>(`/api/admin/returns/${id}/refund`, { amountCents: cents, reason: refund.reason })); notify('Estorno solicitado ao provedor.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } finally { setBusy(null); }
  };
  return (
    <Dialog open onClose={onClose} title={r ? `${r.number} · ${RETURN_TYPE_LABEL[r.type]}` : 'Solicitação'} className="admin-dialog">
      <div className="dialog__body">
        {error ? <ErrorState message={error} /> : !r ? <Loading /> : (
          <div className="admin-stack">
            <p><span className="tag">{RETURN_STATUS_LABEL[r.status]}</span> · pedido <Link to={`/admin/pedidos/${r.orderNumber}`} className="admin-link">{r.orderNumber}</Link> · {r.customerName} ({r.customerEmail})</p>
            <p className="small"><strong>Motivo:</strong> {r.reason}</p>
            <ul className="pay-history">{r.items.map((i) => <li key={i.orderItemId}><span>{i.quantity}× {i.productName}</span><span>{i.colorName} · {i.size}</span><small>{i.sku}{i.restocked ? ' · devolvido ao estoque' : ''}</small></li>)}</ul>
            <ol className="timeline">{[...r.events].reverse().map((e, i) => <li key={i}><time>{formatDateTime(e.createdAt)}</time><span>{e.message} <small className="muted">({e.actor}{e.internal ? ' · interno' : ''})</small></span></li>)}</ol>
            {can('orders.write') ? (
              <form className="admin-fields" onSubmit={save}>
                {RETURN_NEXT[r.status]?.length ? <SelectField label="Próxima etapa" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Manter</option>{RETURN_NEXT[r.status]!.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}</SelectField> : <p className="muted small span-2">Solicitação finalizada.</p>}
                {status === 'received' ? <div className="span-2"><Checkbox checked={restock} onChange={setRestock} label="Devolver os itens ao estoque (produto em condições de revenda)" /></div> : null}
                <TextareaField label="Mensagem" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="span-2" />
                <div className="span-2"><Checkbox checked={internal} onChange={setInternal} label="Nota interna (não enviada ao cliente)" /></div>
                <div className="span-2"><Button loading={busy === 'save'}>Salvar</Button></div>
              </form>
            ) : null}
            {can('payments.refund') && ['approved', 'received'].includes(r.status) ? (
              <section className="admin-card admin-card--inset">
                <h2>Estorno pelo provedor</h2>
                <div className="admin-fields">
                  <Field label="Valor (R$)" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} inputMode="decimal" />
                  <Field label="Motivo" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
                </div>
                <Button variant="danger" size="sm" loading={busy === 'refund'} onClick={() => void doRefund()}>Solicitar estorno</Button>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// =============================================================================================
// Envios
// =============================================================================================
interface ShipmentRow { id: number; status: string; provider: string; carrier: string | null; service: string | null; trackingCode: string | null; trackingUrl: string | null; labelUrl: string | null; costCents: number | null; shippedAt: string | null; deliveredAt: string | null; updatedAt: string; orderNumber: string; city: string; state: string; isDemo: number }

export function AdminShipments() {
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useApi<{ shipments: ShipmentRow[] }>(`/api/admin/shipments${status ? `?status=${status}` : ''}`);
  const sender = useApi<{ senderMissing: string[] }>('/api/admin/shipping/status');
  const { notify, config } = useStore();
  const can = useCan();
  const [syncing, setSyncing] = useState(false);
  const sync = async () => {
    setSyncing(true);
    try { const r = await api.post<{ checked: number; updated: number }>('/api/admin/shipments/sync'); notify(`${r.checked} envio(s) consultado(s), ${r.updated} atualizado(s).`, 'success'); reload(); } catch (e) { notify(errorMessage(e), 'error'); } finally { setSyncing(false); }
  };
  return (
    <AdminShell title="Envios" actions={can('orders.write') && config.shipping.provider === 'melhorenvio' ? <Button size="sm" variant="secondary" icon="refresh" loading={syncing} onClick={() => void sync()}>Atualizar rastreio</Button> : null}>
      {config.shipping.provider !== 'melhorenvio' ? <Notice tone="info" title="Envio manual">Frete configurado como {config.shipping.provider === 'demo' ? 'demonstração (simulado)' : 'regras manuais'}. Registre transportadora, código e custo do envio no pedido. Para cotação e etiquetas reais, configure o Melhor Envio (docs/INTEGRACOES.md).</Notice> : null}
      {sender.data?.senderMissing.length ? <Notice tone="warning" title="Remetente incompleto">Para comprar etiquetas, preencha em Configurações: {sender.data.senderMissing.join(', ')}.</Notice> : null}
      <div className="admin-tabs">{[['', 'Todos'], ['pending', 'Aguardando'], ['preparing', 'Em preparação'], ['label_purchased', 'Etiqueta gerada'], ['shipped', 'Enviados'], ['in_transit', 'Em trânsito'], ['delivered', 'Entregues'], ['delivery_failed', 'Falha'], ['returned', 'Devolvidos']].map(([k, l]) => <button key={k} className={status === k ? 'is-active' : ''} onClick={() => setStatus(k!)}>{l}</button>)}</div>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.shipments.length ? <EmptyState title="Nenhum envio" /> : (
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Pedido</th><th>Status</th><th>Transportadora</th><th>Rastreio</th><th>Destino</th><th>Custo</th><th>Atualizado</th></tr></thead>
          <tbody>{data.shipments.map((s) => (
            <tr key={s.id}><td><Link to={`/admin/pedidos/${s.orderNumber}`} className="admin-link">{s.orderNumber}</Link>{s.isDemo ? <span className="demo-tag">Demo</span> : null}</td><td>{SHIPMENT_STATUS_LABEL[s.status] ?? s.status}</td><td>{s.carrier ?? '—'}{s.provider === 'melhorenvio' ? <small className="muted"> · Melhor Envio</small> : null}</td><td>{s.trackingCode ? (s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="link-btn">{s.trackingCode}</a> : <code>{s.trackingCode}</code>) : '—'}{s.labelUrl ? <> · <a href={s.labelUrl} target="_blank" rel="noopener noreferrer" className="link-btn">etiqueta</a></> : null}</td><td>{s.city}/{s.state}</td><td className={s.costCents == null ? 'is-warn' : ''}>{s.costCents == null ? 'não informado' : formatPrice(s.costCents)}</td><td>{dt(s.updatedAt)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </AdminShell>
  );
}

// =============================================================================================
// Central de atendimento
// =============================================================================================
interface TicketRow { id: number; number: string; subject: string; category: string; status: string; priority: string; channel: string; name: string; email: string; createdAt: string; updatedAt: string; lastCustomerMessageAt: string | null; orderNumber: string | null; assignee: string | null; messages: number }
const PRIORITY_LABEL: Record<string, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };

export function AdminSupport() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? 'active';
  const q = sp.get('q') ?? '';
  const [query, setQuery] = useState(q);
  const qs = new URLSearchParams({ status: status === 'all' ? '' : status, q, ...(sp.get('meus') ? { meus: '1' } : {}), ...(sp.get('canal') ? { canal: sp.get('canal')! } : {}) });
  const { data, error, loading, reload } = useApi<{ tickets: TicketRow[]; staff: { id: string; name: string }[]; whatsapp: { api: boolean; webhook: boolean } }>(`/api/admin/support/tickets?${qs.toString()}`);
  const openId = Number(sp.get('id')) || null;
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('id'); setSp(n); };
  return (
    <AdminShell title="Atendimento">
      {data && !data.whatsapp.api ? <Notice tone="info" title="WhatsApp">O botão "Falar no WhatsApp" do site abre o aplicativo (link wa.me) — não é atendimento automatizado. Para receber e responder mensagens aqui, configure a WhatsApp Business Cloud API (docs/INTEGRACOES.md). Status: API {data.whatsapp.api ? 'configurada' : 'não configurada'} · webhook {data.whatsapp.webhook ? 'configurado' : 'não configurado'}.</Notice> : null}
      <div className="admin-toolbar">
        <form role="search" className="admin-search" onSubmit={(e) => { e.preventDefault(); set('q', query.trim()); }}>
          <Icon name="search" size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Número, nome, e-mail ou assunto" aria-label="Buscar atendimentos" />
        </form>
        <div className="admin-tabs">{[['active', 'Em aberto'], ['open', 'Novos'], ['waiting_customer', 'Aguardando cliente'], ['resolved', 'Resolvidos'], ['closed', 'Encerrados'], ['all', 'Todos']].map(([k, l]) => <button key={k} className={status === k ? 'is-active' : ''} onClick={() => set('status', k!)}>{l}</button>)}</div>
        <div className="admin-tabs"><button className={sp.get('meus') ? 'is-active' : ''} onClick={() => set('meus', sp.get('meus') ? '' : '1')}>Meus</button><button className={sp.get('canal') === 'whatsapp' ? 'is-active' : ''} onClick={() => set('canal', sp.get('canal') === 'whatsapp' ? '' : 'whatsapp')}>WhatsApp</button></div>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.tickets.length ? <EmptyState title="Nenhum atendimento nesta lista" /> : (
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Atendimento</th><th>Cliente</th><th>Categoria</th><th>Prioridade</th><th>Status</th><th>Responsável</th><th>Atualizado</th></tr></thead>
          <tbody>{data.tickets.map((t) => (
            <tr key={t.id}><td><button className="admin-link" onClick={() => { const n = new URLSearchParams(sp); n.set('id', String(t.id)); setSp(n); }}>{t.number}</button><br /><small>{t.subject}</small>{t.orderNumber ? <small className="muted"> · {t.orderNumber}</small> : null}</td><td>{t.name}<br /><small className="muted">{t.channel === 'whatsapp' ? 'WhatsApp' : t.email}</small></td><td>{TICKET_CATEGORY_LABEL[t.category]}</td><td className={t.priority === 'urgent' || t.priority === 'high' ? 'is-warn' : ''}>{PRIORITY_LABEL[t.priority]}</td><td><span className={`status status--t-${t.status}`}>{TICKET_STATUS_LABEL[t.status]}</span></td><td>{t.assignee ?? '—'}</td><td>{dt(t.updatedAt)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {openId && data ? <TicketDialog id={openId} staff={data.staff} onClose={() => { const n = new URLSearchParams(sp); n.delete('id'); setSp(n); reload(); }} /> : null}
    </AdminShell>
  );
}

function TicketDialog({ id, staff, onClose }: { id: number; staff: { id: string; name: string }[]; onClose: () => void }) {
  const { notify } = useStore();
  const can = useCan();
  const { data: t, setData, error } = useApi<TicketDTO>(`/api/admin/support/tickets/${id}`);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const reply = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ delivery: string; ticket: TicketDTO }>(`/api/admin/support/tickets/${id}/messages`, { body, internal });
      setData(r.ticket); setBody('');
      const msg: Record<string, string> = { internal: 'Nota interna registrada.', email: 'Resposta enviada por e-mail.', whatsapp: 'Resposta enviada pelo WhatsApp e por e-mail (se houver).', whatsapp_window_closed: 'Fora da janela de 24h do WhatsApp: respondido só por e-mail. Mensagens no WhatsApp exigem modelo aprovado.', whatsapp_not_configured: 'WhatsApp API não configurada: resposta registrada (e enviada por e-mail, se houver).', whatsapp_failed: 'Falha ao enviar pelo WhatsApp; verifique Operação.' };
      notify(msg[r.delivery] ?? 'Resposta registrada.', r.delivery.includes('fail') ? 'error' : 'success');
    } catch (err) { notify(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  const patch = async (p: Record<string, unknown>) => { try { setData(await api.patch<TicketDTO>(`/api/admin/support/tickets/${id}`, p)); } catch (err) { notify(errorMessage(err), 'error'); } };
  return (
    <Dialog open onClose={onClose} title={t ? `${t.number} · ${t.subject}` : 'Atendimento'} className="admin-dialog">
      <div className="dialog__body">
        {error ? <ErrorState message={error} /> : !t ? <Loading /> : (
          <div className="admin-stack">
            <p className="small">{t.name} · {t.email.endsWith('.invalid') ? 'sem e-mail' : t.email}{t.phone ? ` · ${t.phone}` : ''} · canal {t.channel}{t.orderNumber ? <> · pedido <Link to={`/admin/pedidos/${t.orderNumber}`} className="admin-link">{t.orderNumber}</Link></> : null}{t.productName ? ` · produto ${t.productName}` : ''}</p>
            {can('support.write') ? (
              <div className="admin-fields">
                <SelectField label="Status" value={t.status} onChange={(e) => void patch({ status: e.target.value })}>{Object.entries(TICKET_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
                <SelectField label="Prioridade" value={t.priority} onChange={(e) => void patch({ priority: e.target.value })}>{Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
                <SelectField label="Responsável" value={t.assignee?.id ?? ''} onChange={(e) => void patch({ assigneeId: e.target.value || null })}><option value="">Sem responsável</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
                <SelectField label="Categoria" value={t.category} onChange={(e) => void patch({ category: e.target.value })}>{Object.entries(TICKET_CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
              </div>
            ) : null}
            <ol className="thread">
              {t.messages.map((m) => (
                <li key={m.id} className={`thread__msg thread__msg--${m.authorType}${m.internal ? ' thread__msg--internal' : ''}`}>
                  <p className="thread__meta"><strong>{m.authorType === 'customer' ? t.name : m.authorName ?? 'Sistema'}</strong> · {formatDateTime(m.createdAt)} · {m.internal ? 'NOTA INTERNA' : m.channel}</p>
                  <p className="thread__body">{m.body}</p>
                </li>
              ))}
            </ol>
            {can('support.write') ? (
              <form className="admin-form" onSubmit={reply}>
                <TextareaField label={internal ? 'Nota interna (somente equipe)' : 'Resposta ao cliente'} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000} />
                <Checkbox checked={internal} onChange={setInternal} label="Nota interna — não é enviada ao cliente" />
                <Button loading={busy} disabled={!body.trim()}>{internal ? 'Salvar nota' : 'Enviar resposta'}</Button>
              </form>
            ) : null}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// =============================================================================================
// Financeiro
// =============================================================================================
const EXPENSES: ResourceConfig = {
  name: 'expenses', title: 'Despesas', singular: 'Despesa', feminine: true, write: 'finance.write',
  intro: 'Registre apenas despesas reais (com comprovante). Vincule à campanha para calcular o retorno do investimento em marketing.',
  filters: [{ param: 'categoria', label: 'Categoria', options: [['marketing', 'Marketing'], ['embalagem', 'Embalagem'], ['frete', 'Frete'], ['plataforma', 'Plataforma'], ['taxas', 'Taxas'], ['pessoal', 'Pessoal'], ['impostos', 'Impostos'], ['outros', 'Outros']] }],
  fields: [
    { key: 'category', label: 'Categoria', type: 'select', options: [['marketing', 'Marketing'], ['embalagem', 'Embalagem'], ['frete', 'Frete'], ['plataforma', 'Plataforma'], ['taxas', 'Taxas'], ['pessoal', 'Pessoal'], ['aluguel', 'Aluguel'], ['impostos', 'Impostos'], ['fornecedores', 'Fornecedores'], ['outros', 'Outros']], default: 'outros' },
    { key: 'incurredOn', label: 'Data', type: 'date', required: true, default: new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10) },
    { key: 'description', label: 'Descrição', type: 'text', required: true, span: true },
    { key: 'amountCents', label: 'Valor (R$)', type: 'money', required: true },
    { key: 'campaignId', label: 'Campanha (ID, opcional)', type: 'number', nullable: true },
  ],
  columns: [{ key: 'description', label: 'Despesa' }, { key: 'category', label: 'Categoria' }, { key: 'incurredOn', label: 'Data', render: (r) => formatDate(String(r.incurredOn)) }, { key: 'amountCents', label: 'Valor', render: (r) => formatPrice(Number(r.amountCents)) }],
};

export function AdminFinance() {
  const [qs, setQs] = useState<string | null>(null);
  const [data, setData] = useState<FinanceSummaryDTO | null>(null);
  const [products, setProducts] = useState<{ productId: number; name: string; units: number; revenueCents: number; costCents: number | null; marginPercent: number | null; itemsWithoutCost: number }[]>([]);
  const [categories, setCategories] = useState<{ categoryId: number | null; name: string; units: number; revenueCents: number }[]>([]);
  const [movements, setMovements] = useState<{ at: string; kind: string; description: string; amountCents: number; ref: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((q: string) => {
    setQs(q);
    setError(null);
    api.get<FinanceSummaryDTO>(`/api/admin/finance/summary?${q}`).then(setData).catch((e: unknown) => setError(errorMessage(e)));
    api.get<{ products: typeof products }>(`/api/admin/finance/products?${q}`).then((r) => setProducts(r.products)).catch(() => setProducts([]));
    api.get<{ categories: typeof categories }>(`/api/admin/finance/categories?${q}`).then((r) => setCategories(r.categories)).catch(() => setCategories([]));
    api.get<{ movements: typeof movements }>(`/api/admin/finance/movements?${q}`).then((r) => setMovements(r.movements)).catch(() => setMovements([]));
  }, []);
  const can = useCan();
  const k = (label: string, v: number | null, note?: string, wide?: boolean) => <div className={`kpi${wide ? ' kpi--wide' : ''}`}><span>{label}</span><strong>{v == null ? '—' : formatPrice(v)}</strong>{note ? <small>{note}</small> : null}</div>;
  return (
    <AdminShell title="Financeiro" actions={qs ? <a className="btn btn--secondary btn--sm" href={`/api/admin/finance/export.csv?${qs}`} download><span className="btn__label">Exportar CSV</span><Icon name="download" size={14} /></a> : null}>
      <PeriodFilter onChange={load} />
      <p className="muted small admin-intro">Somente vendas reais (pedidos e pagamentos de demonstração não entram). Receita reconhecida na aprovação do pagamento pelo provedor; estornos na data de confirmação. Fórmulas em docs/FORMULAS-FINANCEIRAS.md.</p>
      {error ? <ErrorState message={error} onRetry={() => qs && load(qs)} /> : !data ? <Loading /> : (
        <>
          <div className="kpis">
            {k('Faturamento bruto (produtos)', data.grossSalesCents, `${data.orders.paidCount} pedido(s) pago(s)`)}
            {k('Descontos concedidos', data.discountsCents)}
            {k('Frete cobrado', data.shippingChargedCents)}
            {k('Valores pagos (provedor)', data.paidRevenueCents, 'aprovados pelo provedor')}
            {k('Reembolsos confirmados', data.refundsCents, `${data.orders.refundedCount} pedido(s)`)}
            {k('Receita líquida', data.netRevenueCents, 'pagos − reembolsos')}
            {k('Taxas do provedor', data.providerFeesCents)}
            {k('Custo dos produtos', data.productCostCents)}
            {k('Custo de frete', data.shippingCostCents)}
            {k('Embalagem', data.packagingCostCents)}
            {k('Despesas', data.expensesCents)}
            {k('Lucro estimado', data.estimatedProfitCents, data.estimatedProfitCents == null ? 'indisponível: faltam custos (ver abaixo)' : data.marginPercent != null ? `margem ${data.marginPercent.toFixed(1).replace('.', ',')}%` : 'sem receita no período', true)}
            {k('Ticket médio', data.averageTicketCents)}
            <div className="kpi"><span>Cancelamentos</span><strong>{data.orders.cancelledCount}</strong><small>pedidos no período</small></div>
          </div>
          {data.missing.length ? <Notice tone="warning" title="Rentabilidade não pode ser calculada com precisão">{data.missing.map((m) => <p key={m}>{m}</p>)}</Notice> : null}
          <div className="admin-grid">
            <section className="admin-card">
              <h2>Por dia</h2>
              {!data.byDay.length ? <p className="muted small">Sem pagamentos aprovados no período.</p> : (
                <div className="bars" role="img" aria-label="Valores pagos por dia">
                  {data.byDay.map((d) => { const max = Math.max(...data.byDay.map((x) => x.paidRevenueCents)); return <div key={d.day} className="bars__row"><span>{formatDate(`${d.day}T12:00:00`)}</span><span className="bars__bar"><span style={{ width: `${(d.paidRevenueCents / max) * 100}%` }} /></span><span>{formatPrice(d.paidRevenueCents)} · {d.orders}</span></div>; })}
                </div>
              )}
            </section>
            <section className="admin-card">
              <h2>Por forma de pagamento</h2>
              {!data.byMethod.length ? <p className="muted small">—</p> : <ul className="pay-history">{data.byMethod.map((m) => <li key={m.method}><span>{PAYMENT_METHOD_LABEL[m.method] ?? m.method}</span><span>{m.orders} pedido(s)</span><span>{formatPrice(m.paidRevenueCents)}</span></li>)}</ul>}
              <h2>Despesas por categoria</h2>
              {!data.expensesByCategory.length ? <p className="muted small">Nenhuma despesa registrada no período.</p> : <ul className="pay-history">{data.expensesByCategory.map((e) => <li key={e.category}><span>{e.category}</span><span>{formatPrice(e.amountCents)}</span></li>)}</ul>}
            </section>
          </div>
          <section className="admin-card">
            <h2>Categorias mais vendidas</h2>
            {!categories.length ? <p className="muted small">Sem vendas no período.</p> : <ul className="pay-history">{categories.map((c) => <li key={c.categoryId ?? 0}><span>{c.name}</span><span>{c.units} un.</span><span>{formatPrice(c.revenueCents)}</span></li>)}</ul>}
            <p className="muted small">Receita de itens (antes de cupons e frete), pela categoria principal do produto.</p>
          </section>
          <section className="admin-card">
            <h2>Margem por produto (mais vendidos)</h2>
            {!products.length ? <p className="muted small">Sem vendas no período.</p> : (
              <div className="admin-table-wrap"><table className="admin-table">
                <thead><tr><th>Produto</th><th>Unidades</th><th>Receita</th><th>Custo</th><th>Margem</th></tr></thead>
                <tbody>{products.map((p) => <tr key={p.productId}><td><Link to={`/admin/produtos/${p.productId}`} className="admin-link">{p.name}</Link></td><td>{p.units}</td><td>{formatPrice(p.revenueCents)}</td><td>{p.costCents == null ? <span className="is-warn">custo ausente em {p.itemsWithoutCost} venda(s)</span> : formatPrice(p.costCents)}</td><td>{p.marginPercent == null ? '—' : `${p.marginPercent.toFixed(1).replace('.', ',')}%`}</td></tr>)}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}
      {data ? (
        <section className="admin-card">
          <h2>Movimentações do período</h2>
          {!movements.length ? <p className="muted small">Nenhuma movimentação no período.</p> : (
            <div className="admin-table-wrap"><table className="admin-table">
              <thead><tr><th>Data</th><th>Movimentação</th><th>Pedido</th><th>Valor</th></tr></thead>
              <tbody>{[...movements].reverse().slice(0, 200).map((m, i) => <tr key={i}><td>{dt(m.at)}</td><td>{m.description}</td><td>{m.ref ? <Link to={`/admin/pedidos/${m.ref}`} className="admin-link">{m.ref}</Link> : '—'}</td><td className={m.amountCents < 0 ? 'is-danger' : ''}>{formatPrice(m.amountCents)}</td></tr>)}</tbody>
            </table></div>
          )}
          <p className="muted small">Entradas: pagamentos aprovados pelo provedor. Saídas: taxas do provedor, estornos confirmados e despesas lançadas. Custos de produto, frete e embalagem aparecem no resumo, não aqui.</p>
        </section>
      ) : null}
      {can('finance.read') ? <section className="admin-card"><h2>Despesas</h2><ResourcePage cfg={EXPENSES} embedded /></section> : null}
    </AdminShell>
  );
}

// =============================================================================================
// Analytics
// =============================================================================================
export function AdminAnalytics() {
  const [data, setData] = useState<AnalyticsReportDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((q: string) => { setError(null); api.get<AnalyticsReportDTO>(`/api/admin/analytics?${q}`).then(setData).catch((e: unknown) => setError(errorMessage(e))); }, []);
  return (
    <AdminShell title="Analytics">
      <PeriodFilter onChange={load} />
      <p className="muted small admin-intro">Eventos de navegação só de visitantes que permitiram cookies de análise (sem nome, e-mail ou IP). Compras e receita vêm dos pedidos aprovados pelo provedor — nunca de visitas à página de sucesso.</p>
      {error ? <ErrorState message={error} /> : !data ? <Loading /> : (
        <>
          <div className="kpis">
            <div className="kpi"><span>Sessões com consentimento</span><strong>{data.consentedSessions}</strong></div>
            <div className="kpi"><span>Pedidos pagos</span><strong>{data.purchases.orders}</strong><small>fonte: pagamentos aprovados</small></div>
            <div className="kpi"><span>Receita confirmada</span><strong>{formatPrice(data.purchases.revenueCents)}</strong></div>
          </div>
          <div className="admin-grid">
            <section className="admin-card">
              <h2>Funil (sessões)</h2>
              <div className="bars">{data.funnel.map((f) => { const max = Math.max(1, ...data.funnel.map((x) => x.sessions)); return <div key={f.step} className="bars__row"><span>{f.step}</span><span className="bars__bar"><span style={{ width: `${(f.sessions / max) * 100}%` }} /></span><span>{f.sessions}</span></div>; })}</div>
              <p className="muted small">Pedidos pagos no período: {data.purchases.orders} (dado comercial, não de navegação).</p>
            </section>
            <section className="admin-card">
              <h2>Origens</h2>
              {!data.sources.length ? <p className="muted small">Sem dados no período.</p> : <ul className="pay-history">{data.sources.map((s) => <li key={s.source}><span>{s.source}</span><span>{s.sessions} sessão(ões)</span><span>{s.orders} pedido(s) · {formatPrice(s.revenueCents)}</span></li>)}</ul>}
            </section>
            <section className="admin-card">
              <h2>Produtos mais vistos</h2>
              {!data.topProducts.length ? <p className="muted small">Sem dados no período.</p> : <ul className="pay-history">{data.topProducts.map((p) => <li key={p.productId}><Link to={`/admin/produtos/${p.productId}`} className="admin-link">{p.name}</Link><span>{p.views} visualizações</span><span>{p.addToCart} no carrinho · {p.purchases} vendidas</span></li>)}</ul>}
            </section>
            <section className="admin-card">
              <h2>Buscas</h2>
              {data.topSearches.length ? <ul className="pay-history">{data.topSearches.map((s) => <li key={s.term}><span>{s.term}</span><span>{s.count}×</span><span>média {s.avgResults} resultados</span></li>)}</ul> : <p className="muted small">Sem buscas registradas.</p>}
              <h2>Buscas sem resultado</h2>
              {data.zeroResultSearches.length ? <ul className="pay-history">{data.zeroResultSearches.map((s) => <li key={s.term}><span>{s.term}</span><span>{s.count}×</span></li>)}</ul> : <p className="muted small">Nenhuma busca sem resultado.</p>}
              <p className="muted small">Use as buscas sem resultado para ajustar nomes, descrições e o catálogo.</p>
            </section>
          </div>
        </>
      )}
    </AdminShell>
  );
}

// =============================================================================================
// Marketing: campanhas, newsletter, carrinhos abandonados
// =============================================================================================
const CAMPAIGNS: ResourceConfig = {
  name: 'campaigns', title: 'Campanhas', singular: 'Campanha', feminine: true, write: 'marketing.write',
  intro: 'Cada campanha tem um utm_campaign único. Pedidos que chegam com esse parâmetro são atribuídos a ela. Gastos são as despesas vinculadas (Financeiro).',
  filters: [{ param: 'status', label: 'Status', options: [['draft', 'Rascunho'], ['active', 'Ativas'], ['ended', 'Encerradas']] }],
  fields: [
    { key: 'name', label: 'Nome', type: 'text', required: true },
    { key: 'slug', label: 'Identificador', type: 'slug', slugFrom: 'name', required: true },
    { key: 'channel', label: 'Canal', type: 'select', options: [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook'], ['google', 'Google'], ['email', 'E-mail'], ['whatsapp', 'WhatsApp'], ['influenciador', 'Influenciador'], ['evento', 'Evento'], ['outro', 'Outro']], default: 'instagram' },
    { key: 'status', label: 'Status', type: 'select', options: [['draft', 'Rascunho'], ['active', 'Ativa'], ['ended', 'Encerrada']], default: 'draft' },
    { key: 'utmSource', label: 'utm_source', type: 'text' },
    { key: 'utmMedium', label: 'utm_medium', type: 'text' },
    { key: 'utmCampaign', label: 'utm_campaign', type: 'text', required: true },
    { key: 'landingPath', label: 'Página de destino', type: 'url', required: true, default: '/' },
    { key: 'couponId', label: 'Cupom vinculado (ID, opcional)', type: 'number', nullable: true },
    { key: 'startsAt', label: 'Início', type: 'datetime' },
    { key: 'endsAt', label: 'Fim', type: 'datetime' },
    { key: 'notes', label: 'Observações', type: 'textarea' },
  ],
  columns: [{ key: 'name', label: 'Campanha' }, { key: 'channel', label: 'Canal' }, { key: 'utmCampaign', label: 'utm_campaign' }, { key: 'status', label: 'Status' }],
  rowActions: (r) => <button className="icon-btn" aria-label="Copiar link da campanha" title="Copiar link com UTM" onClick={() => { const u = new URL(String(r.landingPath ?? '/'), window.location.origin); if (r.utmSource) u.searchParams.set('utm_source', String(r.utmSource)); if (r.utmMedium) u.searchParams.set('utm_medium', String(r.utmMedium)); u.searchParams.set('utm_campaign', String(r.utmCampaign)); void navigator.clipboard.writeText(u.toString()); }}><Icon name="copy" size={16} /></button>,
};

export function AdminMarketing() {
  const report = useApi<{ campaigns: { id: number; name: string; status: string; channel: string; utmCampaign: string; spendCents: number; orders: number; revenueCents: number; roas: number | null; coupon: { code: string; uses: number } | null }[] }>('/api/admin/marketing/campaigns-report');
  const news = useApi<{ counts: { status: string; n: number }[]; subscribers: { id: number; email: string; name: string | null; status: string; source: string; createdAt: string; confirmedAt: string | null }[] }>('/api/admin/marketing/newsletter');
  const carts = useApi<{ carts: { id: number; updatedAt: string; reminderSentAt: string | null; optIn: number; items: number; valueCents: number | null }[] }>('/api/admin/marketing/abandoned-carts');
  const can = useCan();
  const count = (s: string) => news.data?.counts.find((c) => c.status === s)?.n ?? 0;
  return (
    <AdminShell title="Marketing">
      <section className="admin-card">
        <h2>Resultado das campanhas</h2>
        {report.loading && !report.data ? <Loading inline /> : !report.data?.campaigns.length ? <p className="muted small">Nenhuma campanha cadastrada.</p> : (
          <div className="admin-table-wrap"><table className="admin-table">
            <thead><tr><th>Campanha</th><th>Status</th><th>Pedidos pagos</th><th>Receita</th><th>Gasto registrado</th><th>ROAS</th><th>Cupom</th></tr></thead>
            <tbody>{report.data.campaigns.map((c) => <tr key={c.id}><td>{c.name}<br /><small className="muted">{c.channel} · {c.utmCampaign}</small></td><td>{c.status}</td><td>{c.orders}</td><td>{formatPrice(c.revenueCents)}</td><td>{c.spendCents ? formatPrice(c.spendCents) : <span className="muted">sem despesa vinculada</span>}</td><td>{c.roas == null ? '—' : `${c.roas.toFixed(2).replace('.', ',')}×`}</td><td>{c.coupon ? `${c.coupon.code} (${c.coupon.uses} usos)` : '—'}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      <section className="admin-card"><h2>Campanhas</h2><ResourcePage cfg={CAMPAIGNS} embedded /></section>
      <div className="admin-grid">
        <section className="admin-card">
          <div className="admin-card__head"><h2>Newsletter</h2>{can('marketing.write') ? <a className="link-btn" href="/api/admin/marketing/newsletter.csv" download>Exportar confirmados (CSV)</a> : null}</div>
          <div className="kpis"><div className="kpi"><span>Confirmados</span><strong>{count('confirmed')}</strong></div><div className="kpi"><span>Pendentes</span><strong>{count('pending')}</strong></div><div className="kpi"><span>Descadastrados</span><strong>{count('unsubscribed')}</strong></div></div>
          <p className="muted small">Inscrição com confirmação por e-mail (double opt-in) e descadastro em um clique. Envie campanhas somente para "confirmados".</p>
          {news.data?.subscribers.length ? <ul className="pay-history">{news.data.subscribers.slice(0, 20).map((s) => <li key={s.id}><span>{s.email}</span><span className="tag">{s.status}</span><small>{s.source} · {formatDate(s.createdAt)}</small></li>)}</ul> : null}
        </section>
        <section className="admin-card">
          <h2>Carrinhos abandonados</h2>
          <p className="muted small">Lembrete único por e-mail, enviado pela rotina "carrinho-abandonado" apenas para clientes com conta que autorizaram comunicações de marketing.</p>
          {!carts.data?.carts.length ? <p className="muted small">Nenhum carrinho parado no momento.</p> : <ul className="pay-history">{carts.data.carts.slice(0, 30).map((c) => <li key={c.id}><span>{c.items} item(ns) · {money(c.valueCents)}</span><span>{c.optIn ? (c.reminderSentAt ? `lembrete ${dt(c.reminderSentAt)}` : 'aguardando lembrete') : 'sem consentimento'}</span><small>parado desde {dt(c.updatedAt)}</small></li>)}</ul>}
        </section>
      </div>
      <p className="muted small">Cupons ficam em <Link to="/admin/cupons" className="link-underline">Cupons</Link>. Vale-presente: não implementado nesta versão (ver docs/PENDENCIAS.md).</p>
    </AdminShell>
  );
}

// =============================================================================================
// Operação: saúde, consistência, rotinas, erros, backups, webhooks e comunicações
// =============================================================================================
interface OpsData {
  health: { status: string; checkedAt: string; environment: string; database: string; integrity: string; migrations: string[]; integrations: Record<string, string | boolean>; openErrors: number; lastBackup: { file: string; created_at: string; status: string; verified_at: string | null } | null; production: boolean };
  issues: { key: string; level: string; title: string; detail: string; count: number; refs: string[] }[];
  jobs: { name: string; description: string; everyMinutes: number; last: { status: string; startedAt: string; finishedAt: string | null; detail: string | null } | null }[];
  errors: { id: number; level: string; source: string; message: string; occurrences: number; firstSeenAt: string; lastSeenAt: string; alertedAt: string | null }[];
  backups: { id: number; file: string; sizeBytes: number; kind: string; status: string; detail: string | null; createdAt: string; verifiedAt: string | null }[];
}

const INTEGRATION_LABEL: Record<string, string> = { payments: 'Pagamentos', webhookSignature: 'Assinatura do webhook de pagamento', shipping: 'Frete e etiquetas', email: 'E-mail transacional', whatsapp: 'WhatsApp', alerts: 'Alertas operacionais', googleAuth: 'Login com Google' };

export function AdminOperations() {
  const { data, error, loading, reload } = useApi<OpsData>('/api/admin/ops');
  const events = useApi<{ events: { id: number; provider: string; eventKey: string; providerPaymentId: string | null; type: string; status: string | null; signatureValid: number; result: string; detail: string | null; attempts: number; receivedAt: string; orderNumber: string | null }[] }>('/api/admin/payment-events');
  const comms = useApi<{ notifications: { id: number; event: string; recipient: string; status: string; createdAt: string; orderNumber: string | null }[]; emails: { id: number; toEmail: string; subject: string; status: string; error: string | null; attempts: number; createdAt: string }[] }>('/api/admin/ops/communications');
  const { notify } = useStore();
  const can = useCan();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); notify(ok, 'success'); reload(); events.reload(); comms.reload(); } catch (e) { notify(errorMessage(e), 'error'); } finally { setBusy(null); } };
  return (
    <AdminShell title="Operação" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={() => { reload(); events.reload(); comms.reload(); }}>Atualizar</Button>}>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data ? (
        <>
          <div className="kpis">
            <div className={`kpi${data.health.status === 'ok' ? '' : ' kpi--sev-critical'}`}><span>Saúde</span><strong>{data.health.status === 'ok' ? 'OK' : 'Degradado'}</strong><small>banco {data.health.database} · integridade {data.health.integrity}</small></div>
            <div className="kpi"><span>Erros abertos</span><strong>{data.health.openErrors}</strong></div>
            <div className="kpi"><span>Divergências</span><strong>{data.issues.length}</strong></div>
            <div className="kpi kpi--wide"><span>Último backup</span><strong>{data.health.lastBackup ? dt(data.health.lastBackup.created_at) : 'nenhum'}</strong><small>{data.health.lastBackup ? (data.health.lastBackup.verified_at ? 'verificado (teste de restauração)' : 'não verificado') : 'execute um backup'}</small></div>
          </div>
          <section className="admin-card">
            <h2>Integrações (configuração detectada)</h2>
            <ul className="pay-history">{Object.entries(data.health.integrations).map(([k, v]) => <li key={k}><span>{INTEGRATION_LABEL[k] ?? k}</span><span className={v === false || v === 'não configurado' ? 'is-warn' : ''}>{v === true ? 'configurado' : v === false ? 'não configurado' : String(v)}</span></li>)}</ul>
            <p className="muted small">"Configurado" significa que as variáveis existem; a ativação em produção exige teste com o provedor real. Ambiente: {data.health.environment}. Migrations: {data.health.migrations.join(', ')}.</p>
          </section>
          <section className="admin-card">
            <h2>Verificações de consistência</h2>
            {!data.issues.length ? <p className="muted small">Nenhuma divergência encontrada (pagamentos, estoque, webhooks, e-mails, estornos e entregas).</p> : data.issues.map((i) => <Notice key={i.key} tone={i.level === 'critical' ? 'error' : 'warning'} title={`${i.title} (${i.count})`}>{i.detail}<br /><small>{i.refs.join(', ')}</small></Notice>)}
          </section>
          <section className="admin-card">
            <h2>Rotinas automáticas</h2>
            <div className="admin-table-wrap"><table className="admin-table">
              <thead><tr><th>Rotina</th><th>Frequência</th><th>Última execução</th><th>Resultado</th><th /></tr></thead>
              <tbody>{data.jobs.map((j) => <tr key={j.name}><td><strong>{j.name}</strong><br /><small className="muted">{j.description}</small></td><td>a cada {j.everyMinutes} min</td><td>{j.last ? dt(j.last.startedAt) : 'nunca'}</td><td className={j.last?.status === 'failed' ? 'is-danger' : ''}>{j.last ? `${j.last.status}${j.last.detail ? ` · ${j.last.detail.slice(0, 80)}` : ''}` : '—'}</td><td>{can('ops.write') ? <Button size="sm" variant="ghost" loading={busy === j.name} onClick={() => void act(j.name, () => api.post(`/api/admin/ops/jobs/${j.name}/run`), `Rotina ${j.name} executada.`)}>Executar</Button> : null}</td></tr>)}</tbody>
            </table></div>
            <p className="muted small">As rotinas rodam no servidor com JOBS_ENABLED=true (apenas uma instância). Em ambientes serverless, agende chamadas externas (docs/OPERACAO-BACKUP.md).</p>
          </section>
          <div className="admin-grid">
            <section className="admin-card">
              <div className="admin-card__head"><h2>Backups</h2>{can('ops.write') ? <Button size="sm" loading={busy === 'backup'} onClick={() => void act('backup', () => api.post('/api/admin/ops/backups'), 'Backup criado e verificado.')}>Fazer backup agora</Button> : null}</div>
              {!data.backups.length ? <p className="muted small">Nenhum backup registrado.</p> : <ul className="pay-history">{data.backups.slice(0, 12).map((b) => <li key={b.id}><span>{b.file}</span><span className={b.status === 'failed' ? 'is-danger' : ''}>{b.status}</span><small>{(b.sizeBytes / 1024).toFixed(0)} KB · {dt(b.createdAt)}{can('ops.write') && b.status !== 'removed' && b.status !== 'failed' ? <> · <button className="link-btn" onClick={() => void act(`v${b.id}`, () => api.post(`/api/admin/ops/backups/${b.id}/verify`), 'Backup verificado.')}>Verificar</button></> : null}</small></li>)}</ul>}
              <p className="muted small">Backups ficam no disco do servidor (BACKUP_DIR). Cópia externa (outro local) é obrigatória em produção — ver docs/OPERACAO-BACKUP.md.</p>
            </section>
            <section className="admin-card">
              <h2>Erros registrados</h2>
              {!data.errors.length ? <p className="muted small">Nenhum erro aberto.</p> : <ul className="pay-history">{data.errors.map((e) => <li key={e.id}><span className={e.level === 'critical' ? 'is-danger' : ''}>{e.level} · {e.source}</span><span>{e.message.slice(0, 120)}</span><small>{e.occurrences}× · último {dt(e.lastSeenAt)}{e.alertedAt ? ' · alerta enviado' : ''}{can('ops.write') ? <> · <button className="link-btn" onClick={() => void act(`e${e.id}`, () => api.post(`/api/admin/ops/errors/${e.id}/resolve`), 'Marcado como resolvido.')}>Resolver</button></> : null}</small></li>)}</ul>}
            </section>
          </div>
        </>
      ) : null}
      <section className="admin-card">
        <h2>Webhooks de pagamento</h2>
        {!events.data?.events.length ? <p className="muted small">Nenhuma notificação recebida.</p> : (
          <div className="admin-table-wrap"><table className="admin-table">
            <thead><tr><th>Recebido</th><th>Tipo</th><th>Pedido</th><th>Assinatura</th><th>Resultado</th><th>Tentativas</th><th /></tr></thead>
            <tbody>{events.data.events.slice(0, 50).map((e) => <tr key={e.id}><td>{dt(e.receivedAt)}</td><td>{e.provider} · {e.type}{e.status ? ` · ${e.status}` : ''}</td><td>{e.orderNumber ?? '—'}</td><td>{e.signatureValid ? 'válida' : <span className="is-danger">inválida</span>}</td><td className={e.result === 'error' ? 'is-danger' : ''}>{e.result}{e.detail ? <small className="muted"> · {e.detail}</small> : null}</td><td>{e.attempts}</td><td>{can('ops.write') && e.provider === 'mercadopago' && e.signatureValid && e.providerPaymentId ? <button className="link-btn" onClick={() => void act(`ev${e.id}`, () => api.post(`/api/admin/payment-events/${e.id}/reprocess`), 'Notificação reprocessada (consulta ao provedor).')}>Reprocessar</button> : null}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      <section className="admin-card">
        <h2>Comunicações enviadas</h2>
        {!comms.data ? <Loading inline /> : (
          <div className="admin-grid">
            <div><p className="field-legend">Notificações</p><ul className="pay-history">{comms.data.notifications.slice(0, 20).map((n) => <li key={n.id}><span>{n.event}</span><span>{n.status}</span><small>{n.orderNumber ?? ''} · {dt(n.createdAt)}</small></li>)}</ul></div>
            <div><p className="field-legend">Fila de e-mails</p><ul className="pay-history">{comms.data.emails.slice(0, 20).map((m) => <li key={m.id}><span>{m.subject}</span><span className={m.status === 'failed' ? 'is-danger' : ''}>{m.status === 'logged' ? 'registrado (provedor não configurado)' : m.status}</span><small>{dt(m.createdAt)}{m.status === 'failed' && can('ops.write') ? <> · <button className="link-btn" onClick={() => void act(`m${m.id}`, () => api.post(`/api/admin/ops/emails/${m.id}/retry`), 'Reenvio solicitado.')}>Reenviar</button></> : null}</small></li>)}</ul></div>
          </div>
        )}
        <p className="muted small">"Registrado" = EMAIL_PROVIDER=console: nada é enviado de verdade até configurar a Resend. <a className="link-btn" href="/api/admin/email-preview" target="_blank" rel="noopener noreferrer">Ver modelo de e-mail</a></p>
      </section>
    </AdminShell>
  );
}

// =============================================================================================
// Equipe e permissões (proprietário)
// =============================================================================================
export function AdminTeam() {
  const { data, error, loading, reload } = useApi<{ roles: { role: string; label: string; permissions: string[] }[]; members: { id: string; email: string; staffRole: string; name: string; createdAt: string; lastSessionAt: string | null }[] }>('/api/admin/team');
  const { notify, user } = useStore();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('support');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post('/api/admin/team', { email, role }); setEmail(''); notify('Pessoa adicionada à equipe. Ela precisa entrar novamente para receber as permissões.', 'success'); reload(); } catch (err) { notify(errorMessage(err), 'error'); }
  };
  const change = async (id: string, r: string) => { try { await api.patch(`/api/admin/team/${id}`, { role: r }); notify('Função alterada.', 'success'); reload(); } catch (err) { notify(errorMessage(err), 'error'); reload(); } };
  const remove = async (id: string, mail: string) => { if (!window.confirm(`Remover ${mail} da equipe?`)) return; try { await api.del(`/api/admin/team/${id}`); notify('Acesso removido.', 'info'); reload(); } catch (err) { notify(errorMessage(err), 'error'); } };
  return (
    <AdminShell title="Equipe e permissões">
      <p className="muted small admin-intro">Cada pessoa usa a própria conta (sem contas compartilhadas). A loja nunca define senhas de terceiros: a pessoa cria a conta no site e o proprietário atribui a função. Todas as mudanças ficam na auditoria.</p>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data ? (
        <>
          <section className="admin-card">
            <h2>Membros</h2>
            <div className="admin-table-wrap"><table className="admin-table">
              <thead><tr><th>Pessoa</th><th>Função</th><th>Último acesso</th><th /></tr></thead>
              <tbody>{data.members.map((m) => (
                <tr key={m.id}><td>{m.name}<br /><small className="muted">{m.email}</small></td>
                  <td>{m.id === user?.id ? <span className="tag">{data.roles.find((r) => r.role === m.staffRole)?.label ?? m.staffRole} (você)</span> : <select value={m.staffRole ?? 'owner'} onChange={(e) => void change(m.id, e.target.value)} aria-label={`Função de ${m.email}`}>{data.roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</select>}</td>
                  <td>{dt(m.lastSessionAt)}</td>
                  <td>{m.id !== user?.id ? <button className="link-btn" onClick={() => void remove(m.id, m.email)}>Remover acesso</button> : null}</td></tr>
              ))}</tbody>
            </table></div>
            <form className="admin-fields" onSubmit={add}>
              <Field label="E-mail de uma conta existente" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <SelectField label="Função" value={role} onChange={(e) => setRole(e.target.value)}>{data.roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</SelectField>
              <div className="span-2"><Button>Adicionar à equipe</Button></div>
            </form>
          </section>
          <section className="admin-card">
            <h2>O que cada função pode fazer</h2>
            <div className="admin-table-wrap"><table className="admin-table perm-matrix">
              <thead><tr><th>Permissão</th>{data.roles.map((r) => <th key={r.role}>{r.label}</th>)}</tr></thead>
              <tbody>{[...new Set(data.roles.flatMap((r) => r.permissions))].map((p) => <tr key={p}><td><code>{p}</code></td>{data.roles.map((r) => <td key={r.role}>{r.permissions.includes(p) ? <Icon name="check" size={16} /> : ''}</td>)}</tr>)}</tbody>
            </table></div>
          </section>
        </>
      ) : null}
    </AdminShell>
  );
}

// =============================================================================================
// Auditoria e LGPD
// =============================================================================================
export function AdminAudit() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const result = sp.get('resultado') ?? '';
  const page = Number(sp.get('pagina') ?? 1);
  const { data, error, loading, reload } = useApi<{ entries: { id: number; actor: string; actorEmail: string | null; action: string; entity: string; entityId: string | null; data: string | null; result: string; ip: string | null; createdAt: string }[] }>(`/api/admin/audit?q=${encodeURIComponent(sp.get('q') ?? '')}${result ? `&resultado=${result}` : ''}&pagina=${page}`);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'pagina') n.delete('pagina'); setSp(n); };
  return (
    <AdminShell title="Auditoria">
      <p className="muted small admin-intro">Registro de ações críticas: preços, estoque, publicação, permissões, cancelamentos, estornos, financeiro, privacidade e tentativas negadas. Senhas, tokens e dados de cartão nunca são gravados.</p>
      <div className="admin-toolbar">
        <form role="search" className="admin-search" onSubmit={(e) => { e.preventDefault(); set('q', q.trim()); }}><Icon name="search" size={18} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ação, entidade, ID ou e-mail" aria-label="Buscar na auditoria" /></form>
        <div className="admin-tabs">{[['', 'Todos'], ['success', 'Sucesso'], ['denied', 'Negados'], ['failed', 'Falhas']].map(([k, l]) => <button key={k} className={result === k ? 'is-active' : ''} onClick={() => set('resultado', k!)}>{l}</button>)}</div>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.entries.length ? <EmptyState title="Nenhum registro" /> : (
        <>
          <div className="admin-table-wrap"><table className="admin-table">
            <thead><tr><th>Data</th><th>Responsável</th><th>Ação</th><th>Entidade</th><th>Resultado</th><th>Detalhes</th></tr></thead>
            <tbody>{data.entries.map((e) => <tr key={e.id}><td>{dt(e.createdAt)}</td><td>{e.actorEmail ?? e.actor}{e.ip ? <small className="muted"><br />{e.ip}</small> : null}</td><td><code>{e.action}</code></td><td>{e.entity}{e.entityId ? ` #${e.entityId}` : ''}</td><td className={e.result !== 'success' ? 'is-danger' : ''}>{e.result}</td><td><small className="audit-data">{e.data ? e.data.slice(0, 220) : '—'}</small></td></tr>)}</tbody>
          </table></div>
          <div className="admin-row"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => set('pagina', String(page - 1))}>Anterior</Button><Button size="sm" variant="ghost" disabled={data.entries.length < 100} onClick={() => set('pagina', String(page + 1))}>Próxima</Button></div>
        </>
      )}
    </AdminShell>
  );
}

export function AdminPrivacy() {
  const { data, error, loading, reload } = useApi<{ requests: { id: number; userId: string | null; email: string; type: string; status: string; note: string | null; handledBy: string | null; createdAt: string; completedAt: string | null }[] }>('/api/admin/privacy/requests');
  const { notify } = useStore();
  const TYPE: Record<string, string> = { export: 'Cópia dos dados', deletion: 'Exclusão', correction: 'Correção' };
  const update = async (id: number, status: string) => { const note = window.prompt('Observação (opcional):') ?? undefined; try { await api.patch(`/api/admin/privacy/requests/${id}`, { status, note }); notify('Solicitação atualizada.', 'success'); reload(); } catch (e) { notify(errorMessage(e), 'error'); } };
  const anonymize = async (userId: string, email: string) => {
    if (window.prompt(`Anonimizar ${email}? Irreversível. Digite ANONIMIZAR:`) !== 'ANONIMIZAR') return;
    try { await api.post(`/api/admin/privacy/users/${userId}/anonymize`, { confirm: 'ANONIMIZAR' }); notify('Conta anonimizada e solicitação concluída.', 'success'); reload(); } catch (e) { notify(errorMessage(e), 'error'); }
  };
  return (
    <AdminShell title="Privacidade (LGPD)">
      <p className="muted small admin-intro">Solicitações de titulares (art. 18 da LGPD). Exportações pela conta são atendidas automaticamente. Exclusão = anonimização da conta; pedidos e pagamentos são mantidos pelo prazo legal, sem dados de contato. Prazo de resposta recomendado: 15 dias.</p>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.requests.length ? <EmptyState title="Nenhuma solicitação" /> : (
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Titular</th><th>Tipo</th><th>Status</th><th>Recebida</th><th>Concluída</th><th /></tr></thead>
          <tbody>{data.requests.map((r) => (
            <tr key={r.id}><td>{r.email}</td><td>{TYPE[r.type] ?? r.type}</td><td>{r.status}{r.note ? <small className="muted"><br />{r.note}</small> : null}</td><td>{dt(r.createdAt)}</td><td>{dt(r.completedAt)}</td>
              <td className="admin-row">{r.status === 'requested' ? <button className="link-btn" onClick={() => void update(r.id, 'in_review')}>Em análise</button> : null}{['requested', 'in_review'].includes(r.status) && r.type === 'deletion' && r.userId ? <button className="link-btn" onClick={() => void anonymize(r.userId!, r.email)}>Anonimizar conta</button> : null}{r.userId ? <a className="link-btn" href={`/api/admin/privacy/users/${r.userId}/export`} download>Exportar</a> : null}{['requested', 'in_review'].includes(r.status) ? <><button className="link-btn" onClick={() => void update(r.id, 'completed')}>Concluir</button><button className="link-btn" onClick={() => void update(r.id, 'rejected')}>Recusar</button></> : null}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </AdminShell>
  );
}

// =============================================================================================
// Marca: identidade, materiais e e-mails
// =============================================================================================
const L = '/assets/branding/logo';
const P = '/assets/branding/print';
const BRAND_FILES: { file: string; label: string; note: string; pdf?: boolean; dark?: boolean }[] = [
  { file: `${L}/gazu-logo-preto.svg`, label: 'Logotipo preto', note: 'Fundos claros (off-white, pedra, branco). PNG 2000 px disponível.' },
  { file: `${L}/gazu-logo-branco.svg`, label: 'Logotipo branco', note: 'Fundos escuros e fotos com área escura.', dark: true },
  { file: `${L}/gazu-monograma-preto.svg`, label: 'Monograma "G"', note: 'Favicon, avatar, lacre, padrões.' },
  { file: `${L}/gazu-monograma-branco.svg`, label: 'Monograma "G" branco', note: 'Sobre preto ou fotos escuras.', dark: true },
  { file: '/favicon.svg', label: 'Favicon', note: 'Alterna claro/escuro conforme o navegador.' },
  { file: '/assets/branding/social/gazu-avatar-preto-1080.png', label: 'Avatar de redes sociais', note: '1080 × 1080 px (versão clara também disponível).' },
  { file: '/assets/branding/social/gazu-capa-1500x500.png', label: 'Capa de redes sociais', note: '1500 × 500 px.' },
  { file: `${P}/tag-frente.svg`, label: 'Tag de roupa — frente', note: '50 × 90 mm, furo de 4 mm.', pdf: true },
  { file: `${P}/tag-verso.svg`, label: 'Tag de roupa — verso', note: 'Campos em branco para produto, tamanho, cor, SKU e preço.', pdf: true },
  { file: `${P}/cartao-agradecimento-frente.svg`, label: 'Cartão de agradecimento — frente', note: 'A6 (105 × 148 mm).', pdf: true },
  { file: `${P}/cartao-agradecimento-verso.svg`, label: 'Cartão de agradecimento — verso', note: 'Ajuda, trocas e direito de arrependimento (CDC art. 49).', pdf: true },
  { file: `${P}/adesivo-lacre-preto.svg`, label: 'Adesivo de lacre', note: 'Ø 50 mm (versão clara também disponível).', pdf: true },
  { file: `${P}/cuidados.svg`, label: 'Cartão de cuidados', note: 'A6. Orientações gerais; a etiqueta interna prevalece.', pdf: true },
  { file: `${P}/troca-devolucao.svg`, label: 'Formulário de troca e devolução', note: 'A5 (148 × 210 mm), vai dentro da embalagem.', pdf: true },
  { file: `${P}/caixa-tampa.svg`, label: 'Arte da tampa da caixa', note: '300 × 220 mm — ajustar à faca do fornecedor.', pdf: true },
  { file: `${P}/papel-seda-padrao.svg`, label: 'Papel de seda', note: 'Módulo repetível 200 × 200 mm.', pdf: true },
  { file: `${P}/etiqueta-remetente.svg`, label: 'Etiqueta de remetente', note: '100 × 150 mm. Não substitui a etiqueta da transportadora.', pdf: true },
];

export function AdminBrand() {
  return (
    <AdminShell title="Marca e materiais">
      <p className="muted small admin-intro">Sistema de identidade da GAZU (documento completo em docs/IDENTIDADE-VISUAL.md). Os arquivos de impressão estão no tamanho real e prontos para revisão com a gráfica; nenhum material físico foi produzido.</p>
      <section className="admin-card">
        <h2>Paleta</h2>
        <ul className="swatch-grid">{[['Preto GAZU', '#111111'], ['Grafite', '#242424'], ['Off-white', '#F7F6F3'], ['Pedra', '#E8E7E3'], ['Pedra escura', '#DCDBD7'], ['Branco', '#FFFFFF'], ['Cinza de apoio', '#6B6B6B'], ['Linha', '#D6D5D0']].map(([n, h]) => <li key={h}><span style={{ background: h }} /><strong>{n}</strong><code>{h}</code></li>)}</ul>
      </section>
      <section className="admin-card">
        <h2>Arquivos</h2>
        <ul className="brand-files">{BRAND_FILES.map((f) => <li key={f.file}><a href={f.file} target="_blank" rel="noopener noreferrer" className={`brand-files__preview${f.dark ? ' brand-files__preview--dark' : ''}`}><img src={f.file} alt={f.label} loading="lazy" /></a><strong>{f.label}</strong><small className="muted">{f.note}</small><span className="admin-row"><a href={f.file} download className="link-btn">Baixar {f.file.endsWith('.png') ? 'PNG' : 'SVG'}</a>{f.pdf ? <a href={f.file.replace(/\.svg$/, '.pdf')} download className="link-btn">PDF</a> : null}</span></li>)}</ul>
        <p className="muted small"><a className="link-btn" href={`${P}/gazu-prova-materiais.pdf`} target="_blank" rel="noopener noreferrer">Prova de todos os materiais (PDF A4)</a> · Fonte Inter (licença OFL) em /assets/branding/fonts. Arquivos gerados por <code>node scripts/assets/build-brand-kit.mjs</code>.</p>
      </section>
      <section className="admin-card">
        <h2>E-mails transacionais</h2>
        <p className="muted small">Todos os e-mails (pedido, pagamento, envio, entrega, cancelamento, estorno, trocas, atendimento, newsletter e lista de espera) usam o mesmo modelo.</p>
        <a className="btn btn--secondary btn--sm" href="/api/admin/email-preview" target="_blank" rel="noopener noreferrer"><span className="btn__label">Ver modelo de e-mail</span><Icon name="external" size={14} /></a>
      </section>
    </AdminShell>
  );
}


