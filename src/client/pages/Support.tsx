import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { Link, useRouter, useSearchParams } from '../lib/router';
import { useStore } from '../lib/store';
import { formatDateTime, ORDER_STATUS_LABEL, SHIPMENT_STATUS_LABEL, TICKET_CATEGORY_LABEL, TICKET_STATUS_LABEL } from '../../shared/format';
import type { OrderDTO, TicketDTO } from '../../shared/types';
import { OrderView } from '../components/account/OrderView';
import { whatsappLink } from '../components/content/Editorial';
import { Icon } from '../components/ui/Icon';
import { Breadcrumbs, Button, Checkbox, ErrorState, Field, Loading, Notice, SelectField, TextareaField } from '../components/ui/ui';

const CATEGORIES = Object.entries(TICKET_CATEGORY_LABEL);

// ---------------------------------------------------------------------------------------------
// Atendimento: canais + formulário (cria um chamado na central)
// ---------------------------------------------------------------------------------------------
export function ServicePage() {
  useDocumentTitle('Atendimento');
  const { config, user } = useStore();
  const { navigate } = useRouter();
  const [sp] = useSearchParams();
  const c = config.settings.contact;
  const wa = whatsappLink(c.whatsapp, config.settings.whatsapp?.defaultMessage ?? 'Olá! Vim pelo site da GAZU.');
  const [v, setV] = useState({ name: user?.name ?? '', email: user?.email ?? '', phone: '', category: sp.get('assunto') ?? 'produto', subject: '', message: '', orderNumber: sp.get('pedido') ?? '' });
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrors({});
    if (!accept) { setError('É necessário concordar com a política de privacidade.'); return; }
    setSending(true);
    try {
      const r = await api.post<{ number: string; token: string }>('/api/support/tickets', { ...v, phone: v.phone || null, orderNumber: v.orderNumber || null, acceptPrivacy: true });
      navigate(`/atendimento/${r.number}?acesso=${encodeURIComponent(r.token)}&novo=1`);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      setSending(false);
    }
  };
  return (
    <div className="doc container">
      <Breadcrumbs items={[{ name: 'Início', href: '/' }, { name: 'Atendimento', href: '/atendimento' }]} />
      <header className="doc__head"><p className="eyebrow">Fale com a GAZU</p><h1>Atendimento</h1></header>
      <div className="service">
        <div className="service__channels">
          <h2>Canais</h2>
          <ul className="contact-list">
            {wa ? <li><strong>WhatsApp</strong><a href={wa} target="_blank" rel="noopener noreferrer" className="link-underline"><Icon name="whatsapp" size={16} /> {c.whatsapp}</a></li> : null}
            {c.email ? <li><strong>E-mail</strong><a href={`mailto:${c.email}`}>{c.email}</a></li> : null}
            {c.phone ? <li><strong>Telefone</strong><span>{c.phone}</span></li> : null}
            {c.serviceHours ? <li><strong>Horário</strong><span>{c.serviceHours}</span></li> : null}
          </ul>
          {!wa && !c.email && !c.phone ? <Notice tone="warning">Os canais de contato (e-mail, telefone e WhatsApp) ainda não foram configurados pela loja. Use o formulário ao lado.</Notice> : null}
          <h2>Antes de escrever</h2>
          <ul className="service__links">
            <li><Link to="/ajuda" className="link-underline">Central de ajuda (perguntas frequentes)</Link></li>
            <li><Link to="/rastreio" className="link-underline">Rastrear pedido</Link></li>
            <li><Link to="/trocas-e-devolucoes" className="link-underline">Trocas e devoluções</Link></li>
            {user ? <li><Link to="/conta/atendimento" className="link-underline">Meus atendimentos</Link></li> : null}
          </ul>
        </div>
        <form className="panel form-stack service__form" onSubmit={submit} noValidate>
          <h2>Envie sua mensagem</h2>
          <p className="muted small">Você recebe a confirmação e as respostas por e-mail, com um link para acompanhar o atendimento.</p>
          <div className="form-grid">
            <Field label="Nome" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} required autoComplete="name" />
            <Field label="E-mail" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={errors.email} required autoComplete="email" disabled={Boolean(user)} />
            <Field label="Telefone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} optional autoComplete="tel" inputMode="tel" />
            <SelectField label="Assunto" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
              {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
            <Field label="Número do pedido" value={v.orderNumber} onChange={(e) => setV({ ...v, orderNumber: e.target.value.toUpperCase() })} optional placeholder="GZ100001" maxLength={20} />
            <Field label="Título" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} error={errors.subject} required maxLength={140} />
          </div>
          <TextareaField label="Mensagem" value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} error={errors.message} required maxLength={4000} rows={6} />
          <Checkbox checked={accept} onChange={setAccept} label={<>Concordo com o uso dos meus dados para este atendimento, conforme a <Link to="/politica-de-privacidade" className="link-underline">Política de privacidade</Link>.</>} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button loading={sending}>Enviar mensagem</Button>
        </form>
      </div>
    </div>
  );
}

export function TicketPage({ number }: { number: string }) {
  useDocumentTitle(`Atendimento ${number}`);
  const [sp] = useSearchParams();
  const token = sp.get('acesso');
  const { data, error, loading, reload, setData } = useApi<TicketDTO>(`/api/support/tickets/${encodeURIComponent(number)}${token ? `?acesso=${encodeURIComponent(token)}` : ''}`);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const { notify } = useStore();
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!msg.trim()) return;
    setSending(true);
    try { setData(await api.post<TicketDTO>(`/api/support/tickets/${encodeURIComponent(number)}/messages`, { body: msg, token })); setMsg(''); } catch (err) { notify(errorMessage(err), 'error'); } finally { setSending(false); }
  };
  return (
    <div className="doc container">
      <Breadcrumbs items={[{ name: 'Atendimento', href: '/atendimento' }, { name: number, href: '#' }]} />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : data ? (
        <>
          <header className="doc__head">
            <p className="eyebrow">Atendimento {data.number} · {TICKET_CATEGORY_LABEL[data.category]}</p>
            <h1>{data.subject}</h1>
            <p><span className={`status status--t-${data.status}`}>{TICKET_STATUS_LABEL[data.status]}</span>{data.orderNumber ? <> · Pedido {data.orderNumber}</> : null}</p>
          </header>
          {sp.get('novo') ? <Notice tone="success" title="Mensagem enviada">Recebemos sua mensagem. Guarde o e-mail de confirmação: o link dele dá acesso a este atendimento.</Notice> : null}
          <ol className="thread">
            {data.messages.map((m) => (
              <li key={m.id} className={`thread__msg thread__msg--${m.authorType}`}>
                <p className="thread__meta"><strong>{m.authorType === 'customer' ? 'Você' : m.authorName}</strong> · {formatDateTime(m.createdAt)}{m.channel === 'whatsapp' ? ' · WhatsApp' : ''}</p>
                <p className="thread__body">{m.body}</p>
              </li>
            ))}
          </ol>
          {data.status !== 'closed' ? (
            <form className="form-stack thread__reply" onSubmit={send}>
              <TextareaField label="Responder" value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} maxLength={4000} />
              <Button loading={sending} disabled={!msg.trim()}>Enviar resposta</Button>
            </form>
          ) : <Notice tone="info">Atendimento encerrado. Se precisar, <Link to="/atendimento" className="link-underline">abra um novo</Link>.</Notice>}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Rastreio público (número do pedido + e-mail da compra)
// ---------------------------------------------------------------------------------------------
interface PublicTracking {
  number: string; status: OrderDTO['status']; createdAt: string; shippingLabel: string; shippingDaysText: string | null; isDemo: boolean; destination: string; itemsCount: number;
  shipments: { status: string; carrier: string | null; trackingCode: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null; events: { status: string; description: string; location: string | null; occurredAt: string }[] }[];
  timeline: { type: string; message: string; createdAt: string }[];
}

export function TrackOrderPage() {
  useDocumentTitle('Rastrear pedido');
  const [sp] = useSearchParams();
  const { user } = useStore();
  const [number, setNumber] = useState(sp.get('pedido') ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [state, setState] = useState<{ loading: boolean; data: PublicTracking | null; error: string | null }>({ loading: false, data: null, error: null });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState({ loading: true, data: null, error: null });
    try { setState({ loading: false, data: await api.post<PublicTracking>('/api/orders/track', { number: number.trim().toUpperCase(), email: email.trim() }), error: null }); } catch (err) { setState({ loading: false, data: null, error: errorMessage(err) }); }
  };
  const d = state.data;
  return (
    <div className="doc container">
      <Breadcrumbs items={[{ name: 'Início', href: '/' }, { name: 'Rastrear pedido', href: '/rastreio' }]} />
      <header className="doc__head"><p className="eyebrow">Acompanhe sua entrega</p><h1>Rastrear pedido</h1></header>
      <form className="track-form" onSubmit={submit}>
        <Field label="Número do pedido" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="GZ100001" maxLength={20} required />
        <Field label="E-mail usado na compra" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <Button loading={state.loading}>Rastrear</Button>
      </form>
      <p className="muted small">Por segurança, mostramos apenas o andamento e a cidade de destino. Os detalhes completos ficam em <Link to="/conta/pedidos" className="link-underline">Meus pedidos</Link> ou no link do e-mail da compra.</p>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {d ? (
        <section className="track-result" aria-live="polite">
          <h2>Pedido {d.number}</h2>
          <p><span className={`status status--${d.status}`}>{ORDER_STATUS_LABEL[d.status]}</span> · {d.itemsCount} {d.itemsCount === 1 ? 'item' : 'itens'} · destino {d.destination}</p>
          <p className="muted">{d.shippingLabel}{d.shippingDaysText ? ` · ${d.shippingDaysText}` : ''}{d.isDemo ? ' · pedido de demonstração' : ''}</p>
          {d.shipments.length ? d.shipments.map((s, i) => (
            <div key={i} className="order-block">
              <p><strong>{SHIPMENT_STATUS_LABEL[s.status] ?? s.status}</strong>{s.carrier ? ` · ${s.carrier}` : ''}{s.trackingCode ? <> · código <strong>{s.trackingCode}</strong></> : null}</p>
              {s.trackingUrl ? <p><a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="link-underline">Ver no site da transportadora <Icon name="external" size={14} /></a></p> : null}
              <ol className="timeline">{[...s.events].reverse().map((e, j) => <li key={j}><time>{formatDateTime(e.occurredAt)}</time><span>{e.description}{e.location ? ` — ${e.location}` : ''}</span></li>)}</ol>
            </div>
          )) : <p className="muted">O envio ainda não foi registrado. O código de rastreio aparece aqui quando o pedido sair para entrega.</p>}
          <h3>Histórico do pedido</h3>
          <ol className="timeline">{[...d.timeline].reverse().map((e, i) => <li key={i}><time>{formatDateTime(e.createdAt)}</time><span>{e.message}</span></li>)}</ol>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pedido de visitante (link do e-mail ou cookie do navegador)
// ---------------------------------------------------------------------------------------------
export function GuestOrderPage({ number }: { number: string }) {
  useDocumentTitle(`Pedido ${number}`);
  const [sp] = useSearchParams();
  const { navigate } = useRouter();
  const token = sp.get('acesso');
  const [order, setOrder] = useState<OrderDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      if (token) {
        const o = await api.post<OrderDTO>('/api/orders/guest-access', { number, token });
        setOrder(o);
        navigate(`/pedido/${encodeURIComponent(number)}`, { replace: true, scroll: false }); // remove o token da barra de endereço
      } else {
        setOrder(await api.get<OrderDTO>(`/api/orders/${encodeURIComponent(number)}`));
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [number, token, navigate]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="container checkout-result">
      {error ? (
        <>
          <ErrorState message={error} onRetry={() => void load()} />
          <p className="muted small center">Use o link do e-mail de confirmação do pedido ou <Link to={`/rastreio?pedido=${encodeURIComponent(number)}`} className="link-underline">rastreie com o e-mail da compra</Link>.</p>
        </>
      ) : !order ? <Loading /> : <OrderView order={order} onOrder={setOrder} showPayment />}
    </div>
  );
}
