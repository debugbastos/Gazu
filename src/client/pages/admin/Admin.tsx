import type { ReactNode } from 'react';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { Link, matchPath, useRouter } from '../../lib/router';
import { useStore } from '../../lib/store';
import { formatDateTime, formatPrice, ORDER_STATUS_LABEL } from '../../../shared/format';
import { Icon, type IconName } from '../../components/ui/Icon';
import { ErrorState, Loading, Notice } from '../../components/ui/ui';
import { Logo } from '../../components/ui/Logo';
import { AdminProductEdit, AdminProducts } from './AdminProducts';
import { AdminOrderDetail, AdminOrders } from './AdminOrders';
import { AdminCategories, AdminCoupons, AdminCustomers, AdminSettings, AdminShipping } from './AdminMisc';

// Painel administrativo. A autorização real é feita no servidor (requireAdmin em todas as rotas /api/admin);
// esta interface apenas organiza as telas.

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/admin', label: 'Visão geral', icon: 'grid' },
  { href: '/admin/pedidos', label: 'Pedidos', icon: 'bag' },
  { href: '/admin/produtos', label: 'Produtos', icon: 'badge' },
  { href: '/admin/categorias', label: 'Categorias', icon: 'filter' },
  { href: '/admin/cupons', label: 'Cupons', icon: 'returns' },
  { href: '/admin/frete', label: 'Frete', icon: 'truck' },
  { href: '/admin/clientes', label: 'Clientes', icon: 'user' },
  { href: '/admin/configuracoes', label: 'Configurações', icon: 'edit' },
];

export function AdminShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const { location } = useRouter();
  const { user, config } = useStore();
  useDocumentTitle(`${title} — Admin`);
  const active = (href: string) => (href === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(href));
  return (
    <div className="admin">
      <aside className="admin__side">
        <Link to="/admin" className="admin__brand" aria-label="Painel GAZU"><Logo /><span>Painel</span></Link>
        <nav aria-label="Administração">
          <ul>
            {NAV.map((n) => (
              <li key={n.href}><Link to={n.href} className={active(n.href) ? 'is-active' : ''} aria-current={active(n.href) ? 'page' : undefined}><Icon name={n.icon} size={18} /> {n.label}</Link></li>
            ))}
          </ul>
        </nav>
        <div className="admin__foot">
          <p className="small">{user?.email}</p>
          <Link to="/" className="link-btn"><Icon name="external" size={14} /> Ver loja</Link>
        </div>
      </aside>
      <section className="admin__main">
        <header className="admin__head">
          <h1>{title}</h1>
          {actions ? <div className="admin__actions">{actions}</div> : null}
        </header>
        {config.demoMode ? <Notice tone="info">Modo demonstração ativo: produtos, pedidos e pagamentos simulados são marcados como demonstração e não entram na receita.</Notice> : null}
        {children}
      </section>
    </div>
  );
}

interface Dashboard {
  orders: { total: number; pending: number; paid: number; toShip: number };
  revenueCents: number;
  demoOrders: number;
  products: { active: number; demo: number };
  lowStock: { id: number; sku: string; colorName: string; size: string; stock: number; name: string; productId: number }[];
  lowStockCount: number;
  recentOrders: { number: string; status: string; totalCents: number; isDemo: number; createdAt: string }[];
}

function AdminDashboard() {
  const { data, error, loading, reload } = useApi<Dashboard>('/api/admin/dashboard');
  return (
    <AdminShell title="Visão geral">
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data ? (
        <>
          <div className="kpis">
            <div className="kpi"><span>Pedidos reais</span><strong>{data.orders.total}</strong></div>
            <div className="kpi"><span>Aguardando pagamento</span><strong>{data.orders.pending}</strong></div>
            <div className="kpi"><span>Pagos</span><strong>{data.orders.paid}</strong></div>
            <div className="kpi"><span>A enviar</span><strong>{data.orders.toShip}</strong></div>
            <div className="kpi kpi--wide"><span>Receita confirmada</span><strong>{formatPrice(data.revenueCents)}</strong><small>Somente pedidos com pagamento aprovado pelo provedor, sem demonstrações.</small></div>
            <div className="kpi"><span>Produtos ativos</span><strong>{data.products.active}</strong><small>{data.products.demo} de demonstração</small></div>
          </div>
          <div className="admin-grid">
            <section className="admin-card">
              <div className="admin-card__head"><h2>Pedidos recentes</h2><Link to="/admin/pedidos" className="link-underline">Todos</Link></div>
              {data.recentOrders.length === 0 ? <p className="muted">Nenhum pedido registrado ainda.</p> : (
                <table className="admin-table">
                  <thead><tr><th>Pedido</th><th>Status</th><th>Total</th><th>Data</th></tr></thead>
                  <tbody>{data.recentOrders.map((o) => (
                    <tr key={o.number}><td><Link to={`/admin/pedidos/${o.number}`} className="admin-link">{o.number}</Link>{o.isDemo ? <span className="demo-tag">Demo</span> : null}</td><td><span className={`status status--${o.status}`}>{ORDER_STATUS_LABEL[o.status]}</span></td><td>{formatPrice(o.totalCents)}</td><td>{formatDateTime(o.createdAt)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </section>
            <section className="admin-card">
              <div className="admin-card__head"><h2>Estoque baixo ({data.lowStockCount})</h2><Link to="/admin/produtos?status=sem-estoque" className="link-underline">Sem estoque</Link></div>
              {data.lowStock.length === 0 ? <p className="muted">Nenhuma variante com estoque baixo.</p> : (
                <table className="admin-table">
                  <thead><tr><th>Produto</th><th>Variante</th><th>Estoque</th></tr></thead>
                  <tbody>{data.lowStock.map((v) => (
                    <tr key={v.id}><td><Link to={`/admin/produtos/${v.productId}`} className="admin-link">{v.name}</Link></td><td>{v.colorName} · {v.size}<br /><small className="muted">{v.sku}</small></td><td className={v.stock === 0 ? 'is-danger' : 'is-warn'}>{v.stock}</td></tr>
                  ))}</tbody>
                </table>
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
  if (p === '/admin/categorias') return <AdminCategories />;
  if (p === '/admin/cupons') return <AdminCoupons />;
  if (p === '/admin/frete') return <AdminShipping />;
  if (p === '/admin/clientes') return <AdminCustomers />;
  if (p === '/admin/configuracoes') return <AdminSettings />;
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
