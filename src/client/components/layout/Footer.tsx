import { Link } from '../../lib/router';
import { useStore } from '../../lib/store';
import { Logo } from '../ui/Logo';
import { NAV_ORDER } from './Header';

export function Footer() {
  const { config } = useStore();
  const s = config.settings;
  const cats = NAV_ORDER.map((slug) => config.categories.find((c) => c.slug === slug)).filter(Boolean);
  const methods: string[] = [];
  if (config.payments.pix) methods.push('Pix');
  if (config.payments.creditCard) methods.push('Cartão de crédito');
  const social = Object.entries(s.social).filter(([, v]) => v);
  return (
    <footer className="site-footer">
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
        <nav aria-label="Atendimento" className="site-footer__col">
          <h2>Atendimento</h2>
          <ul>
            <li><Link to="/atendimento">Fale conosco</Link></li>
            <li><Link to="/entrega">Informações de entrega</Link></li>
            <li><Link to="/trocas-e-devolucoes">Trocas e devoluções</Link></li>
            <li><Link to="/rastrear-pedido">Rastrear pedido</Link></li>
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
            {s.contact.whatsapp ? <li>WhatsApp: {s.contact.whatsapp}</li> : null}
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
        </nav>
      </div>
    </footer>
  );
}
