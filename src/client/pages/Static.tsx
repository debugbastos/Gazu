import { useState, type ReactNode } from 'react';
import { useDocumentTitle } from '../lib/hooks';
import { Link, useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { Breadcrumbs, Button, Field, Notice } from '../components/ui/ui';

function Doc({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="doc container">
      <Breadcrumbs items={[{ name: 'Início', href: '/' }, { name: title, href: '#' }]} />
      <header className="doc__head">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
      </header>
      <div className="doc__body">{children}</div>
    </div>
  );
}

function CompanyLine() {
  const { config } = useStore();
  const c = config.settings.company;
  if (!c.legalName && !c.cnpj) return <Notice tone="warning">Os dados empresariais (razão social, CNPJ e endereço) ainda não foram configurados pela loja.</Notice>;
  return <p><strong>{c.legalName}</strong>{c.cnpj ? ` — CNPJ ${c.cnpj}` : ''}{c.address ? ` — ${c.address}` : ''}</p>;
}

export function NotFoundPage() {
  useDocumentTitle('Página não encontrada');
  return (
    <div className="container not-found">
      <p className="eyebrow">Erro 404</p>
      <h1>Página não encontrada</h1>
      <p className="muted">O endereço pode ter mudado ou o produto não está mais disponível.</p>
      <div className="not-found__ctas">
        <Link to="/" className="btn btn--primary btn--md">Ir para o início</Link>
        <Link to="/categoria/novidades" className="link-underline">Ver novidades</Link>
      </div>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <Doc title="Política de privacidade" eyebrow="LGPD">
      <CompanyLine />
      <p>Esta política explica como a GAZU trata dados pessoais na loja virtual, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).</p>
      <h2>Dados que coletamos</h2>
      <ul>
        <li>Cadastro: nome, e-mail e senha (armazenada apenas de forma criptografada).</li>
        <li>Entrega: endereço, CEP e nome do destinatário.</li>
        <li>Pedidos: itens comprados, valores e status de pagamento e entrega.</li>
        <li>Pagamento: processado pelo provedor de pagamentos. A GAZU <strong>não armazena</strong> número completo de cartão nem código de segurança.</li>
      </ul>
      <h2>Para que usamos</h2>
      <p>Para criar e manter sua conta, processar pedidos, entregar produtos, prestar atendimento, prevenir fraudes e cumprir obrigações legais e fiscais.</p>
      <h2>Compartilhamento</h2>
      <p>Somente com prestadores necessários à operação (pagamento, entrega, hospedagem e e-mail), dentro do necessário para cada finalidade.</p>
      <h2>Seus direitos</h2>
      <p>Você pode solicitar acesso, correção, portabilidade ou exclusão dos seus dados, ressalvadas as obrigações legais de guarda (por exemplo, registros fiscais de pedidos). Use os canais da página <Link to="/atendimento" className="link-underline">Atendimento</Link>.</p>
      <h2>Cookies</h2>
      <p>Usamos apenas cookies essenciais (sessão de login e segurança). O carrinho e os favoritos de visitantes ficam salvos no seu navegador.</p>
      <p className="muted small">Documento-base a ser revisado pelo responsável jurídico da loja antes da publicação.</p>
    </Doc>
  );
}

export function TermsPage() {
  return (
    <Doc title="Termos de uso">
      <CompanyLine />
      <p>Ao utilizar a loja GAZU você concorda com estes termos. Leia também a <Link to="/politica-de-privacidade" className="link-underline">Política de privacidade</Link>.</p>
      <h2>Conta</h2>
      <p>Você é responsável pela veracidade dos dados informados e pela confidencialidade da sua senha.</p>
      <h2>Preços e disponibilidade</h2>
      <p>Preços, estoque e prazos são confirmados no momento da finalização do pedido. Pedidos só são considerados pagos após confirmação do provedor de pagamento.</p>
      <h2>Pedidos não pagos</h2>
      <p>O estoque fica reservado por um período limitado. Pedidos não pagos dentro do prazo são cancelados automaticamente.</p>
      <h2>Direito de arrependimento</h2>
      <p>Compras realizadas pela internet podem ser canceladas em até 7 dias corridos após o recebimento (art. 49 do CDC). Veja <Link to="/trocas-e-devolucoes" className="link-underline">Trocas e devoluções</Link>.</p>
      <p className="muted small">Documento-base a ser revisado pelo responsável jurídico da loja antes da publicação.</p>
    </Doc>
  );
}

export function ReturnsPage() {
  return (
    <Doc title="Trocas e devoluções">
      <h2>Arrependimento (7 dias)</h2>
      <p>Você pode desistir da compra em até 7 dias corridos após o recebimento, conforme o art. 49 do Código de Defesa do Consumidor, com reembolso integral do valor pago.</p>
      <h2>Como solicitar</h2>
      <ol>
        <li>Acesse <Link to="/conta/pedidos" className="link-underline">Meus pedidos</Link> e anote o número do pedido.</li>
        <li>Entre em contato pelos canais da página <Link to="/atendimento" className="link-underline">Atendimento</Link>.</li>
        <li>Envie o produto sem sinais de uso, com etiquetas, conforme as instruções que você receber.</li>
      </ol>
      <h2>Trocas por tamanho ou defeito</h2>
      <p>As condições de troca por tamanho, prazos adicionais e responsabilidade pelo frete de troca serão definidas pela loja.</p>
      <Notice tone="warning">Política comercial de trocas pendente de definição pelo cliente (prazos além do legal, custos de frete e canal de logística reversa).</Notice>
    </Doc>
  );
}

export function DeliveryPage() {
  const { config } = useStore();
  return (
    <Doc title="Informações de entrega">
      <p>O valor e o prazo de entrega são calculados pelo CEP no carrinho e no checkout, de acordo com as opções disponíveis para a sua região.</p>
      {!config.shipping.configured ? <Notice tone="warning">As regras de frete ainda não foram configuradas pela loja.</Notice> : config.shipping.provider === 'demo' ? <Notice tone="info">Ambiente de demonstração: as opções de frete exibidas são simuladas e não representam cotações reais.</Notice> : null}
      <h2>Acompanhamento</h2>
      <p>Assim que o pedido for enviado, o código de rastreamento aparece em <Link to="/conta/pedidos" className="link-underline">Meus pedidos</Link>.</p>
      <h2>Prazos</h2>
      <p>O prazo começa a contar após a confirmação do pagamento. Prazos são estimativas em dias úteis.</p>
    </Doc>
  );
}

export function ServicePage() {
  const { config } = useStore();
  const c = config.settings.contact;
  const any = c.email || c.phone || c.whatsapp;
  return (
    <Doc title="Atendimento" eyebrow="Fale com a GAZU">
      {any ? (
        <ul className="contact-list">
          {c.email ? <li><strong>E-mail</strong><a href={`mailto:${c.email}`}>{c.email}</a></li> : null}
          {c.phone ? <li><strong>Telefone</strong><span>{c.phone}</span></li> : null}
          {c.whatsapp ? <li><strong>WhatsApp</strong><span>{c.whatsapp}</span></li> : null}
          {c.serviceHours ? <li><strong>Horário</strong><span>{c.serviceHours}</span></li> : null}
        </ul>
      ) : <Notice tone="warning">Os canais de atendimento ainda não foram configurados pela loja.</Notice>}
      <h2>Perguntas frequentes</h2>
      <h3>Quando meu pedido é confirmado?</h3>
      <p>Quando o provedor de pagamento confirma a aprovação. Pix costuma ser confirmado em instantes.</p>
      <h3>Como acompanho a entrega?</h3>
      <p>Em <Link to="/conta/pedidos" className="link-underline">Meus pedidos</Link>, assim que o pedido for enviado.</p>
      <h3>Como faço uma troca?</h3>
      <p>Veja a página <Link to="/trocas-e-devolucoes" className="link-underline">Trocas e devoluções</Link>.</p>
    </Doc>
  );
}

export function TrackOrderPage() {
  const { user } = useStore();
  const { navigate } = useRouter();
  const [number, setNumber] = useState('');
  return (
    <Doc title="Rastrear pedido">
      <p>Informe o número do pedido (por exemplo, GZ100001). Por segurança, os detalhes só são exibidos para a conta que fez a compra.</p>
      <form className="track-form" onSubmit={(e) => { e.preventDefault(); const n = number.trim().toUpperCase(); if (!n) return; navigate(user ? `/conta/pedidos/${encodeURIComponent(n)}` : `/entrar?returnTo=${encodeURIComponent(`/conta/pedidos/${n}`)}`); }}>
        <Field label="Número do pedido" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="GZ100001" maxLength={20} required />
        <Button>Ver pedido</Button>
      </form>
      {user ? <p><Link to="/conta/pedidos" className="link-underline">Ver todos os meus pedidos</Link></p> : null}
    </Doc>
  );
}
