import { useEffect, useRef, useState } from 'react';
import { Link, useRouter } from '../../lib/router';
import { useStore } from '../../lib/store';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { Dialog } from '../ui/ui';
import type { CategoryDTO } from '../../../shared/types';

export const NAV_ORDER = ['masculino', 'feminino', 'infantil', 'tenis', 'acessorios'];

export function AnnouncementBar() {
  const { config } = useStore();
  const msgs = config.settings.announcements;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (msgs.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % msgs.length), 5000);
    return () => window.clearInterval(t);
  }, [msgs.length]);
  return (
    <div className="announcement" role="region" aria-label="Avisos da loja">
      <div className="announcement__inner">
        <p className="announcement__msg" aria-live="off">{msgs[i] ?? ''}</p>
        <nav className="announcement__links" aria-label="Atalhos">
          <Link to="/rastrear-pedido">Rastrear pedido</Link>
          <span aria-hidden="true">|</span>
          <Link to="/atendimento">Atendimento</Link>
        </nav>
      </div>
    </div>
  );
}

function MegaMenu({ cat, onNavigate }: { cat: CategoryDTO; onNavigate: () => void }) {
  return (
    <div className="mega" role="group" aria-label={cat.name}>
      <div className="mega__inner">
        <div className="mega__col">
          <p className="eyebrow">{cat.name}</p>
          <ul>
            <li><Link to={`/categoria/${cat.slug}`} onClick={onNavigate}>Ver tudo em {cat.name}</Link></li>
            {(cat.children ?? []).filter((c) => (c.productCount ?? 0) > 0).map((c) => (
              <li key={c.id}><Link to={`/categoria/${c.slug}`} onClick={onNavigate}>{c.name}</Link></li>
            ))}
          </ul>
        </div>
        {cat.imageUrl ? (
          <Link to={`/categoria/${cat.slug}`} className="mega__feature" onClick={onNavigate} tabIndex={-1}>
            <img src={cat.imageUrl} alt="" loading="lazy" />
            <span>{cat.description}</span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function Header({ minimal, transparent }: { minimal?: boolean; transparent?: boolean }) {
  const { config, user, cartCount, setCartOpen, setSearchOpen, favorites } = useStore();
  const { location } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const cats = NAV_ORDER.map((s) => config.categories.find((c) => c.slug === s)).filter((c): c is CategoryDTO => Boolean(c));

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => { setOpenCat(null); setMenuOpen(false); }, [location.pathname]);

  const enter = (slug: string) => { if (closeTimer.current) window.clearTimeout(closeTimer.current); setOpenCat(slug); };
  const leave = () => { closeTimer.current = window.setTimeout(() => setOpenCat(null), 140); };
  const active = (slug: string) => location.pathname === `/categoria/${slug}` || location.pathname.startsWith(`/categoria/${slug}-`);

  if (minimal) {
    return (
      <header className="site-header site-header--minimal">
        <div className="site-header__inner">
          <Link to="/carrinho" className="site-header__back"><Icon name="arrowLeft" size={16} /> <span>Sacola</span></Link>
          <Link to="/" className="site-header__logo" aria-label="GAZU — página inicial"><Logo /></Link>
          <span className="site-header__secure"><Icon name="lock" size={16} /> <span>Compra segura</span></span>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className={`site-header${scrolled ? ' is-scrolled' : ''}${transparent ? ' site-header--over' : ''}${openCat ? ' has-mega' : ''}`}>
        <div className="site-header__inner">
          <button className="icon-btn site-header__burger" onClick={() => setMenuOpen(true)} aria-label="Abrir menu" aria-expanded={menuOpen}>
            <Icon name="menu" size={22} />
          </button>
          <nav className="site-nav" aria-label="Categorias" onMouseLeave={leave}>
            <ul>
              <li><Link to="/categoria/novidades" className={location.pathname === '/categoria/novidades' ? 'is-active' : ''}>Novidades</Link></li>
              {cats.map((c) => (
                <li key={c.slug} onMouseEnter={() => enter(c.slug)} onFocus={() => enter(c.slug)}>
                  <Link to={`/categoria/${c.slug}`} className={active(c.slug) ? 'is-active' : ''} aria-haspopup="true" aria-expanded={openCat === c.slug}
                    onKeyDown={(e) => { if (e.key === 'Escape') setOpenCat(null); }}>
                    {c.name}
                  </Link>
                  {openCat === c.slug ? <MegaMenu cat={c} onNavigate={() => setOpenCat(null)} /> : null}
                </li>
              ))}
            </ul>
          </nav>
          <Link to="/" className="site-header__logo" aria-label="GAZU — página inicial"><Logo /></Link>
          <div className="site-actions">
            <button className="action" onClick={() => setSearchOpen(true)} aria-label="Buscar produtos">
              <Icon name="search" /><span className="action__label">Buscar</span>
            </button>
            <Link to={user ? (user.role === 'admin' ? '/conta' : '/conta') : '/entrar'} className="action action--account" aria-label={user ? 'Minha conta' : 'Entrar'}>
              <Icon name="user" /><span className="action__label">{user ? 'Conta' : 'Entrar'}</span>
            </Link>
            <Link to="/favoritos" className="action action--wish" aria-label={`Favoritos (${favorites.length})`}>
              <Icon name="heart" /><span className="action__label">Favoritos</span>{favorites.length ? <span className="action__dot" aria-hidden="true" /> : null}
            </Link>
            <button className="action action--cart" onClick={() => setCartOpen(true)} aria-label={`Sacola com ${cartCount} ${cartCount === 1 ? 'item' : 'itens'}`}>
              <Icon name="bag" /><span className="action__label">Sacola</span><span className="action__count" aria-hidden="true" data-zero={cartCount === 0 ? '' : undefined}>{cartCount}</span>
            </button>
          </div>
        </div>
      </header>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} cats={cats} />
    </>
  );
}

function MobileMenu({ open, onClose, cats }: { open: boolean; onClose: () => void; cats: CategoryDTO[] }) {
  const { user, logout } = useStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} variant="drawer-left" labelledBy="mobile-menu-title" className="mobile-menu">
      <div className="mobile-menu__head">
        <span id="mobile-menu-title" className="sr-only">Menu</span>
        <Logo />
        <button className="icon-btn" onClick={onClose} aria-label="Fechar menu"><Icon name="close" /></button>
      </div>
      <nav className="mobile-menu__nav" aria-label="Categorias">
        <ul>
          <li><Link to="/" onClick={onClose}>Início</Link></li>
          <li><Link to="/categoria/novidades" onClick={onClose}>Novidades</Link></li>
          {cats.map((c) => (
            <li key={c.slug}>
              <div className="mobile-menu__row">
                <Link to={`/categoria/${c.slug}`} onClick={onClose}>{c.name}</Link>
                {(c.children ?? []).length ? (
                  <button className="icon-btn" aria-expanded={expanded === c.slug} aria-label={`Subcategorias de ${c.name}`} onClick={() => setExpanded(expanded === c.slug ? null : c.slug)}>
                    <Icon name={expanded === c.slug ? 'minus' : 'plus'} size={18} />
                  </button>
                ) : null}
              </div>
              {expanded === c.slug ? (
                <ul className="mobile-menu__sub">
                  {(c.children ?? []).filter((s) => (s.productCount ?? 0) > 0).map((s) => <li key={s.id}><Link to={`/categoria/${s.slug}`} onClick={onClose}>{s.name}</Link></li>)}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </nav>
      <div className="mobile-menu__foot">
        {user ? (
          <>
            <Link to="/conta" onClick={onClose}><Icon name="user" size={18} /> Minha conta</Link>
            <Link to="/conta/pedidos" onClick={onClose}><Icon name="bag" size={18} /> Meus pedidos</Link>
            {user.role === 'admin' ? <Link to="/admin" onClick={onClose}><Icon name="grid" size={18} /> Painel administrativo</Link> : null}
            <button onClick={() => { onClose(); void logout(); }}><Icon name="logout" size={18} /> Sair</button>
          </>
        ) : (
          <>
            <Link to="/entrar" onClick={onClose}><Icon name="user" size={18} /> Entrar</Link>
            <Link to="/cadastro" onClick={onClose}><Icon name="plus" size={18} /> Criar conta</Link>
          </>
        )}
        <Link to="/favoritos" onClick={onClose}><Icon name="heart" size={18} /> Favoritos</Link>
        <Link to="/atendimento" onClick={onClose}><Icon name="info" size={18} /> Atendimento</Link>
      </div>
    </Dialog>
  );
}
