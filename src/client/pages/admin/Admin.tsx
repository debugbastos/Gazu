import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { Link, matchPath, useRouter } from '../../lib/router';
import { useStore } from '../../lib/store';
import { formatDateTime, formatPrice, ORDER_STATUS_LABEL } from '../../../shared/format';
import type { FinanceSummaryDTO } from '../../../shared/types';
import { Icon, type IconName } from '../../components/ui/Icon';
import { ErrorState, Loading, Notice } from '../../components/ui/ui';
import { Logo } from '../../components/ui/Logo';
import { AdminProductEdit, AdminProducts } from './AdminProducts';
import { AdminOrderDetail, AdminOrders } from './AdminOrders';
import { AdminCategories, AdminCoupons, AdminCustomers, AdminShipping } from './AdminMisc';
import { AdminSettings } from './AdminSettings';
import { AdminCatalogQuality, AdminContentHub, AdminInventory, AdminReviews } from './AdminContent';
import {
  AdminAnalytics, AdminAudit, AdminBrand, AdminFinance, AdminMarketing, AdminOperations, AdminPrivacy, AdminReturns, AdminShipments, AdminSupport, AdminTeam,
} from './AdminOps';

// Painel administrativo. A autorização real é feita no servidor (requirePermission em cada rota /api/admin);
// esta interface apenas esconde o que a função da pessoa não pode usar.

interface NavItem { href: string; label: string; icon: IconName; perm: string }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Loja', items: [
    { href: '/admin', label: 'Visão geral', icon: 'grid', perm: '' },
    { href: '/admin/pedidos', label: 'Pedidos', icon: 'bag', perm: 'orders.read' },
    { href: '/admin/envios', label: 'Envios', icon: 'truck', perm: 'orders.read' },
    { href: '/admin/trocas', label: 'Trocas e devoluções', icon: 'returns', perm: 'orders.read' },
    { href: '/admin/atendimento', label: 'Atendimento', icon: 'chat', perm: 'support.read' },
    { href: '/admin/clientes', label: 'Clientes', icon: 'user', perm: 'customers.read' },
  ] },
  { group: 'Catálogo', items: [
    { href: '/admin/produtos', label: 'Produtos', icon: 'badge', perm: 'catalog.read' },
    { href: '/admin/categorias', label: 'Categorias', icon: 'filter', perm: 'catalog.read' },
    { href: '/admin/estoque', label: 'Estoque', icon: 'layers', perm: 'catalog.read' },
    { href: '/admin/qualidade', label: 'Qualidade do catálogo', icon: 'alert', perm: 'catalog.read' },
    { href: '/admin/avaliacoes', label: 'Avaliações', icon: 'star', perm: 'catalog.read' },
    { href: '/admin/conteudo/avisos', label: 'Conteúdo e vitrine', icon: 'book', perm: 'content.write' },
  ] },
  { group: 'Gestão', items: [
    { href: '/admin/financeiro', label: 'Financeiro', icon: 'wallet', perm: 'finance.read' },
    { href: '/admin/analytics', label: 'Analytics', icon: 'activity', perm: 'analytics.read' },
    { href: '/admin/marketing', label: 'Marketing', icon: 'sparkle', perm: 'marketing.read' },
    { href: '/admin/cupons', label: 'Cupons', icon: 'tag', perm: 'marketing.read' },
    { href: '/admin/frete', label: 'Frete', icon: 'truck', perm: 'orders.read' },
  ] },
  { group: 'Sistema', items: [
    { href: '/admin/operacao', label: 'Operação', icon: 'shield', perm: 'ops.read' },
    { href: '/admin/auditoria', label: 'Auditoria', icon: 'eye', perm: 'audit.read' },
    { href: '/admin/privacidade', label: 'Privacidade (LGPD)', icon: 'lock', perm: 'customers.privacy' },
    { href: '/admin/equipe', label: 'Equipe', icon: 'user', perm: 'team.manage' },
    { href: '/admin/marca', label: 'Marca', icon: 'edit', perm: '' },
    { href: '/admin/configuracoes', label: 'Configurações', icon: 'edit', perm: 'settings.write' },
  ] },
];

/** Versão HTML de demonstração: só os módulos que funcionam sem servidor aparecem no menu. */
const STANDALONE_NAV = new Set(['/admin', '/admin/pedidos', '/admin/clientes', '/admin/produtos', '/admin/categorias', '/admin/cupons', '/admin/frete']);
const visibleItems = (items: NavItem[], perms: string[], standalone: boolean) => items.filter((n) => (!n.perm || perms.includes(n.perm)) && (!standalone || STANDALONE_NAV.has(n.href)));

export function AdminShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const { location } = useRouter();
  const { user, config } = useStore();
  const [open, setOpen] = useState(false);
  useDocumentTitle(`${title} — Admin`);
  useEffect(() => { setOpen(false); }, [location.pathname]);
  const perms = user?.permissions ?? [];
  const active = (href: string) => (href === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(href.replace(/\/avisos$/, '')));
  return (
    <div className={`admin${open ? ' admin--nav-open' : ''}`}>
      <aside className="admin__side" id="admin-nav">
        <Link to="/admin" className="admin__brand" aria-label="Painel GAZU"><Logo /><span>Painel</span></Link>
        <nav aria-label="Administração">
          {NAV.map((g) => {
            const items = visibleItems(g.items, perms, Boolean(config.standalone));
            if (!items.length) return null;
            return (
              <div key={g.group} className="admin__group">
                <p className="admin__group-label">{g.group}</p>
                <ul>
                  {items.map((n) => (
                    <li key={n.href}><Link to={n.href} className={active(n.href) ? 'is-active' : ''} aria-current={active(n.href) ? 'page' : undefined}><Icon name={n.icon} size={18} /> {n.label}</Link></li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="admin__foot">
          <p className="small">{user?.email}</p>
          {user?.staffRole ? <p className="micro">{ROLE_LABEL[user.staffRole] ?? user.staffRole}</p> : null}
          <Link to="/" className="link-btn"><Icon name="external" size={14} /> Ver loja</Link>
        </div>
      </aside>
      <section className="admin__main">
        <header className="admin__head">
          <button type="button" className="icon-btn admin__menu" aria-label="Abrir menu do painel" aria-expanded={open} aria-controls="admin-nav" onClick={() => setOpen((v) => !v)}><Icon name={open ? 'close' : 'menu'} /></button>
          <h1>{title}</h1>
          {actions ? <div className="admin__actions">{actions}</div> : null}
        </header>
        {config.standalone ? <Notice tone="warning" title="Painel da versão HTML de demonstração">Somente catálogo, pedidos, clientes, cupons e frete funcionam aqui, com dados salvos neste navegador. Financeiro, atendimento, trocas, envios reais, conteúdo, equipe, auditoria e operação exigem a loja completa (servidor).</Notice>
          : config.demoMode ? <Notice tone="info">Modo demonstração ativo: produtos, pedidos e pagamentos simulados são marcados como demonstração e não entram nos relatórios financeiros.</Notice> : null}
        {children}
      </section>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { owner: 'Proprietário(a)', manager: 'Gerente', catalog: 'Catálogo e conteúdo', finance: 'Financeiro', support: 'Atendimento', marketing: 'Marketing' };

interface Dashboard {
  orders: { total: number; pending: number; paid: number; toShip: number };
  revenueCents: number;
  demoOrders: number;
  products: { active: number; demo: number };
  lowStock: { id: number; sku: string; colorName: string; size: string; stock: number; name: string; productId: number }[];
  lowStockCount: number;
  recentOrders: { number: string; status: string; totalCents: number; isDemo: number; createdAt: string }[];
  openTickets: number; pendingReviews: number; openReturns: number; waitlist: number; activeCoupons: number; activeCampaigns: number; unitsSold30d?: number;
}

function FinanceGlance() {
  const [data, setData] = useState<FinanceSummaryDTO | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const from = new Date(Date.now() - 3 * 3600_000 - 29 * 86400_000).toISOString().slice(0, 10);
    api.get<FinanceSummaryDTO>(`/api/admin/finance/summary?de=${from}&ate=${today}`).then(setData).catch(() => setError(true));
  }, []);
  if (error) return null;
  if (!data) return <Loading inline />;
  const m = (v: number | null) => (v == null ? '—' : formatPrice(v));
  return (
    <section className="admin-card">
      <div className="admin-card__head"><h2>Últimos 30 dias</h2><Link to="/admin/financeiro" className="link-underline">Financeiro</Link></div>
      <div className="kpis kpis--compact">
        <div className="kpi"><span>Faturamento bruto</span><strong>{m(data.grossSalesCents)}</strong></div>
        <div className="kpi"><span>Valores pagos</span><strong>{m(data.paidRevenueCents)}</strong></div>
        <div className="kpi"><span>Descontos</span><strong>{m(data.discountsCents)}</strong></div>
        <div className="kpi"><span>Reembolsos</span><strong>{m(data.refundsCents)}</strong></div>
        <div className="kpi"><span>Cancelamentos</span><strong>{data.orders.cancelledCount}</strong></div>
        <div className="kpi"><span>Receita líquida</span><strong>{m(data.netRevenueCents)}</strong></div>
        <div className="kpi"><span>Lucro estimado</span><strong>{m(data.estimatedProfitCents)}</strong>{data.estimatedProfitCents == null ? <small>faltam custos</small> : null}</div>
        <div className="kpi"><span>Ticket médio</span><strong>{m(data.averageTicketCents)}</strong></div>
      </div>
      {data.missing.length ? <p className="muted small">{data.missing[0]}{data.missing.length > 1 ? ` (+${data.missing.length - 1})` : ''}</p> : null}
    </section>
  );
}

function AdminDashboard() {
  const { user, config } = useStore();
  const perms = user?.permissions ?? [];
  const canOrders = perms.includes('orders.read');
  const { data, error, loading, reload } = useApi<Dashboard>(canOrders ? '/api/admin/dashboard' : null);
  if (!canOrders) {
    const items = visibleItems(NAV.flatMap((g) => g.items), perms, Boolean(config.standalone)).filter((n) => n.href !== '/admin');
    return (
      <AdminShell title="Visão geral">
        <p className="muted">Atalhos disponíveis para a sua função:</p>
        <ul className="admin-shortcuts">{items.map((n) => <li key={n.href}><Link to={n.href}><Icon name={n.icon} size={18} /> {n.label}</Link></li>)}</ul>
      </AdminShell>
    );
  }
  return (
    <AdminShell title="Visão geral">
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data ? (
        <>
          <div className="kpis">
            <Link to="/admin/pedidos?status=pending_payment" className="kpi"><span>Aguardando pagamento</span><strong>{data.orders.pending}</strong></Link>
            <Link to="/admin/pedidos?status=paid" className="kpi"><span>A enviar</span><strong>{data.orders.toShip}</strong></Link>
            <Link to="/admin/atendimento" className="kpi"><span>Atendimentos abertos</span><strong>{data.openTickets}</strong></Link>
            <Link to="/admin/trocas" className="kpi"><span>Trocas/devoluções</span><strong>{data.openReturns}</strong></Link>
            <Link to="/admin/avaliacoes" className="kpi"><span>Avaliações a moderar</span><strong>{data.pendingReviews}</strong></Link>
            <Link to="/admin/estoque" className="kpi"><span>Avise-me pendentes</span><strong>{data.waitlist}</strong></Link>
            <div className="kpi"><span>Pedidos reais</span><strong>{data.orders.total}</strong><small>{data.orders.paid} pagos · {data.demoOrders} de demonstração (fora da conta)</small></div>
            <div className="kpi"><span>Produtos vendidos (30 dias)</span><strong>{data.unitsSold30d ?? 0}</strong><small>unidades com pagamento aprovado</small></div>
            <div className="kpi"><span>Produtos ativos</span><strong>{data.products.active}</strong><small>{data.products.demo} de demonstração</small></div>
            <div className="kpi"><span>Cupons / campanhas ativas</span><strong>{data.activeCoupons} / {data.activeCampaigns}</strong></div>
          </div>
          {perms.includes('finance.read') ? <FinanceGlance /> : null}
          <div className="admin-grid">
            <section className="admin-card">
              <div className="admin-card__head"><h2>Pedidos recentes</h2><Link to="/admin/pedidos" className="link-underline">Todos</Link></div>
              {data.recentOrders.length === 0 ? <p className="muted">Nenhum pedido registrado ainda.</p> : (
                <div className="admin-table-wrap"><table className="admin-table">
                  <thead><tr><th>Pedido</th><th>Status</th><th>Total</th><th>Data</th></tr></thead>
                  <tbody>{data.recentOrders.map((o) => (
                    <tr key={o.number}><td><Link to={`/admin/pedidos/${o.number}`} className="admin-link">{o.number}</Link>{o.isDemo ? <span className="demo-tag">Demo</span> : null}</td><td><span className={`status status--${o.status}`}>{ORDER_STATUS_LABEL[o.status]}</span></td><td>{formatPrice(o.totalCents)}</td><td>{formatDateTime(o.createdAt)}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </section>
            <section className="admin-card">
              <div className="admin-card__head"><h2>Estoque baixo ({data.lowStockCount})</h2><Link to="/admin/estoque" className="link-underline">Estoque</Link></div>
              {data.lowStock.length === 0 ? <p className="muted">Nenhuma variante com estoque baixo.</p> : (
                <div className="admin-table-wrap"><table className="admin-table">
                  <thead><tr><th>Produto</th><th>Variante</th><th>Estoque</th></tr></thead>
                  <tbody>{data.lowStock.map((v) => (
                    <tr key={v.id}><td><Link to={`/admin/produtos/${v.productId}`} className="admin-link">{v.name}</Link></td><td>{v.colorName} · {v.size}<br /><small className="muted">{v.sku}</small></td><td className={v.stock === 0 ? 'is-danger' : 'is-warn'}>{v.stock}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </section>
          </div>
        </>
      ) : null}
    </AdminShell>
  );
}

export function AdminApp() {
  const { location } = useRouter();
  const p = location.pathname.replace(/\/$/, '');
  if (p === '/admin') return <AdminDashboard />;
  if (p === '/admin/produtos') return <AdminProducts />;
  const prod = matchPath('/admin/produtos/:id', p);
  if (prod) return <AdminProductEdit key={prod.id} id={prod.id === 'novo' ? null : Number(prod.id)} />;
  if (p === '/admin/pedidos') return <AdminOrders />;
  const ord = matchPath('/admin/pedidos/:number', p);
  if (ord) return <AdminOrderDetail key={ord.number} number={ord.number!} />;
  if (p === '/admin/conteudo') return <AdminContentHub tab="avisos" />;
  const content = matchPath('/admin/conteudo/:tab', p);
  if (content) return <AdminContentHub tab={content.tab!} />;
  const routes: Record<string, () => ReactNode> = {
    '/admin/categorias': () => <AdminCategories />,
    '/admin/cupons': () => <AdminCoupons />,
    '/admin/frete': () => <AdminShipping />,
    '/admin/clientes': () => <AdminCustomers />,
    '/admin/configuracoes': () => <AdminSettings />,
    '/admin/qualidade': () => <AdminCatalogQuality />,
    '/admin/estoque': () => <AdminInventory />,
    '/admin/avaliacoes': () => <AdminReviews />,
    '/admin/trocas': () => <AdminReturns />,
    '/admin/envios': () => <AdminShipments />,
    '/admin/atendimento': () => <AdminSupport />,
    '/admin/financeiro': () => <AdminFinance />,
    '/admin/analytics': () => <AdminAnalytics />,
    '/admin/marketing': () => <AdminMarketing />,
    '/admin/operacao': () => <AdminOperations />,
    '/admin/equipe': () => <AdminTeam />,
    '/admin/auditoria': () => <AdminAudit />,
    '/admin/privacidade': () => <AdminPrivacy />,
    '/admin/marca': () => <AdminBrand />,
  };
  const page = routes[p];
  if (page) return <>{page()}</>;
  return <AdminShell title="Página não encontrada"><p className="muted">Esta seção do painel não existe.</p></AdminShell>;
}

/** Converte "219,90" → 21990 centavos. Retorna null se inválido. */
export function toCents(v: string): number | null {
  const s = v.trim().replace(/\./g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
export const fromCents = (c: number | null | undefined): string => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
/** Converte "2026-10-20T10:00" (input datetime-local) em ISO com fuso, e vice-versa. */
export const toIso = (v: string): string | null => (v ? new Date(v).toISOString() : null);
export const fromIso = (v: string | null | undefined): string => {
  if (!v) return '';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
