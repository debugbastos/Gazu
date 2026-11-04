import type { Database } from '../db.ts';

// Conteúdo inicial. Regras:
// - Guias de medidas: tabelas de REFERÊNCIA marcadas como demonstração (is_demo = 1) — devem ser substituídas
//   pelas medidas reais do fornecedor antes da publicação definitiva.
// - FAQ e páginas de ajuda descrevem o FUNCIONAMENTO REAL do sistema (prazos legais, fluxo de pagamento,
//   rastreio, privacidade). Não informam CNPJ, endereço, telefone, prazos comerciais ou políticas não fornecidas.
// - Coleções, lookbooks e artigos do Journal são DEMONSTRAÇÃO (is_demo = 1), usando os produtos e imagens do catálogo de demonstração.
// - Nenhuma avaliação, campanha, despesa, venda ou conversa é criada.

const SIZE_GUIDES = [
  {
    key: 'adulto-superior', name: 'Roupas adultas — parte de cima (referência)',
    table: { head: ['Tamanho', 'Tórax (cm)', 'Comprimento (cm)', 'Ombro (cm)'], rows: [['PP', '84–88', '66', '42'], ['P', '88–94', '68', '44'], ['M', '94–100', '70', '46'], ['G', '100–106', '72', '48'], ['GG', '106–112', '74', '50'], ['XGG', '112–118', '76', '52']] },
    note: 'Tabela de REFERÊNCIA para demonstração. Substitua pelas medidas informadas pelo fornecedor de cada peça. Modelagens oversized têm caimento mais amplo.',
  },
  {
    key: 'adulto-inferior', name: 'Roupas adultas — calças, shorts e saias (referência)',
    table: { head: ['Tamanho', 'Cintura (cm)', 'Quadril (cm)', 'Numeração'], rows: [['PP', '62–66', '86–90', '34–36'], ['P', '66–72', '90–96', '38'], ['M', '72–78', '96–102', '40–42'], ['G', '78–86', '102–108', '44'], ['GG', '86–94', '108–116', '46–48']] },
    note: 'Tabela de REFERÊNCIA para demonstração. Confirme com as medidas do fornecedor.',
  },
  {
    key: 'infantil', name: 'Infantil (referência)',
    table: { head: ['Tamanho', 'Altura (cm)', 'Idade aproximada'], rows: [['2', '86–92', '2 anos'], ['4', '98–104', '3–4 anos'], ['6', '110–116', '5–6 anos'], ['8', '122–128', '7–8 anos'], ['10', '134–140', '9–10 anos'], ['12', '146–152', '11–12 anos'], ['14', '158–164', '13–14 anos']] },
    note: 'Tabela de REFERÊNCIA para demonstração. A altura é a melhor referência; a idade é apenas aproximada.',
  },
  {
    key: 'calcados', name: 'Calçados (referência)',
    table: { head: ['Numeração BR', 'Comprimento do pé (cm)'], rows: [['34', '22,0'], ['35', '22,7'], ['36', '23,4'], ['37', '24,0'], ['38', '24,7'], ['39', '25,4'], ['40', '26,0'], ['41', '26,7'], ['42', '27,4'], ['43', '28,0'], ['44', '28,7']] },
    note: 'Tabela de REFERÊNCIA para demonstração. Meça o pé do calcanhar ao dedo mais longo, no fim do dia; entre dois números, prefira o maior.',
  },
];

const FAQ: [string, string, string][] = [
  ['pedidos', 'Preciso ter cadastro para comprar?', 'Não. Você pode finalizar como visitante informando nome e e-mail. O link de acompanhamento do pedido é enviado para o seu e-mail. Se criar uma conta depois com o mesmo e-mail, a ativação é feita por um link enviado a ele, e seus pedidos passam a aparecer na conta.'],
  ['pedidos', 'Como acompanho meu pedido?', 'Na sua conta, em "Pedidos", ou na página Rastrear pedido, informando o número do pedido e o e-mail usado na compra. Quando o pedido é enviado, você recebe o código de rastreio por e-mail.'],
  ['pedidos', 'Posso cancelar um pedido?', 'Pedidos aguardando pagamento podem ser cancelados por você na página do pedido; os itens voltam ao estoque. Depois do pagamento aprovado, fale com o atendimento: o cancelamento é feito com estorno pelo provedor de pagamento.'],
  ['pagamento', 'Quais formas de pagamento são aceitas?', 'As formas disponíveis aparecem no checkout (Pix, cartão de crédito e boleto, conforme habilitado pela loja). O pagamento é processado pelo Mercado Pago: a GAZU não recebe nem armazena o número do cartão ou o código de segurança.'],
  ['pagamento', 'Quanto tempo tenho para pagar o Pix?', 'O código Pix tem validade informada na tela de pagamento. Se o prazo terminar sem pagamento, o pedido é cancelado automaticamente e os itens voltam ao estoque. A confirmação do Pix costuma ser imediata.'],
  ['pagamento', 'Quando o boleto é confirmado?', 'A compensação do boleto pode levar até 3 dias úteis após o pagamento. O pedido fica reservado até o vencimento do boleto.'],
  ['pagamento', 'Meu pagamento foi recusado. E agora?', 'Você pode tentar novamente com outra forma de pagamento na página do pedido, enquanto ele estiver aguardando pagamento. O motivo da recusa é informado pelo banco ou pelo provedor.'],
  ['entrega', 'Como é calculado o frete?', 'Informe o CEP no carrinho ou no checkout para ver as opções de entrega, valores e prazos. O prazo começa a contar após a confirmação do pagamento.'],
  ['trocas', 'Posso desistir da compra?', 'Sim. Em compras feitas pela internet, você pode desistir em até 7 dias corridos após o recebimento (art. 49 do Código de Defesa do Consumidor). Solicite pela página do pedido; o valor pago é estornado pelo mesmo meio de pagamento depois que o produto retorna.'],
  ['trocas', 'E se o produto chegar com defeito?', 'Você pode solicitar a troca ou a devolução por defeito em até 90 dias após o recebimento (art. 26 do Código de Defesa do Consumidor). Abra a solicitação pela página do pedido e descreva o problema; se possível, envie fotos pelo atendimento.'],
  ['trocas', 'Como funciona a troca de tamanho ou cor?', 'Abra uma solicitação de troca pela página do pedido. A disponibilidade do novo tamanho ou cor é confirmada pela equipe, que informa os próximos passos por e-mail.'],
  ['trocas', 'Quando recebo o estorno?', 'O estorno é solicitado ao provedor de pagamento e você recebe um e-mail quando ele é confirmado. No cartão de crédito, o valor aparece na fatura conforme o fechamento do banco emissor; no Pix, volta para a conta de origem.'],
  ['produtos', 'Como escolho o tamanho certo?', 'Use o guia de medidas na página do produto e compare com uma peça que você já usa. Se ficar em dúvida, fale com o atendimento antes de comprar.'],
  ['produtos', 'O tamanho que quero está esgotado. Vai voltar?', 'Use o botão "Avise-me" no tamanho esgotado. Quando houver reposição, enviamos um único e-mail para você. As unidades não ficam reservadas.'],
  ['conta', 'Esqueci minha senha.', 'Use "Esqueci minha senha" na página de entrada. Enviamos um link válido por 1 hora para o e-mail cadastrado.'],
  ['privacidade', 'Como peço uma cópia ou a exclusão dos meus dados?', 'Na sua conta, em "Privacidade", você baixa uma cópia dos seus dados e pode pedir a exclusão. Dados de pedidos e pagamentos são mantidos pelo prazo exigido pela legislação fiscal, sem vínculo com a sua conta.'],
  ['privacidade', 'Vocês usam cookies de análise?', 'Somente se você permitir no aviso de cookies. Sem a sua permissão, nenhum evento de navegação é registrado. Você pode mudar a escolha a qualquer momento no rodapé do site.'],
];

const HELP_PAGES: { slug: string; title: string; body: string; seo: string }[] = [
  {
    slug: 'pagamento', title: 'Pagamento', seo: 'Formas de pagamento, prazos de confirmação e segurança na GAZU.',
    body: `## Como funciona\n\nO pagamento é processado pelo **Mercado Pago**. As formas disponíveis aparecem no checkout, conforme habilitado pela loja.\n\n- **Pix**: o código tem validade exibida na tela; a confirmação costuma ser imediata.\n- **Cartão de crédito**: os dados do cartão são digitados em um campo seguro do provedor. A GAZU **não recebe nem armazena** o número do cartão nem o código de segurança. O parcelamento disponível é informado pelo provedor no checkout.\n- **Boleto**: a compensação pode levar até 3 dias úteis. O pedido fica reservado até o vencimento.\n\n## Confirmação\n\nO pedido só é considerado pago depois da confirmação do provedor. Você recebe um e-mail quando o pagamento é aprovado.\n\n## Pagamento recusado ou expirado\n\nEnquanto o pedido estiver aguardando pagamento, você pode tentar outra forma na página do pedido. Se o prazo terminar, o pedido é cancelado e os itens voltam ao estoque.`,
  },
  {
    slug: 'cancelamento', title: 'Cancelamento', seo: 'Como cancelar um pedido na GAZU.',
    body: `## Antes do pagamento\n\nPedidos **aguardando pagamento** podem ser cancelados por você na página do pedido. Nenhum valor é cobrado e os itens voltam ao estoque.\n\n## Depois do pagamento\n\nFale com o [atendimento](/atendimento). O cancelamento de pedidos pagos é feito com **estorno pelo provedor de pagamento**, e você recebe um e-mail quando o estorno é confirmado.\n\n## Depois do envio\n\nSe o pedido já foi enviado, siga o fluxo de [trocas e devoluções](/trocas-e-devolucoes): a desistência pode ser solicitada em até 7 dias após o recebimento.`,
  },
];

export function seedContent(db: Database): { sizeGuides: number; faq: number; pages: number; collections: number; lookbooks: number; articles: number } {
  const out = { sizeGuides: 0, faq: 0, pages: 0, collections: 0, lookbooks: 0, articles: 0 };
  return db.tx(() => {
    const guideIds: Record<string, number> = {};
    if (!db.get('SELECT 1 FROM size_guides LIMIT 1')) {
      for (const g of SIZE_GUIDES) {
        guideIds[g.key] = db.run('INSERT INTO size_guides (name, table_json, note, is_demo) VALUES (?, ?, ?, 1)', g.name, JSON.stringify(g.table), g.note).lastInsertRowid;
        out.sizeGuides++;
      }
      // Vincula a guia de referência aos produtos de demonstração ainda sem guia.
      const link = (key: string, where: string) => db.run(`UPDATE products SET size_guide_id = ? WHERE is_demo = 1 AND size_guide_id IS NULL AND (${where})`, guideIds[key]!);
      link('calcados', "product_type = 'Tênis'");
      link('infantil', "audience IN ('menino','menina')");
      link('adulto-inferior', "product_type IN ('Calça','Short','Saia')");
      link('adulto-superior', "product_type IN ('Camiseta','Camisa','Jaqueta','Moletom','Conjunto','Vestido','Blusa')");
    }
    if (!db.get('SELECT 1 FROM faq_items LIMIT 1')) {
      FAQ.forEach(([category, q, a], i) => { db.run('INSERT INTO faq_items (category, question, answer, position) VALUES (?, ?, ?, ?)', category, q, a, i); out.faq++; });
    }
    for (const p of HELP_PAGES) {
      if (db.get('SELECT 1 FROM pages WHERE slug = ?', p.slug)) continue;
      db.run("INSERT INTO pages (slug, title, body, status, seo_description) VALUES (?, ?, ?, 'published', ?)", p.slug, p.title, p.body, p.seo);
      out.pages++;
    }

    const pid = (slug: string) => db.get<{ id: number }>('SELECT id FROM products WHERE slug = ?', slug)?.id;
    const img = (slug: string) => db.get<{ url: string }>('SELECT i.url FROM product_images i JOIN products p ON p.id = i.product_id WHERE p.slug = ? ORDER BY i.position LIMIT 1', slug)?.url ?? null;
    if (!db.get('SELECT 1 FROM collections LIMIT 1') && pid('camiseta-oversized-speed')) {
      const cols = [
        { slug: 'motorsport', name: 'Motorsport', season: 'Demonstração', desc: 'Jaquetas racing, camisetas oversized e calças track inspiradas nas pistas.', status: 'active', featured: 1, cover: 'jaqueta-racing-preta-vermelha', products: ['jaqueta-racing-preta-vermelha', 'jaqueta-corta-vento-racing-preta', 'camiseta-oversized-speed', 'camiseta-oversized-motorsport', 'calca-track-preta-vivo-branco', 'calca-track-vinho-vivo-branco', 'tenis-running-branco', 'bone-aba-reta-cinza-azul'] },
        { slug: 'essenciais', name: 'Essenciais', season: 'Demonstração', desc: 'Peças-base que combinam com tudo: básicos, linho, alfaiataria e tons neutros.', status: 'active', featured: 1, cover: 'calca-linho-wide-bege', products: ['camiseta-basica-branca-masculina', 'calca-linho-wide-bege', 'short-alfaiataria-branco-cinto', 'calca-wide-bege-feminina', 'tenis-branco-listras-cinza', 'relogio-prata-pulseira-grumet'] },
        { slug: 'jardim', name: 'Jardim', season: 'Demonstração', desc: 'Florais, borboletas e cerejas para dias leves.', status: 'active', featured: 1, cover: 'vestido-longo-branco-floral', products: ['vestido-longo-branco-floral', 'vestido-midi-cerejas', 'vestido-longo-floral-azul', 'camiseta-oversized-bloom-borboleta', 'colar-duplo-borboletas-dourado', 'tenis-off-white-cerejas'] },
        { slug: 'inverno-urbano', name: 'Inverno urbano', season: 'Arquivo · demonstração', desc: 'Moletons e conjuntos de uma temporada anterior — disponível no Archive.', status: 'archived', featured: 0, cover: 'conjunto-moletom-masculino-cinza', products: ['conjunto-moletom-masculino-cinza', 'moletom-meio-ziper-cinza-preto', 'jaqueta-moletom-ziper-gotica', 'calca-moletom-wide-cinza-tribal'] },
      ];
      cols.forEach((c, i) => {
        const id = db.run(
          "INSERT INTO collections (slug, name, description, season, cover_url, cover_alt, status, is_featured, position, is_demo, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
          c.slug, c.name, c.desc, c.season, img(c.cover), c.name, c.status, c.featured, i, c.status === 'archived' ? new Date().toISOString() : null,
        ).lastInsertRowid;
        c.products.forEach((s, j) => { const p = pid(s); if (p) db.run('INSERT OR IGNORE INTO collection_products (collection_id, product_id, position) VALUES (?, ?, ?)', id, p, j); });
        out.collections++;
      });
    }
    if (!db.get('SELECT 1 FROM lookbooks LIMIT 1') && pid('camisa-manga-curta-texturizada')) {
      const now = new Date().toISOString();
      // Cada foto mostra a peça marcada no ponto (nunca marcamos itens que não aparecem na imagem).
      const photo = (slug: string) => db.get<{ url: string; width: number | null; height: number | null }>('SELECT i.url, i.width, i.height FROM product_images i JOIN products p ON p.id = i.product_id WHERE p.slug = ? ORDER BY i.position LIMIT 1', slug);
      const books = [
        { slug: 'cidade-em-movimento', title: 'Cidade em movimento', desc: 'Look de demonstração montado com peças do catálogo: camisa texturizada, calça de linho e tênis branco. Toque nos pontos para comprar cada peça.',
          shots: [['camisa-manga-curta-texturizada', 50, 40, 'Camisa'], ['calca-linho-wide-bege', 50, 50, 'Calça'], ['tenis-branco-listras-verdes', 55, 52, 'Tênis']] },
        { slug: 'leveza', title: 'Leveza', desc: 'Composição feminina de demonstração: vestido floral, colar em camadas e saia longa.',
          shots: [['vestido-longo-branco-floral', 50, 55, 'Vestido'], ['colar-camadas-estrela-prata', 52, 28, 'Colar'], ['saia-longa-marrom', 50, 62, 'Saia']] },
      ] as const;
      books.forEach((b, i) => {
        const cover = photo(b.shots[0][0])?.url ?? null;
        const id = db.run("INSERT INTO lookbooks (slug, title, description, cover_url, status, published_at, position, is_demo) VALUES (?, ?, ?, ?, 'published', ?, ?, 1)", b.slug, b.title, b.desc, cover, now, i).lastInsertRowid;
        b.shots.forEach(([s, x, y, label], j) => {
          const p = pid(s);
          const ph = photo(s);
          if (!p || !ph) return;
          const imageId = db.run('INSERT INTO lookbook_images (lookbook_id, url, alt, width, height, position) VALUES (?, ?, ?, ?, ?, ?)', id, ph.url, `${label} — ${b.title}`, ph.width, ph.height, j).lastInsertRowid;
          db.run('INSERT INTO lookbook_products (lookbook_id, image_id, product_id, x_pct, y_pct, label, position) VALUES (?, ?, ?, ?, ?, ?, ?)', id, imageId, p, x, y, label, j);
        });
        out.lookbooks++;
      });
    }
    if (!db.get('SELECT 1 FROM journal_articles LIMIT 1') && pid('tenis-branco-listras-verdes')) {
      const now = new Date().toISOString();
      const articles = [
        {
          slug: 'como-montar-um-guarda-roupa-essencial', title: 'Como montar um guarda-roupa essencial', category: 'estilo', cover: img('camiseta-basica-branca-masculina'),
          excerpt: 'Poucas peças, muitas combinações: um roteiro prático para começar pelo básico.',
          body: `> Conteúdo de demonstração do Journal GAZU — substitua pelos textos da marca.\n\n## Comece pelas bases\n\nCamisetas lisas, uma calça de caimento reto e um tênis branco resolvem a maior parte dos dias. Escolha cores que combinem entre si.\n\n## Uma peça de destaque por vez\n\nUma jaqueta, um estampado ou um acessório marcante dá personalidade sem pesar o visual.\n\n## Cuide do que você já tem\n\nSiga as instruções da etiqueta, lave do avesso e seque à sombra: as peças duram mais.`,
          products: ['camiseta-basica-branca-masculina', 'calca-linho-wide-bege', 'tenis-branco-listras-cinza'],
        },
        {
          slug: 'cuidados-com-o-tenis-branco', title: 'Cuidados com o tênis branco', category: 'cuidados', cover: img('tenis-branco-listras-verdes'),
          excerpt: 'Limpeza leve e frequente mantém o branco por mais tempo.',
          body: `> Conteúdo de demonstração do Journal GAZU — substitua pelos textos da marca.\n\n## Limpeza do dia a dia\n\nUse escova macia e pano úmido com sabão neutro. Evite máquina de lavar e secadora, que deformam o solado.\n\n## Secagem\n\nSeque à sombra, com papel dentro para manter o formato.\n\n## Armazenamento\n\nGuarde longe do sol direto para evitar o amarelamento.`,
          products: ['tenis-branco-listras-verdes', 'tenis-running-branco'],
        },
      ];
      for (const a of articles) {
        const id = db.run("INSERT INTO journal_articles (slug, title, excerpt, body, cover_url, cover_alt, category, status, published_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, 1)",
          a.slug, a.title, a.excerpt, a.body, a.cover, a.title, a.category, now).lastInsertRowid;
        a.products.forEach((s, j) => { const p = pid(s); if (p) db.run('INSERT OR IGNORE INTO journal_article_products (article_id, product_id, position) VALUES (?, ?, ?)', id, p, j); });
        out.articles++;
      }
    }
    return out;
  });
}
