import { useEffect, useRef, type ReactNode } from 'react';
import { matchPath, useRouter } from './lib/router';
import { useStore } from './lib/store';
import { AnnouncementBar, Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { CartDrawer } from './components/layout/CartDrawer';
import { SearchOverlay } from './components/layout/SearchOverlay';
import { Toasts } from './components/ui/ui';
import { HomePage } from './pages/Home';
import { CatalogPage } from './pages/Catalog';
import { ProductPage } from './pages/Product';
import { CartPage } from './pages/Cart';
import { CheckoutPage } from './pages/Checkout';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/Auth';
import { AccountOverviewPage, AddressesPage, FavoritesPage, OrderDetailPage, OrdersPage, RequireAuth, SecurityPage } from './pages/Account';
import { DeliveryPage, NotFoundPage, PrivacyPage, ReturnsPage, ServicePage, TermsPage, TrackOrderPage } from './pages/Static';
import { AdminApp } from './pages/admin/Admin';

type Route = { pattern: string; render: (p: Record<string, string>) => ReactNode; chrome?: 'full' | 'minimal' | 'admin' };

const ROUTES: Route[] = [
  { pattern: '/', render: () => <HomePage /> },
  { pattern: '/categoria/:slug', render: (p) => <CatalogPage key={p.slug} category={p.slug} /> },
  { pattern: '/produto/:slug', render: (p) => <ProductPage key={p.slug} slug={p.slug!} /> },
  { pattern: '/busca', render: () => <CatalogPage search /> },
  { pattern: '/carrinho', render: () => <CartPage /> },
  { pattern: '/checkout', render: () => <CheckoutPage />, chrome: 'minimal' },
  { pattern: '/checkout/pedido/:number', render: (p) => <RequireAuth><OrderDetailPage number={p.number!} checkout /></RequireAuth>, chrome: 'minimal' },
  { pattern: '/entrar', render: () => <LoginPage /> },
  { pattern: '/cadastro', render: () => <RegisterPage /> },
  { pattern: '/recuperar-senha', render: () => <ForgotPasswordPage /> },
  { pattern: '/redefinir-senha', render: () => <ResetPasswordPage /> },
  { pattern: '/conta', render: () => <RequireAuth><AccountOverviewPage /></RequireAuth> },
  { pattern: '/conta/pedidos', render: () => <RequireAuth><OrdersPage /></RequireAuth> },
  { pattern: '/conta/pedidos/:number', render: (p) => <RequireAuth><OrderDetailPage key={p.number} number={p.number!} /></RequireAuth> },
  { pattern: '/conta/enderecos', render: () => <RequireAuth><AddressesPage /></RequireAuth> },
  { pattern: '/conta/seguranca', render: () => <RequireAuth><SecurityPage /></RequireAuth> },
  { pattern: '/favoritos', render: () => <FavoritesPage /> },
  { pattern: '/politica-de-privacidade', render: () => <PrivacyPage /> },
  { pattern: '/termos-de-uso', render: () => <TermsPage /> },
  { pattern: '/trocas-e-devolucoes', render: () => <ReturnsPage /> },
  { pattern: '/entrega', render: () => <DeliveryPage /> },
  { pattern: '/atendimento', render: () => <ServicePage /> },
  { pattern: '/rastrear-pedido', render: () => <TrackOrderPage /> },
];

function resolve(pathname: string): { node: ReactNode; chrome: Route['chrome'] } {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return { node: <RequireAuth admin><AdminApp /></RequireAuth>, chrome: 'admin' };
  }
  for (const r of ROUTES) {
    const params = matchPath(r.pattern, pathname);
    if (params) return { node: r.render(params), chrome: r.chrome ?? 'full' };
  }
  return { node: <NotFoundPage />, chrome: 'full' };
}

export function App() {
  const { location } = useRouter();
  const { config } = useStore();
  const { node, chrome } = resolve(location.pathname);
  const main = useRef<HTMLElement | null>(null);
  const first = useRef(true);

  // Foco no conteúdo principal a cada navegação (leitores de tela anunciam a nova página).
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    main.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const isHome = location.pathname === '/';

  return (
    <>
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      {chrome === 'full' ? <AnnouncementBar /> : null}
      {chrome === 'admin' ? null : <Header minimal={chrome === 'minimal'} transparent={isHome} />}
      {config.demoMode && chrome !== 'admin' && !isHome ? <p className="demo-banner">{config.standalone?.notice ?? 'Ambiente de demonstração — produtos, preços e estoques ilustrativos.'}</p> : null}
      <main id="conteudo" ref={main} tabIndex={-1} className={`page page--${chrome}`} key={chrome === 'admin' ? 'admin' : location.pathname}>
        {node}
      </main>
      {chrome === 'full' ? <Footer /> : null}
      <CartDrawer />
      <SearchOverlay />
      <Toasts />
    </>
  );
}
