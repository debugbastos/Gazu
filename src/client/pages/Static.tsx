import { type ReactNode } from 'react';
import { useDocumentTitle } from '../lib/hooks';
import { Link } from '../lib/router';
import { useStore } from '../lib/store';
import { Breadcrumbs, Notice } from '../components/ui/ui';

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
      <p>Você pode solicitar acesso, correção, portabilidade ou exclusão dos seus dados, ressalvadas as obrigações legais de guarda (por exemplo, registros fiscais de pedidos). Com conta, use <Link to="/conta/privacidade" className="link-underline">Minha conta › Privacidade</Link> para baixar seus dados ou pedir a exclusão; sem conta, use a página <Link to="/atendimento" className="link-underline">Atendimento</Link>.</p>
      <h2>Comunicações</h2>
      <p>E-mails transacionais (confirmação, pagamento, envio, trocas) fazem parte da compra. Newsletter e lembretes de carrinho só são enviados com sua autorização, confirmada por e-mail, e podem ser cancelados a qualquer momento.</p>
      <h2>Cookies</h2>
      <p>Cookies essenciais mantêm o login, a sacola e a segurança. Cookies de análise só são usados se você permitir no aviso de cookies: registramos eventos de navegação anônimos (sem nome, e-mail ou IP) para melhorar a loja, apagados após 13 meses. Você pode mudar a escolha em “Preferências de cookies”, no rodapé.</p>
      <h2>Retenção</h2>
      <p>Dados da conta ficam enquanto ela existir. Pedidos e pagamentos são mantidos pelo prazo exigido pela legislação fiscal e contábil, mesmo após a exclusão da conta (sem vínculo com seus dados de contato).</p>
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
  const { config } = useStore();
  const p = config.settings.policies;
  return (
    <Doc title="Trocas e devoluções">
      <h2>Desistência ({p?.withdrawalDays ?? 7} dias)</h2>
      <p>Você pode desistir da compra em até {p?.withdrawalDays ?? 7} dias corridos após o recebimento, conforme o art. 49 do Código de Defesa do Consumidor, com reembolso integral do valor pago, estornado pelo mesmo meio de pagamento.</p>
      <h2>Produto com defeito ({p?.defectDays ?? 90} dias)</h2>
      <p>Produtos com defeito podem ser trocados ou devolvidos em até {p?.defectDays ?? 90} dias após o recebimento (art. 26 do CDC).</p>
      <h2>Troca de tamanho ou cor</h2>
      {p?.exchangeDays ? <p>Trocas de tamanho ou cor podem ser solicitadas em até {p.exchangeDays} dias após o recebimento, sujeitas à disponibilidade.</p> : <p>Solicite pela página do pedido: a disponibilidade e as condições são confirmadas pela equipe em cada caso.</p>}
      <h2>Como solicitar</h2>
      <ol>
        <li>Abra o pedido em <Link to="/conta/pedidos" className="link-underline">Meus pedidos</Link> (ou pelo link do e-mail da compra, se comprou sem cadastro).</li>
        <li>Clique em <strong>Solicitar troca ou devolução</strong>, escolha os itens e descreva o motivo.</li>
        <li>Você recebe as instruções de envio por e-mail. O produto deve retornar sem sinais de uso, com etiquetas.</li>
        <li>Após o recebimento, o estorno é solicitado ao provedor de pagamento e você é avisado quando ele for confirmado.</li>
      </ol>
      <Notice tone="warning">Custos de frete de troca e o canal de logística reversa (postagem ou coleta) ainda precisam ser definidos pela loja.</Notice>
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
      <p>Assim que o pedido for enviado, o código de rastreamento aparece em <Link to="/conta/pedidos" className="link-underline">Meus pedidos</Link>, no e-mail de envio e na página <Link to="/rastreio" className="link-underline">Rastrear pedido</Link> (número do pedido + e-mail da compra).</p>
      <h2>Prazos</h2>
      <p>O prazo começa a contar após a confirmação do pagamento. Prazos são estimativas em dias úteis.</p>
    </Doc>
  );
}
