import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { Link, useRouter, useSearchParams } from '../lib/router';
import { useStore } from '../lib/store';
import { formatCep, formatDate, formatDateTime, formatPrice, TICKET_STATUS_LABEL } from '../../shared/format';
import type { AddressDTO, OrderDTO, ProductCardDTO } from '../../shared/types';
import { AddressForm, emptyAddress, validateAddress, type AddressValues } from '../components/checkout/AddressForm';
import { OrderView, StatusBadge } from '../components/account/OrderView';
import { ProductGrid } from '../components/catalog/ProductCard';
import { Icon } from '../components/ui/Icon';
import { Breadcrumbs, Button, ButtonLink, Checkbox, Dialog, EmptyState, ErrorState, Field, Loading, Notice, TextareaField } from '../components/ui/ui';
import { RecentlyViewed, openCookiePreferences } from '../components/content/Editorial';
import { getConsent } from '../lib/analytics';

/** Garante sessão para páginas privadas (a autorização real é feita no servidor). */
export function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, userLoaded } = useStore();
  const { navigate, location } = useRouter();
  useEffect(() => {
    if (userLoaded && !user) navigate(`/entrar?returnTo=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
  }, [userLoaded, user, navigate, location.pathname, location.search]);
  if (!userLoaded || !user) return <div className="container page-pad"><Loading /></div>;
  if (admin && user.role !== 'admin') return <div className="container page-pad"><Notice tone="error" title="Acesso restrito">Esta área é exclusiva para administradores.</Notice></div>;
  return <>{children}</>;
}

const NAV = [
  { href: '/conta', label: 'Visão geral', icon: 'user' as const },
  { href: '/conta/pedidos', label: 'Pedidos', icon: 'bag' as const },
  { href: '/conta/enderecos', label: 'Endereços', icon: 'truck' as const },
  { href: '/favoritos', label: 'Favoritos', icon: 'heart' as const },
  { href: '/conta/atendimento', label: 'Atendimento', icon: 'chat' as const },
  { href: '/conta/privacidade', label: 'Privacidade', icon: 'shield' as const },
  { href: '/conta/seguranca', label: 'Segurança', icon: 'lock' as const },
];

function AccountShell({ title, children }: { title: string; children: ReactNode }) {
  const { user, logout } = useStore();
  const { location, navigate } = useRouter();
  useDocumentTitle(title);
  return (
    <div className="account container">
      <Breadcrumbs items={[{ name: 'Início', href: '/' }, { name: 'Minha conta', href: '/conta' }, ...(title !== 'Minha conta' ? [{ name: title, href: location.pathname }] : [])]} />
      <div className="account__layout">
        <nav className="account__nav" aria-label="Minha conta">
          <p className="account__hello">Olá, <strong>{user?.name?.split(' ')[0] || 'cliente'}</strong></p>
          <ul>
            {NAV.map((n) => <li key={n.href}><Link to={n.href} className={location.pathname === n.href ? 'is-active' : ''} aria-current={location.pathname === n.href ? 'page' : undefined}><Icon name={n.icon} size={18} /> {n.label}</Link></li>)}
            {user?.role === 'admin' ? <li><Link to="/admin"><Icon name="grid" size={18} /> Painel administrativo</Link></li> : null}
            <li><button onClick={() => { void logout().then(() => navigate('/')); }}><Icon name="logout" size={18} /> Sair</button></li>
          </ul>
        </nav>
        <div className="account__main">
          <h1 className="page-title">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

function OrdersList({ orders }: { orders: OrderDTO[] }) {
  if (!orders.length) return <EmptyState title="Você ainda não fez pedidos" action={<ButtonLink to="/categoria/novidades" variant="secondary" size="sm">Começar a comprar</ButtonLink>} />;
  return (
    <ul className="orders-list">
      {orders.map((o) => (
        <li key={o.id}>
          <Link to={`/conta/pedidos/${o.number}`} className="orders-list__item">
            <span className="orders-list__imgs">{o.items.slice(0, 3).map((i) => (i.imageUrl ? <img key={i.sku} src={i.imageUrl} alt="" /> : null))}</span>
            <span className="orders-list__meta"><strong>{o.number}</strong><small>{formatDate(o.createdAt)} · {o.items.reduce((s, i) => s + i.quantity, 0)} itens</small></span>
            <StatusBadge status={o.status} />
            <span className="orders-list__total">{formatPrice(o.totalCents)}</span>
            <Icon name="chevronRight" size={18} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AccountOverviewPage() {
  const { user, refreshUser, notify } = useStore();
  const [sp] = useSearchParams();
  const profile = useApi<{ name: string; phone: string; email: string }>('/api/account/profile');
  const orders = useApi<{ orders: OrderDTO[] }>('/api/account/orders');
  const [form, setForm] = useState({ name: '', phone: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (profile.data) setForm({ name: profile.data.name, phone: profile.data.phone ?? '' }); }, [profile.data]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await api.put('/api/account/profile', { name: form.name, phone: form.phone || null }); await refreshUser(); notify('Dados atualizados.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } finally { setSaving(false); }
  };
  const resend = async () => { try { await api.post('/api/auth/resend-verification'); notify('Enviamos um novo link de confirmação.', 'success'); } catch (e) { notify(errorMessage(e), 'error'); } };
  const verified = sp.get('email');
  return (
    <AccountShell title="Minha conta">
      {verified === 'verificado' ? <Notice tone="success">E-mail confirmado com sucesso.</Notice> : verified === 'link-invalido' ? <Notice tone="error">Link de confirmação inválido ou expirado.</Notice> : null}
      {user && !user.emailVerified ? <Notice tone="warning" title="Confirme seu e-mail">Enviamos um link para {user.email}. <button className="link-btn" onClick={() => void resend()}>Reenviar</button></Notice> : null}
      <div className="account-grid">
        <section className="panel">
          <h2>Dados pessoais</h2>
          {profile.loading ? <Loading inline /> : profile.error ? <ErrorState message={profile.error} onRetry={profile.reload} /> : (
            <form className="form-stack" onSubmit={save}>
              <Field label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="name" />
              <Field label="E-mail" value={profile.data?.email ?? ''} disabled hint="Para alterar o e-mail, fale com o atendimento." />
              <Field label="Telefone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} optional autoComplete="tel" inputMode="tel" />
              <Button loading={saving}>Salvar</Button>
            </form>
          )}
        </section>
        <section className="panel">
          <div className="panel__head"><h2>Últimos pedidos</h2><Link to="/conta/pedidos" className="link-underline">Ver todos</Link></div>
          {orders.loading ? <Loading inline /> : orders.error ? <ErrorState message={orders.error} onRetry={orders.reload} /> : <OrdersList orders={(orders.data?.orders ?? []).slice(0, 3)} />}
        </section>
      </div>
    </AccountShell>
  );
}

export function OrdersPage() {
  const orders = useApi<{ orders: OrderDTO[] }>('/api/account/orders');
  return (
    <AccountShell title="Pedidos">
      {orders.loading ? <Loading /> : orders.error ? <ErrorState message={orders.error} onRetry={orders.reload} /> : <OrdersList orders={orders.data?.orders ?? []} />}
    </AccountShell>
  );
}

export function OrderDetailPage({ number, checkout }: { number: string; checkout?: boolean }) {
  const { data, error, loading, reload, setData } = useApi<OrderDTO>(`/api/account/orders/${encodeURIComponent(number)}`);
  useDocumentTitle(`Pedido ${number}`);
  const onOrder = useCallback((o: OrderDTO) => setData(o), [setData]);
  const body = loading && !data ? <Loading /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : data ? <OrderView order={data} onOrder={onOrder} showPayment /> : null;
  if (checkout) return <div className="container checkout-result">{body}</div>;
  return <div className="container account-order"><Breadcrumbs items={[{ name: 'Minha conta', href: '/conta' }, { name: 'Pedidos', href: '/conta/pedidos' }, { name: number, href: '#' }]} />{body}</div>;
}

export function AddressesPage() {
  const { notify, user } = useStore();
  const { data, error, loading, reload, setData } = useApi<{ addresses: AddressDTO[] }>('/api/account/addresses');
  const [editing, setEditing] = useState<{ id: number | null; value: AddressValues } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const errs = validateAddress(editing.value);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const body = { ...editing.value, complement: editing.value.complement || null };
      const r = editing.id ? await api.put<{ addresses: AddressDTO[] }>(`/api/account/addresses/${editing.id}`, body) : await api.post<{ addresses: AddressDTO[] }>('/api/account/addresses', body);
      setData({ addresses: r.addresses });
      setEditing(null);
      notify('Endereço salvo.', 'success');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      notify(errorMessage(err), 'error');
    } finally { setSaving(false); }
  };
  const remove = async (id: number) => {
    if (!window.confirm('Excluir este endereço?')) return;
    try { const r = await api.del<{ addresses: AddressDTO[] }>(`/api/account/addresses/${id}`); setData({ addresses: r.addresses }); notify('Endereço excluído.', 'info'); } catch (err) { notify(errorMessage(err), 'error'); }
  };
  return (
    <AccountShell title="Endereços">
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <>
          {data?.addresses.length ? (
            <ul className="addr-cards">
              {data.addresses.map((a) => (
                <li key={a.id} className="addr-card">
                  <p><strong>{a.label}</strong>{a.isDefault ? <span className="tag">Principal</span> : null}</p>
                  <p>{a.recipient}<br />{a.street}, {a.number}{a.complement ? ` — ${a.complement}` : ''}<br />{a.district} · {a.city}/{a.state}<br />{formatCep(a.cep)}</p>
                  <div className="addr-card__actions">
                    <button className="link-btn" onClick={() => { setErrors({}); setEditing({ id: a.id, value: { label: a.label, recipient: a.recipient, cep: a.cep, street: a.street, number: a.number, complement: a.complement ?? '', district: a.district, city: a.city, state: a.state, isDefault: a.isDefault } }); }}><Icon name="edit" size={16} /> Editar</button>
                    <button className="link-btn" onClick={() => void remove(a.id)}><Icon name="trash" size={16} /> Excluir</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Nenhum endereço salvo" text="Cadastre um endereço para agilizar suas compras." />}
          <Button variant="secondary" icon="plus" onClick={() => { setErrors({}); setEditing({ id: null, value: emptyAddress(user?.name ?? '') }); }}>Novo endereço</Button>
        </>
      )}
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'Editar endereço' : 'Novo endereço'}>
        {editing ? (
          <form className="dialog__body" onSubmit={save} noValidate>
            <AddressForm value={editing.value} onChange={(v) => setEditing({ ...editing, value: v })} errors={errors} showDefault />
            <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={saving}>Salvar endereço</Button></div>
          </form>
        ) : null}
      </Dialog>
    </AccountShell>
  );
}

export function SecurityPage() {
  const { user, notify } = useStore();
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (v.next !== v.confirm) { setErrors({ confirm: 'As senhas não conferem.' }); return; }
    setSaving(true);
    setErrors({});
    try {
      await api.post('/api/auth/change-password', { currentPassword: v.current || undefined, newPassword: v.next });
      setV({ current: '', next: '', confirm: '' });
      notify('Senha alterada. Outras sessões foram encerradas.', 'success');
    } catch (err) {
      if (err instanceof ApiError) setErrors({ current: err.fieldErrors.currentPassword ?? '', next: err.fieldErrors.newPassword ?? '' });
      notify(errorMessage(err), 'error');
    } finally { setSaving(false); }
  };
  return (
    <AccountShell title="Segurança">
      <section className="panel narrow">
        <h2>{user?.hasPassword ? 'Alterar senha' : 'Definir senha'}</h2>
        {!user?.hasPassword ? <p className="muted">Sua conta usa login com Google. Você pode definir uma senha para entrar também com e-mail.</p> : null}
        <form className="form-stack" onSubmit={submit}>
          {user?.hasPassword ? <Field label="Senha atual" type="password" autoComplete="current-password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} error={errors.current || undefined} required /> : null}
          <Field label="Nova senha" type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} error={errors.next || undefined} hint="Mínimo de 8 caracteres, com letras e números." required />
          <Field label="Confirmar nova senha" type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} error={errors.confirm} required />
          <Button loading={saving}>Salvar senha</Button>
        </form>
        <p className="muted small">Login com Google: {user?.googleLinked ? 'vinculado' : 'não vinculado'}.</p>
      </section>
    </AccountShell>
  );
}

export function FavoritesPage() {
  useDocumentTitle('Favoritos');
  const { favorites, user } = useStore();
  const [items, setItems] = useState<ProductCardDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    api.post<{ items: ProductCardDTO[] }>('/api/products/lookup', { ids: favorites })
      .then((r) => { if (alive) setItems(r.items); })
      .catch((e: unknown) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [favorites, nonce]);
  return (
    <div className="container favorites">
      <Breadcrumbs items={[{ name: 'Início', href: '/' }, { name: 'Favoritos', href: '/favoritos' }]} />
      <h1 className="page-title">Favoritos</h1>
      {!user ? <p className="muted">Seus favoritos ficam salvos neste navegador. <Link to="/entrar?returnTo=/favoritos" className="link-underline">Entre</Link> para guardá-los na sua conta.</p> : null}
      {error ? <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} /> : items === null ? <Loading /> : items.length === 0 ? (
        <EmptyState title="Nenhum favorito ainda" text="Toque no coração dos produtos para salvá-los aqui." action={<ButtonLink to="/categoria/novidades" variant="secondary" size="sm">Ver novidades</ButtonLink>} />
      ) : <ProductGrid products={items} />}
    </div>
  );
}

export function AccountTicketsPage() {
  const { data, error, loading, reload } = useApi<{ tickets: { number: string; subject: string; status: string; category: string; createdAt: string; updatedAt: string }[] }>('/api/account/tickets');
  return (
    <AccountShell title="Atendimento">
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.tickets.length ? (
        <EmptyState title="Nenhum atendimento aberto" text="Dúvidas sobre produtos, pedidos ou trocas? Fale com a gente." action={<ButtonLink to="/atendimento" variant="secondary" size="sm">Abrir atendimento</ButtonLink>} />
      ) : (
        <>
          <ul className="orders-list">
            {data.tickets.map((t) => (
              <li key={t.number}>
                <Link to={`/atendimento/${t.number}`} className="orders-list__item">
                  <span className="orders-list__meta"><strong>{t.number} · {t.subject}</strong><small>Atualizado em {formatDateTime(t.updatedAt)}</small></span>
                  <span className={`status status--t-${t.status}`}>{TICKET_STATUS_LABEL[t.status] ?? t.status}</span>
                  <Icon name="chevronRight" size={18} />
                </Link>
              </li>
            ))}
          </ul>
          <ButtonLink to="/atendimento" variant="secondary" size="sm">Novo atendimento</ButtonLink>
        </>
      )}
    </AccountShell>
  );
}

interface PrivacyInfo { marketingOptIn: boolean; newsletter: string | null; analytics: { granted: boolean; at: string } | null; requests: { id: number; type: string; status: string; createdAt: string; completedAt: string | null }[] }

export function AccountPrivacyPage() {
  const { notify } = useStore();
  const { data, error, loading, reload, setData } = useApi<PrivacyInfo>('/api/account/privacy');
  const [deletion, setDeletion] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const consent = getConsent();
  const setMarketing = async (optIn: boolean) => {
    try { await api.put('/api/account/marketing', { optIn }); if (data) setData({ ...data, marketingOptIn: optIn, newsletter: optIn ? data.newsletter : data.newsletter ? 'unsubscribed' : null }); notify(optIn ? 'Comunicações de marketing autorizadas.' : 'Você não receberá mais e-mails de marketing.', 'success'); } catch (e) { notify(errorMessage(e), 'error'); }
  };
  const requestDeletion = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { const r = await api.post<{ message: string }>('/api/account/privacy/requests', { type: 'deletion', note: note || null }); notify(r.message, 'success'); setDeletion(false); reload(); } catch (err) { notify(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  const TYPE: Record<string, string> = { export: 'Cópia dos dados', deletion: 'Exclusão da conta', correction: 'Correção de dados' };
  const STATUS: Record<string, string> = { requested: 'Recebida', in_review: 'Em análise', completed: 'Concluída', rejected: 'Recusada' };
  return (
    <AccountShell title="Privacidade">
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data ? (
        <div className="account-grid">
          <section className="panel">
            <h2>Comunicações</h2>
            <Checkbox checked={data.marketingOptIn} onChange={(v) => void setMarketing(v)} label="Quero receber novidades, lançamentos e lembretes de carrinho por e-mail" />
            <p className="muted small">E-mails sobre seus pedidos (confirmação, pagamento, envio) são sempre enviados, pois fazem parte da compra.</p>
            <h2>Cookies de análise</h2>
            <p className="muted small">Neste navegador: {consent ? (consent.analytics ? 'permitidos' : 'somente essenciais') : 'ainda sem escolha'}.</p>
            <Button variant="secondary" size="sm" onClick={openCookiePreferences}>Alterar preferência</Button>
          </section>
          <section className="panel">
            <h2>Seus dados (LGPD)</h2>
            <p className="muted small">Você pode baixar uma cópia dos dados pessoais que mantemos sobre você ou pedir a exclusão da conta.</p>
            <div className="btn-row">
              <a className="btn btn--secondary btn--sm" href="/api/account/privacy/export" download><span className="btn__label">Baixar meus dados (JSON)</span><Icon name="download" size={16} /></a>
              <Button variant="ghost" size="sm" onClick={() => setDeletion(true)}>Pedir exclusão da conta</Button>
            </div>
            {data.requests.length ? (
              <ul className="pay-history">
                {data.requests.map((r) => <li key={r.id}><span>{TYPE[r.type] ?? r.type}</span><span className="tag">{STATUS[r.status] ?? r.status}</span><small>{formatDate(r.createdAt)}</small></li>)}
              </ul>
            ) : null}
          </section>
        </div>
      ) : null}
      <Dialog open={deletion} onClose={() => setDeletion(false)} title="Pedir exclusão da conta">
        <form className="dialog__body form-stack" onSubmit={requestDeletion}>
          <p>Ao concluir, sua conta é anonimizada: e-mail, nome, telefone, endereços salvos, favoritos e inscrições são removidos. Pedidos e pagamentos são mantidos pelo prazo exigido pela legislação fiscal, sem vínculo com seus dados de contato.</p>
          <TextareaField label="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
          <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setDeletion(false)}>Cancelar</Button><Button variant="danger" loading={busy}>Confirmar pedido</Button></div>
        </form>
      </Dialog>
    </AccountShell>
  );
}

export function AccountRecentPage() {
  return <AccountShell title="Vistos recentemente"><RecentlyViewed title="Produtos que você viu" /></AccountShell>;
}
