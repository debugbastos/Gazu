import { Link, useRouter } from '../../lib/router';
import { useStore } from '../../lib/store';
import { Logo } from '../ui/Logo';
import { NAV_ORDER } from './Header';
import { NewsletterForm, openCookiePreferences, whatsappLink } from '../content/Editorial';

export function Footer() {
  const { config } = useStore();
  const { location } = useRouter();
  const s = config.settings;
  // Na página inicial a newsletter já é uma seção administrável; no rodapé ela aparece nas demais páginas.
  const homeHasNewsletter = location.pathname === '/' && (s.home?.sections ?? []).some((x) => x.key === 'newsletter' && x.enabled);
  const cats = NAV_ORDER.map((slug) => config.categories.find((c) => c.slug === slug)).filter(Boolean);
  const methods: string[] = [];
  if (config.payments.pix) methods.push('Pix');
  if (config.payments.creditCard) methods.push('Cartão de crédito');
  if (config.payments.boleto) methods.push('Boleto');
  const wa = whatsappLink(s.contact.whatsapp, s.whatsapp?.defaultMessage ?? 'Olá! Vim pelo site da GAZU.');
  const social = Object.entries(s.social).filter(([, v]) => v);
  return (
    <footer className="site-footer">
      {!homeHasNewsletter ? <div className="container site-footer__news"><NewsletterForm source="footer" dark /></div> : null}
      <div className="site-footer__top container">
        <div className="site-footer__brand">
          <Logo variant="full" />
          <p>Moda que se move com você. Masculino, feminino, infantil, tênis e acessórios.</p>
          {social.length ? (
            <ul className="site-footer__social">
              {social.map(([k, v]) => <li key={k}><a href={v} target="_blank" rel="noopener noreferrer">{k === 'instagram' ? 'Instagram' : k === 'tiktok' ? 'TikTok' : 'Facebook'}</a></li>)}
            </ul>
          ) : null}
        </div>
        <nav aria-label="Categorias" className="site-footer__col">
          <h2>Comprar</h2>
          <ul>
            <li><Link to="/categoria/novidades">Novidades</Link></li>
            {cats.map((c) => <li key={c!.slug}><Link to={`/categoria/${c!.slug}`}>{c!.name}</Link></li>)}
          </ul>
        </nav>
        <nav aria-label="Descobrir" className="site-footer__col">
          <h2>Descobrir</h2>
          <ul>
            <li><Link to="/colecoes">Coleções</Link></li>
            <li><Link to="/lookbook">Lookbook</Link></li>
            <li><Link to="/monte-seu-look">Monte seu look</Link></li>
            <li><Link to="/journal">Journal</Link></li>
            <li><Link to="/archive">Archive</Link></li>
          </ul>
        </nav>
        <nav aria-label="Atendimento" className="site-footer__col">
          <h2>Atendimento</h2>
          <ul>
            <li><Link to="/ajuda">Central de ajuda</Link></li>
            <li><Link to="/atendimento">Fale conosco</Link></li>
            <li><Link to="/rastreio">Rastrear pedido</Link></li>
            <li><Link to="/entrega">Entrega</Link></li>
            <li><Link to="/pagamento">Pagamento</Link></li>
            <li><Link to="/trocas-e-devolucoes">Trocas e devoluções</Link></li>
            <li><Link to="/cancelamento">Cancelamento</Link></li>
          </ul>
        </nav>
        <nav aria-label="Conta" className="site-footer__col">
          <h2>Sua conta</h2>
          <ul>
            <li><Link to="/conta">Minha conta</Link></li>
            <li><Link to="/conta/pedidos">Meus pedidos</Link></li>
            <li><Link to="/favoritos">Favoritos</Link></li>
            <li><Link to="/carrinho">Sacola</Link></li>
          </ul>
        </nav>
        <div className="site-footer__col">
          <h2>Contato</h2>
          <ul className="site-footer__contact">
            {s.contact.email ? <li><a href={`mailto:${s.contact.email}`}>{s.contact.email}</a></li> : null}
            {s.contact.phone ? <li>{s.contact.phone}</li> : null}
            {s.contact.whatsapp ? <li>{wa ? <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp: {s.contact.whatsapp}</a> : <>WhatsApp: {s.contact.whatsapp}</>}</li> : null}
            {s.contact.serviceHours ? <li>{s.contact.serviceHours}</li> : null}
            {!s.contact.email && !s.contact.phone && !s.contact.whatsapp ? <li className="muted">Canais de contato em configuração.</li> : null}
          </ul>
          <h2 className="site-footer__pay-title">Pagamento</h2>
          <p className="muted">{methods.length ? methods.join(' · ') : config.payments.demo ? 'Pagamento simulado (demonstração)' : 'Métodos de pagamento em configuração.'}</p>
        </div>
      </div>
      <div className="site-footer__bottom container">
        <p>
          © {new Date().getFullYear()} GAZU
          {s.company.legalName ? ` · ${s.company.legalName}` : ''}
          {s.company.cnpj ? ` · CNPJ ${s.company.cnpj}` : ''}
          {s.company.address ? ` · ${s.company.address}` : ''}
        </p>
        <nav aria-label="Políticas">
          <Link to="/politica-de-privacidade">Privacidade</Link>
          <Link to="/termos-de-uso">Termos de uso</Link>
          <Link to="/trocas-e-devolucoes">Trocas</Link>
          <button type="button" className="site-footer__cookie" onClick={openCookiePreferences}>Preferências de cookies</button>
        </nav>
      </div>
    </footer>
  );
}
