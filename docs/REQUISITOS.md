# Matriz de rastreabilidade — GAZU Store

Fonte: **PROMPT MASTER DEFINITIVO — GAZU STORE** (seções §1–§35) e **ORDEM MESTRA DE EXECUÇÃO** (OM §1–§16).
Atualizada em **18/10/2026** ao fim do ciclo de implementação. Nenhum requisito foi removido.

**Estados** (não são equivalentes): `NÃO INICIADO` · `EM IMPLEMENTAÇÃO` · `IMPLEMENTADO` (código pronto, verificado manualmente/por captura,
sem teste automatizado) · `CONFIGURADO` · `TESTADO` (coberto por teste automatizado executado e aprovado) · `ATIVO EM PRODUÇÃO` ·
`BLOQUEADO POR DEPENDÊNCIA EXTERNA`.

> **Nenhum item está `ATIVO EM PRODUÇÃO`**: não há servidor de produção, domínio, contas nem credenciais da GAZU neste ambiente.
> Integrações aparecem em duas linhas: o **código** (testado com respostas simuladas do provedor) e a **ativação** (bloqueada).

**Legenda de testes** — unitários/integração (`npm test`, servidor HTTP real + banco em memória):
`U-acc` access · `U-cat` catalog-cart · `U-pay` checkout-payments · `U-ops` commerce-ops · `U-mgt` management · `U-adm` catalog-admin · `U-id` identity.
Navegador (Playwright): `E2E-n` = cenário n de `tests/e2e/run.mjs` (1 hero · 2 controles · 3 movimento reduzido · 4 compra · 5 painel/envio ·
6 visitante · 7 cookies · 8 páginas editoriais · 9 módulos do painel/permissões) · `HTML-n` = `tests/e2e/standalone.mjs` · `VIS` = `tests/e2e/visual.mjs`
(5 tamanhos de tela). Resultados: `docs/RELATORIO-TESTES.md`.

---

## Parte I — Auditoria e regras (§1–§3, OM §1–§3)

| ID | Seção | Requisito | Depende de | Módulos / arquivos | Status | Testes | Evidência | Pendência externa |
|---|---|---|---|---|---|---|---|---|
| R-001 | §2, OM §3 | Auditoria do projeto existente antes de alterar | — | todo o repositório | IMPLEMENTADO | — | Lacunas registradas no início do ciclo e nesta matriz | — |
| R-002 | §3, OM §8 | Manter arquitetura React existente; não substituir por HTML estático | — | `src/client`, `src/server` | IMPLEMENTADO | E2E-1…9 | App React + servidor; HTML autônomo só como demonstração rotulada | — |
| R-003 | §3, OM §6 | Sem dados fictícios apresentados como reais (demo só em dev e sinalizada) | — | `is_demo` em produtos/pedidos/conteúdo; `DEMO_MODE` | TESTADO | U-mgt (financeiro exclui demo), U-cat (frete demo sinalizado) | Selos "Demonstração", exclusão em relatórios; produção recusa `demo` | Substituir catálogo demo por dados reais |
| R-004 | OM §4 | Matriz de rastreabilidade | — | `docs/REQUISITOS.md` | IMPLEMENTADO | — | Este documento | — |

## Parte II — Identidade e experiência visual (§4–§7)

| ID | Seção | Requisito | Depende de | Módulos / arquivos | Status | Testes | Evidência | Pendência externa |
|---|---|---|---|---|---|---|---|---|
| R-010 | §4 | Paleta preto/off-white/branco/cinza/neutros | — | `styles/tokens.css` | IMPLEMENTADO | VIS | `docs/IDENTIDADE-VISUAL.md` §3 (contrastes medidos) | — |
| R-011 | §4.1 | Documento de identidade (paleta, tipografia, hierarquia, espaçamento, botões/estados, logo claro/escuro, favicon, fotografia, tratamento, animação, banners, etiquetas/embalagens, e-mails, tom de voz) | R-010 | `docs/IDENTIDADE-VISUAL.md` | IMPLEMENTADO | U-id (arquivos referenciados existem) | Documento com 12 seções | Revisão pela GAZU |
| R-012 | §4.1 | Tokens centralizados / design system reutilizável | — | `tokens.css`, `components/ui/*` | IMPLEMENTADO | VIS | Componentes `Button`, `Field`, `Dialog`, `Notice`… | — |
| R-013 | §4.2 | Logotipo vetorial a partir do original; versões cabeçalho, rodapé, favicon, redes, promo, etiquetas, embalagens | — | `public/assets/branding/logo/*`, `scripts/assets/build-brand-kit.mjs` | TESTADO | U-id | SVG/PNG preto, branco, monograma, e-mail, social | — |
| R-014 | §4.1 | Favicon e ícones (16/32/48/180/192/512/maskable + manifest) | R-013 | `public/favicon*`, `icon-*`, `site.webmanifest`, `render.ts` | TESTADO | U-id (manifesto, cabeçalho HTML) | Favicon alterna com tema do navegador | — |
| R-015 | §4.3 | Visual próprio, sem template genérico; sem sombras/gradientes/arredondamentos excessivos | R-012 | CSS | IMPLEMENTADO | VIS | Capturas em 5 tamanhos | — |
| R-016 | §4.1 | Aplicar identidade a loja, PDP, carrinho, checkout, conta, painel e comunicações | R-012 | client, `notifications.ts` | IMPLEMENTADO | VIS, U-id (e-mail com logotipo) | Capturas do painel e e-mail | — |
| R-020 | §5 | Usar imagens fornecidas; estrutura `public/assets/...`; sem esticar/misturar/inventar fotos | — | `scripts/process-images.mjs`, `docs/INVENTARIO-IMAGENS.md` | TESTADO | VIS (imagem deformada = falha) | Inventário de 107 fotos | Direitos de uso; fotos em alta |
| R-021 | §5 | Estrutura para adicionar materiais pelo painel | — | uploads (`/api/admin/uploads`), `ImageField` | IMPLEMENTADO | U-acc (admin cria/edita) | Upload gera WebP | — |
| R-030 | §6, §6.1 | Hero cinematográfico com sequência homem → mulher → menino → menina → homem, ~3 s, sem piscar | R-020 | `components/home/Hero.tsx`, `heroController.ts` | TESTADO | E2E-1, HTML-1 | Ordem 0,1,2,3 medida; permanência ≈3 s | Fotos do hero em alta resolução |
| R-031 | §6.2 | Responsivo; marca/CTA visíveis; reduced-motion; controle de movimento; CPU | R-030 | idem | TESTADO | E2E-2, E2E-3, VIS | Pausa, anterior/próximo; estático com movimento reduzido | — |
| R-032 | §6.2 | GSAP/ScrollTrigger quando necessário; não controlar a mesma propriedade com 2 bibliotecas | — | Web Animations API | IMPLEMENTADO | E2E-1 | Decisão em `DECISOES.md` (sem GSAP: npm indisponível; uma única API anima o hero) | — |
| R-040 | §7.1 | Barra de anúncios editável com ativação e validade | — | `announcements` (admin conteúdo), `Header.tsx` | IMPLEMENTADO | E2E-9 (painel abre) | Painel › Conteúdo › Avisos do topo | — |
| R-041 | §7.2 | Cabeçalho: logo, Masculino, Feminino, Infantil, Novidades, Coleções, busca, conta, favoritos, carrinho; rolagem; menu mobile acessível | — | `layout/Header.tsx` | TESTADO | VIS (menu x logo), E2E-4 | Coleções na barra superior (decisão de espaço) | — |
| R-042 | §7.3–12 | Home: categorias, novidades, coleções, Editorial, selecionados, lookbook, confiança, newsletter com consentimento, rodapé completo | R-040 | `pages/Home.tsx`, `content/Editorial.tsx`, `Footer.tsx` | TESTADO | VIS (home), U-cat (vitrines sem repetição), U-mgt (newsletter) | Capturas | — |
| R-043 | §7 | Administrar conteúdo, ordem das seções, banners e coleções | R-042 | `AdminSettings.tsx` (ordem), `AdminContent.tsx` | IMPLEMENTADO | E2E-9 | Seções ligáveis/ordenáveis | — |
| R-044 | §7 | Não exibir promoções/entrega inventadas | — | textos e avisos | IMPLEMENTADO | U-cat (frete demo sinalizado) | Barra sem frete grátis/desconto | — |

## Parte III — Catálogo e compra (§8–§12)

| ID | Seção | Requisito | Depende de | Módulos / arquivos | Status | Testes | Evidência | Pendência externa |
|---|---|---|---|---|---|---|---|---|
| R-100 | §8 | Categorias e subcategorias administráveis (criar, editar, ordenar, ocultar, excluir respeitando dependências) | — | `routes/admin.ts`, `AdminMisc.tsx` | TESTADO | U-adm (exclusão bloqueada/permitida) | 409 `has_dependencies` | — |
| R-101 | §8 | Não publicar categorias vazias | R-100 | `categoryTree()` público | TESTADO | U-adm | Categoria vazia fora da navegação | — |
| R-102 | §8.1 | Página de categoria: grid, busca, filtros combináveis, ordenação, paginação, contagem, limpar, vazio, disponibilidade real, URL compartilhável, SEO | — | `pages/Catalog.tsx`, `services/catalog.ts`, `render.ts` | TESTADO | U-cat, U-adm, VIS | Filtros na URL | — |
| R-103 | §8.1 | Filtros: categoria, tamanho, cor, preço, disponibilidade, novidades, coleção, tipo | R-102 | idem | TESTADO | U-cat, U-adm (novidades, coleção, estoque) | Facetas com contagem real | — |
| R-104 | §8.2 | Busca por nome/descrição/categoria/atributos, acentos, erros de digitação, sugestões e alternativas sem itens inexistentes | — | `catalog.ts` (`gz_norm`, correção), `SearchOverlay.tsx` | TESTADO | U-cat (sem acento), U-adm (correção, sugestões reais) | "camiseya" → "camiseta" | — |
| R-105 | §8.2 | Buscas sem resultado registradas para melhoria | R-104 | `analytics.ts`, Painel › Analytics | TESTADO | U-mgt (analytics) | Agregado, sem dado pessoal | — |
| R-110 | §9 | Cards: imagem, 2ª imagem, nome, preço, promoção válida, cores, selos reais, favorito, link | — | `catalog/ProductCard.tsx`, `cardsFor()` | IMPLEMENTADO | VIS | Selos "Novo"/"Últimas unidades" só com dado real | — |
| R-111 | §9 | Troca de cor no card atualiza imagem/variante | R-110 | `ProductCard.tsx` (`colorImages`) | IMPLEMENTADO | — | Verificado em captura | — |
| R-112 | §9 | Tamanhos indisponíveis não compráveis | — | PDP, servidor | TESTADO | U-pay (estoque), VIS (produto esgotado) | — | — |
| R-120 | §9.1 | PDP: URL própria, galeria com miniaturas, zoom, teclado, gestos | — | `pages/Product.tsx`, `product/Gallery.tsx` | IMPLEMENTADO | VIS, HTML-2 | Capturas desktop/celular | — |
| R-121 | §9.1 | PDP: preço/promoção, parcelamento do provedor, cores/tamanhos, SKU, composição, cuidados, medidas, disponibilidade, guia de tamanho, quantidade | — | `Product.tsx`, `installmentsInfo()` | TESTADO | U-ops (parcelas do provedor), U-cat (variantes) | Sem dado → seção oculta (nada inventado) | Composição/medidas reais |
| R-122 | §9.1 | Adicionar ao carrinho, comprar agora, frete por CEP, favoritar/compartilhar | — | `Product.tsx` | TESTADO | E2E-4, E2E-6, HTML-2/3 | — | — |
| R-123 | §9.1 | Relacionados, compre o visual, vistos recentemente | — | `Product.tsx`, `lib/recent.ts`, `/api/account/viewed` | IMPLEMENTADO | U-cat (relacionados) | Histórico sincronizado ao logar | — |
| R-124 | §9.1 | Lista de espera para reposição | — | `stock_alerts`, `engagement.ts` | TESTADO | U-mgt (aviso único) | — | E-mail real (Resend) |
| R-125 | §9.1 | Avaliações verificadas (sem inventar) e FAQ | — | `reviews`, `review_moderation`, `faq_items` | TESTADO | U-mgt (só após entrega, moderação) | Nenhuma avaliação semeada | — |
| R-126 | §9.1 | Variantes com identidade própria (SKU, preço, estoque, imagens) e validação no servidor | — | `product_variants`, `orders.ts` | TESTADO | U-cat, U-pay, U-acc | — | — |
| R-130 | §10 | Lookbook administrável (nome, descrição, capa, galeria, data, status, SEO, produtos, pontos) | — | `lookbooks`, `lookbook_images`, `AdminContent.tsx` (compositor) | TESTADO | E2E-8 (pontos visíveis), E2E-9 | Pontos só em peças visíveis | — |
| R-131 | §10 | Ponto mostra peça, preço, variantes; adicionar uma ou todas; esgotado/despublicado não aparece disponível | R-130 | `content/Editorial.tsx` | IMPLEMENTADO | HTML-3 (lookbook), VIS | Cada item com variante própria | — |
| R-140 | §11 | Journal com URLs, imagens, metadados e produtos relacionados | — | `journal_articles`, `pages/Editorial.tsx` | TESTADO | E2E-8, HTML-3 | — | Conteúdo real da GAZU |
| R-141 | §11 | Archive com produtos históricos e indisponibilidade correta | — | `collections` (archived) | TESTADO | E2E-8 | — | — |
| R-142 | §11 | Monte seu Look: tamanho/cor por peça, remover, adicionar individual/conjunto, subtotal, estoque no servidor, sem desconto automático | — | `/api/looks/builder`, `pages/Editorial.tsx` | IMPLEMENTADO | E2E-8, VIS | Estoque validado no servidor ao adicionar | — |
| R-150 | §12 | Favoritos sincronizados, visitante, migração após login | — | `favorites`, `store.tsx` | TESTADO | HTML-2, U-acc | — | — |
| R-151 | §12 | Carrinho lateral e página; quantidade, variante, subtotal, cupom, frete, total, persistência, sincronização segura | — | `CartDrawer`, `CartLine`, `cart.ts` | TESTADO | U-cat, E2E-4 | Troca de variante na linha | — |
| R-152 | §12 | Navegador não determina preço/desconto/disponibilidade | — | `orders.ts`, `cart.ts` | TESTADO | U-cat, U-pay (total divergente recusado) | — | — |

## Parte IV — Pagamentos, entrega e conta (§13–§15)

| ID | Seção | Requisito | Depende de | Módulos / arquivos | Status | Testes | Evidência | Pendência externa |
|---|---|---|---|---|---|---|---|---|
| R-200 | §13 | Integração oficial Mercado Pago: Pix, cartão (SDK oficial, sem dados de cartão no servidor), parcelamento, boleto | — | `services/payments/*`, `checkout/CardForm.tsx` | TESTADO | U-pay, U-ops (API simulada) | Somente token do cartão chega ao servidor | — |
| R-201 | §13 | Ativação dos pagamentos reais | R-200 | — | BLOQUEADO POR DEPENDÊNCIA EXTERNA | — | — | Conta MP, credenciais, HTTPS, webhook, compra autorizada |
| R-202 | §13.1 | `.env.example` com variáveis reais e sem segredos; nomes `MERCADOPAGO_*` aceitos | — | `.env.example`, `config.ts` | TESTADO | U-mgt (config pública sem segredos) | — | — |
| R-203 | §13.1 | Segredos nunca no navegador/logs/respostas | — | `audit.redact`, `/api/config` | TESTADO | U-mgt (auditoria omite segredos; config) | — | — |
| R-204 | §13.2 | Fluxo: validar → calcular → pedido → cobrança → ids → instruções → notificação → assinatura → consulta → atualização idempotente → estoque → comunicação | R-200 | `orders.ts`, `payments/index.ts`, `webhooks.ts`, `handlers.ts` | TESTADO | U-pay (fluxo Pix completo), U-ops | Retorno do navegador não aprova | — |
| R-205 | §13.3 | Webhook: HTTPS, assinatura, validação, registro, idempotência, duplicidade, fora de ordem, reprocessamento, reconciliação, logs limpos, operações financeiras protegidas | R-204 | `webhooks.ts`, `payment_events`, `jobs.ts` | TESTADO | U-pay (assinatura válida/adulterada/expirada, idempotência), U-ops (fora de ordem, reprocessamento) | HTTPS depende da hospedagem | Domínio HTTPS |
| R-206 | §13.3 | Estados: pendente, em processamento, aprovado, recusado, cancelado, expirado, reembolsado, parcialmente reembolsado; sem transições arbitrárias | R-204 | `canTransition` | TESTADO | U-ops (máquina de estados) | — | — |
| R-207 | §13.3 | Cancelamentos/estornos via provedor, concluídos só com confirmação | R-204 | `requestRefund`, `refunds` | TESTADO | U-ops (estorno total/parcial) | — | — |
| R-208 | §13.3, §16.4 | Não marcar pagamento como aprovado manualmente | — | `admin-orders.ts` | TESTADO | U-pay | — | — |
| R-209 | §13.4 | Integração só "ativa" com validação real | R-201 | `CHECKLIST-PRODUCAO.md` §3 | BLOQUEADO POR DEPENDÊNCIA EXTERNA | — | Procedimento documentado | Idem R-201 |
| R-220 | §14 | CEP (ViaCEP), validação de endereço, cálculo, prazo, modalidade, registro da opção | — | `shipping.ts`, `/api/cep` | TESTADO | U-cat (CEP inválido), E2E-4 | ViaCEP sem chave; falha → manual | — |
| R-221 | §14 | Cotação real, etiqueta, rastreio (Melhor Envio) | R-220 | `melhorenvio.ts`, `shipments.ts` | TESTADO | U-ops (Melhor Envio simulado) | Carrinho → checkout → gerar → imprimir | — |
| R-222 | §14 | Ativação do frete/etiquetas reais | R-221 | — | BLOQUEADO POR DEPENDÊNCIA EXTERNA | — | — | Token Melhor Envio, remetente, contrato/saldo |
| R-223 | §14 | Código/link de rastreio, histórico de eventos, gestão administrativa | R-221 | `shipments`, `shipment_events`, `AdminOrders.tsx`, `AdminShipments` | TESTADO | U-ops (envio exige rastreio), E2E-5 | — | — |
| R-224 | §14 | Estados separados de pagamento, preparação, envio, trânsito, entrega, cancelamento, devolução | — | `orders.status`, `payments.status`, `shipments.status` | TESTADO | U-ops | — | — |
| R-225 | §14 | Não inventar prazos/valores | — | frete demo sinalizado; manual pelo painel | TESTADO | U-cat | — | Regras reais da loja |
| R-230 | §15 | Cadastro, login, logout, recuperação, verificação de e-mail, perfil, endereços, favoritos, pedidos, pagamentos, rastreio, trocas | — | `auth.ts`, `account.ts`, `pages/Account.tsx` | TESTADO | U-acc, U-ops (trocas), E2E-4 | — | — |
| R-231 | §15 | Login com Google quando configurado | — | `auth/google.ts` | IMPLEMENTADO | — | Botão oculto sem credenciais | Cliente OAuth Google |
| R-232 | §15 | Checkout como visitante | — | `guest.ts`, `Checkout.tsx` | TESTADO | U-ops (token), E2E-6 | Link + cookie assinado | — |
| R-233 | §15 | Proteção de pedidos e dados pessoais | — | autorização por `user_id`/token | TESTADO | U-acc (pedido/endereço alheio), E2E-6 | — | — |
| R-234 | §15 | Páginas: ajuda, FAQ, entrega, pagamento, trocas, devoluções, cancelamento, contato, privacidade | — | `Static.tsx`, `pages`, `Support.tsx` | TESTADO | E2E-8 | Contato = Central de atendimento | Textos jurídicos aprovados pela GAZU |

## Parte V — Painel e gestão (§16–§20)

| ID | Seção | Requisito | Depende de | Módulos / arquivos | Status | Testes | Evidência | Pendência externa |
|---|---|---|---|---|---|---|---|---|
| R-300 | §16 | Painel protegido; permissões verificadas no servidor | — | `requirePermission`, `auth/permissions.ts` | TESTADO | U-acc, U-mgt (matriz), E2E-9 (atendimento sem financeiro) | Negações auditadas | — |
| R-301 | §16.1 | Dashboard: pedidos, receita, valores pagos, ticket, produtos vendidos, estoque baixo, cupons, campanhas, pendentes; bruto × pagos × descontos × cancelamentos × reembolsos × líquida × lucro | R-400 | `Admin.tsx`, `/api/admin/dashboard`, `financeSummary` | TESTADO | U-mgt (fórmulas), E2E-9 | Demo fora da conta | — |
| R-302 | §16.2 | Produtos: criar, editar, duplicar, publicar, despublicar, arquivar, excluir | — | `routes/admin.ts`, `AdminProducts.tsx` | TESTADO | U-adm (ciclo completo + auditoria), U-acc | — | — |
| R-303 | §16.2 | Imagens, variantes, SKUs, preços, estoque, promoções, categorias, atributos, medidas, SEO, custos | R-302 | idem | TESTADO | U-acc, U-adm | Custo por produto/variante | — |
| R-304 | §16.2 | Conteúdo: anúncios, banners, coleções, lookbooks, Journal, Archive, páginas, seções da home | — | `admin-content.ts`, `AdminContent.tsx`, `AdminSettings.tsx` | IMPLEMENTADO | E2E-9 | CRUD genérico com validação e auditoria | — |
| R-305 | §16.3 | Estoque por variante, ajustes, histórico, alertas, reservas, liberação de reservas expiradas, relatório de indisponibilidade | — | `inventory.ts`, `AdminInventory` | TESTADO | U-pay (reserva/devolução), U-acc (ajuste), U-adm (divergência) | — | — |
| R-306 | §16.3 | Concorrência: impedir compra acima do estoque | R-305 | `BEGIN IMMEDIATE` + `UPDATE … WHERE stock + ? >= 0` | TESTADO | U-pay (estoque insuficiente) | — | — |
| R-307 | §16.4 | Pedidos: itens, variantes, pagamentos, endereço, histórico, envio, rastreio, observações internas, trocas, reembolsos | — | `admin-orders.ts`, `AdminOrders.tsx` | TESTADO | U-ops (observação não vaza), E2E-5 | — | — |
| R-308 | §16.4 | Dados pessoais com acesso mínimo | R-300 | permissões `customers.read`/`customers.privacy` | TESTADO | U-mgt | — | — |
| R-309 | §16.5 | Funções/permissões e auditoria de ações críticas (quem, quando, resultado) | — | `audit_log`, `AdminAudit` | TESTADO | U-mgt (auditoria), U-adm | — | — |
| R-400 | §17 | Financeiro: bruto, pagos, descontos, cancelamentos, reembolsos, taxas, frete, embalagem, CMV, margem por produto, resultado, ticket | — | `finance.ts`, `AdminFinance` | TESTADO | U-mgt (fórmulas com dados controlados) | Exemplo em `FORMULAS-FINANCEIRAS.md` §7 | Custos reais |
| R-401 | §17 | Produtos e categorias mais vendidos; campanhas; histórico de movimentações | R-400 | `productMargins`, `categorySales`, `financialMovements`, campanhas | TESTADO | U-mgt (movimentações = resumo; categorias = receita de itens) | — | — |
| R-402 | §17 | Cadastro de custos e despesas; filtros por período; exportação | R-400 | `expenses`, CSV | TESTADO | U-mgt (CSV, proteção de fórmula) | — | — |
| R-403 | §17 | Fórmulas documentadas; sem dupla contagem; sem inventar custos; "não calculável" quando faltar dado | R-400 | `docs/FORMULAS-FINANCEIRAS.md` | TESTADO | U-mgt (custo/taxa ausente → nulo) | — | — |
| R-410 | §18 | Auditoria do catálogo: sem imagem, galeria, imagem quebrada, cor sem foto, preço, descrição, categoria, medidas, estoque indefinido/inconsistente, duplicados, promoção vencida, esgotado em campanha, categorias vazias, SEO, links inválidos | — | `catalog-audit.ts`, `AdminCatalogQuality` | TESTADO | U-mgt, U-adm | SKU sem valor é impossível (obrigatório no banco) | — |
| R-411 | §18 | Prioridade, contagem, abrir cadastro, bloquear publicação, não alterar dados automaticamente, registrar correções | R-410 | idem + `assertPublishable` | TESTADO | U-adm (422 com bloqueios), U-mgt | — | — |
| R-420 | §19 | Central de atendimento: categorias, status, histórico, responsável, notas internas protegidas, pendentes | — | `support.ts`, `AdminSupport` | TESTADO | U-mgt (nota interna nunca chega ao cliente), E2E-9 | — | — |
| R-421 | §19 | WhatsApp: link (sem fingir automação) e Cloud API com vínculo a cliente/pedido | — | `support.ts` (Cloud API), `WhatsAppFloat` | TESTADO | U-mgt (verificação, assinatura, idempotência, janela 24 h) | — | — |
| R-422 | §19 | Ativação da WhatsApp Cloud API | R-421 | — | BLOQUEADO POR DEPENDÊNCIA EXTERNA | — | — | Conta Meta Business, número, token |
| R-430 | §20 | Notificações: recebido, pago, pendente, preparação, enviado, rastreio, entregue, cancelado, reembolsado, trocas | — | `notifications.ts`, `handlers.ts` | TESTADO | U-ops (uma única vez por estado), U-id | Só após estado confirmado | — |
| R-431 | §20 | Envio real de e-mails | R-430 | `email.ts` (Resend) | BLOQUEADO POR DEPENDÊNCIA EXTERNA | — | Fila com status "registrado" | Conta Resend + domínio |
| R-432 | §20 | Página de acompanhamento (pagamento, preparo, entrega, rastreio, suporte) | — | `OrderView.tsx`, `/pedido/:n`, `/rastreio` | TESTADO | E2E-4, E2E-6, U-ops (rastreio público sem dados pessoais) | — | — |
| R-433 | §20 | Materiais: embalagem, etiquetas, cartão, adesivo, cuidados, troca/devolução (sem afirmar produção física) | R-013 | `public/assets/branding/print/*` | TESTADO | U-id (mm, sem preço impresso) | SVG + PDF + prova A4 | Gráfica |

## Parte VI — Dados, segurança e confiabilidade (§21–§23)

| ID | Seção | Requisito | Depende de | Módulos / arquivos | Status | Testes | Evidência | Pendência externa |
|---|---|---|---|---|---|---|---|---|
| R-500 | §21 | Modelo de dados com as entidades listadas + custos, despesas, atendimentos, analytics, consentimentos, monitoramento | — | `db/migrations/001–003` | TESTADO | todos os unitários usam o esquema | 60+ tabelas | — |
| R-501 | §21 | PostgreSQL/Supabase ou equivalente | — | SQLite (`node:sqlite`) | IMPLEMENTADO | — | Equivalente adotado; migração documentada (`ESCALABILIDADE.md` §3) | Decisão da GAZU se quiser Postgres |
| R-502 | §21 | IDs estáveis, FKs, restrições, índices, datas, soft delete, histórico de estoque, snapshots, centavos, migrations versionadas | R-500 | migrations, `order_items` (snapshot) | TESTADO | U-mgt (backup: foreign_key_check), U-pay | — | — |
| R-510 | §22 | Autenticação, autorização por função, validação, rate limiting, segredos protegidos, auditoria | — | `security.ts`, `validation.ts`, `http.ts` | TESTADO | U-acc (CSRF, acessos), U-mgt | RLS não se aplica (SQLite); autorização no servidor | — |
| R-511 | §22 | Solicitações de titulares, política de privacidade, termos, consentimento de comunicações | — | `privacy.ts`, `AdminPrivacy`, `consents` | TESTADO | U-mgt (LGPD, newsletter double opt-in) | — | Revisão jurídica |
| R-512 | §22 | Sem contas administrativas compartilhadas | R-300 | Equipe por conta própria | TESTADO | U-mgt (gestão de equipe), E2E-9 | — | — |
| R-520 | §23 | Monitorar erros, banco, APIs, checkout, pagamentos inconsistentes, webhooks, estoque, entrega, e-mail | — | `monitoring.ts`, `consistencyChecks`, `AdminOperations` | TESTADO | U-adm (divergências), U-ops (webhook com erro) | — | — |
| R-521 | §23 | Alertas para situações críticas | R-520 | `ALERT_EMAIL`, `ALERT_WEBHOOK_URL` | BLOQUEADO POR DEPENDÊNCIA EXTERNA | — | Código pronto; sem destino configurado | E-mail/webhook de alerta |
| R-522 | §23 | Backups: dados, frequência, retenção, acesso, restauração, integridade, responsáveis, recuperação documentados | — | `backup.ts`, `docs/OPERACAO-BACKUP.md` | TESTADO | U-mgt (backup + adulteração) | Restauração real executada em cópia (ver relatório) | Cópia externa e teste em produção |
| R-523 | §23 | Idempotência e reprocessamento (sem cobrança/baixa/confirmação duplicadas) | R-204 | `payment_events`, `notifications.dedupe_key` | TESTADO | U-pay, U-ops | — | — |
| R-524 | §23 | Logs sem tokens/senhas/cartão/dados desnecessários | — | `redact()`, `scrubText()` | TESTADO | U-mgt | — | — |

## Parte VII — Marketing, analytics e crescimento (§24–§26)

| ID | Seção | Requisito | Depende de | Módulos / arquivos | Status | Testes | Evidência | Pendência externa |
|---|---|---|---|---|---|---|---|---|
| R-600 | §24 | Cupons: regras, validade, limites totais e por cliente, escopo, cálculo no servidor, sem combinação indevida | — | `coupons.ts` | TESTADO | U-cat, U-adm (limite por cliente) | Um cupom por pedido | — |
| R-601 | §24 | Campanhas com links UTM, atribuição de pedidos e resultado (ROAS só com gasto) | — | `campaigns`, `orders.campaign_id`, `AdminMarketing` | TESTADO | U-adm (atribuição) | — | — |
| R-602 | §24 | Banners e coleções promocionais | — | conteúdo | IMPLEMENTADO | E2E-9 | — | — |
| R-603 | §24 | Newsletter com consentimento, confirmação e descadastro; e-mails de lançamento só com consentimento | — | `newsletter_subscribers`, `consents` | TESTADO | U-mgt (double opt-in, descadastro) | Exportação só de confirmados | Envio real (Resend) |
| R-604 | §24 | Recuperação de carrinho abandonado | — | `remindAbandonedCarts` | TESTADO | U-adm (único, só com consentimento) | — | Envio real (Resend) |
| R-605 | §24 | Vale-presente (quando implementado) | — | — | NÃO INICIADO | — | Opcional no Prompt Master; não implementado | Definição comercial |
| R-606 | §24 | Combinações de produtos | — | Monte seu Look, lookbook | IMPLEMENTADO | E2E-8 | Sem desconto automático | — |
| R-610 | §25 | Eventos: produto, busca, filtros, categorias, carrinho (+/−), checkout, abandono, compra, cupom, lookbook, vistos antes da compra, campanhas | — | `lib/analytics.ts`, `services/analytics.ts`, `AdminAnalytics` | TESTADO | U-mgt (analytics), E2E-7 | — | — |
| R-611 | §25 | Navegação ≠ transação; compra só de pagamento aprovado; sem visitantes/conversões inventados | R-610 | idem | TESTADO | U-mgt ("compra não vem do navegador") | — | — |
| R-612 | §25 | Consentimento e mínimo de dados pessoais | R-610 | faixa de cookies, sessão anônima | TESTADO | E2E-7, U-mgt (revogação apaga) | — | — |
| R-620 | §26 | Arquitetura para crescimento; componentes, índices, paginação, falhas, migrations; ambientes separados; decisões documentadas | — | `docs/ESCALABILIDADE.md`, `docs/DECISOES.md` | IMPLEMENTADO | — | Divisão de código do painel | — |

## Parte VIII — SEO, desempenho, acessibilidade e responsividade (§27–§29)

| ID | Seção | Requisito | Depende de | Módulos / arquivos | Status | Testes | Evidência | Pendência externa |
|---|---|---|---|---|---|---|---|---|
| R-700 | §27 | Metadados por página, títulos, descrições, URLs amigáveis, canonical, Open Graph | — | `render.ts` | IMPLEMENTADO | U-id (cabeçalho HTML) | HTML do servidor por rota | — |
| R-701 | §27 | Sitemap e robots | — | `sitemapXml`, `robotsTxt` | IMPLEMENTADO | — | `/sitemap.xml`, `/robots.txt` | Search Console |
| R-702 | §27 | Dados estruturados de produto com disponibilidade correta, sem avaliações inventadas | — | `render.ts` (JSON-LD) | IMPLEMENTADO | — | Avaliação só se existir | — |
| R-703 | §27 | Textos alternativos, links internos, 404, redirecionamentos | — | `NotFoundPage`, status 404 | TESTADO | VIS (404) | Redirecionamento de slugs antigos não implementado | — |
| R-710 | §28 | Imagens otimizadas (WebP, srcset), fontes, lazy loading, prioridade da imagem principal, divisão de código, cache | — | `process-images.mjs`, `render.ts`, `build.mjs` | IMPLEMENTADO | — | Painel em arquivo separado; cache imutável em `/build` | — |
| R-711 | §28 | Teclado, foco visível, contraste, rótulos, erros compreensíveis, semântica, modais com foco, movimento reduzido | — | `ui.tsx` (`Dialog`), tokens | TESTADO | E2E-2/3, testes usam rótulos acessíveis (getByLabel/getByRole) | Contrastes medidos | Auditoria com leitor de tela real |
| R-712 | §28 | Teste em dispositivos modestos e redes lentas | — | — | NÃO INICIADO | — | Não há dispositivos/rede limitada neste ambiente | Teste em aparelhos reais |
| R-720 | §29 | Responsivo: hero, menus, galerias, cards, filtros, formulários, carrinho, checkout, conta, painel; sem rolagem horizontal/texto cortado/sobreposição | — | CSS | TESTADO | VIS (5 tamanhos), capturas do painel 390/1440 | — | — |

## Parte IX — Testes e produção (§30–§31)

| ID | Seção | Requisito | Depende de | Módulos / arquivos | Status | Testes | Evidência | Pendência externa |
|---|---|---|---|---|---|---|---|---|
| R-800 | §30.1 | Testes de catálogo (CRUD, publicação, variantes, filtros, busca, ordenação, esgotados) | — | `tests/unit` | TESTADO | U-cat, U-adm, U-acc | — | — |
| R-801 | §30.2 | Testes de carrinho (quantidade, remoção, subtotal, cupons, revalidação) | — | idem | TESTADO | U-cat, U-adm | — | — |
| R-802 | §30.3 | Testes de pagamento no ambiente oficial do provedor | R-201 | — | BLOQUEADO POR DEPENDÊNCIA EXTERNA | U-pay, U-ops (com API simulada) | Cenários equivalentes cobertos com respostas simuladas | Credenciais de teste do MP |
| R-803 | §30.4 | Testes de segurança (painel, pedidos alheios, preço no navegador, acima do estoque, cupons, segredos, webhook sem assinatura) | — | idem | TESTADO | U-acc, U-pay, U-mgt | — | — |
| R-804 | §30.5 | Testes de entrega (CEP inválido, serviço indisponível, falha de cotação, rastreio, pedido sem envio) | — | idem | TESTADO | U-cat, U-ops | — | — |
| R-805 | §30.6 | Testes de finanças, auditoria do catálogo, permissões do atendimento, notas internas, notificações, idempotência, auditoria, consentimento, relatórios, recuperação | — | idem | TESTADO | U-mgt, U-ops, U-adm, U-id | — | — |
| R-806 | §30.7 | Testes de interface (hero, menus, galerias, modais, favoritos, lookbook, carrinho, checkout, formulários, institucionais, responsividade, teclado) | — | `tests/e2e` | TESTADO | E2E-1…9, HTML-1…5, VIS | — | — |
| R-807 | §30 | Vitest/Testing Library | — | — | IMPLEMENTADO | — | Substituídos por `node:test` + Playwright (pacotes indisponíveis offline) | — |
| R-810 | §31 | Ambientes, banco/migrations, arquivos, domínio/HTTPS, pagamentos, entrega, webhooks, e-mails, monitoramento, backups, logs, recuperação, documentação de publicação | — | `README.md` §13, `CHECKLIST-PRODUCAO.md` | BLOQUEADO POR DEPENDÊNCIA EXTERNA | — | Documentação pronta | Hospedagem, domínio e contas |
| R-811 | §31 | Sem credenciais no repositório; painel nunca exposto sem autenticação | — | `.gitignore`, `requirePermission` | TESTADO | U-acc (401/403) | ZIP sem `.env` e sem banco | — |
| R-812 | §31 | Não declarar pronto para vender com pendências críticas | — | `CHECKLIST-PRODUCAO.md` | IMPLEMENTADO | — | Estado declarado: **não pronto** | — |

## Parte X — Entregáveis (§32, OM §15)

| ID | Seção | Entregável | Status | Onde |
|---|---|---|---|---|
| R-900 | §32.1–17 | Código, estrutura, componentes, banco, auth, pagamentos, entrega, painel, catálogo, checkout, financeiro, auditoria, atendimento, pós-compra, analytics, monitoramento, testes | TESTADO (código) · BLOQUEADO (ativação) | repositório |
| R-901 | §32.18 | `.env.example` | IMPLEMENTADO | `.env.example` |
| R-902 | §32.19, 23–27 | README com instalação, banco, pagamentos/webhooks, entrega, publicação | IMPLEMENTADO | `README.md` |
| R-903 | §32.20 | Documento de identidade visual | IMPLEMENTADO | `docs/IDENTIDADE-VISUAL.md` |
| R-904 | §32.21 | Fórmulas financeiras | IMPLEMENTADO | `docs/FORMULAS-FINANCEIRAS.md` |
| R-905 | §32.22 | Decisões técnicas | IMPLEMENTADO | `docs/DECISOES.md` |
| R-906 | OM §15.13 | Integrações | IMPLEMENTADO | `docs/INTEGRACOES.md` |
| R-907 | §32.28 | Checklist de produção | IMPLEMENTADO | `docs/CHECKLIST-PRODUCAO.md` |
| R-908 | §32.29–30 | Relatórios de funcionalidades e de testes executados | IMPLEMENTADO | `docs/RELATORIO-TESTES.md`, resumo final |
| R-909 | §32.31–32 | Pendências e credenciais/serviços a configurar (sem pedir segredos) | IMPLEMENTADO | `docs/PENDENCIAS.md` |
| R-910 | §32.33 | ZIP completo | IMPLEMENTADO | `gazu-store.zip` |
| R-911 | §32 | HTML autônomo rotulado como não substituto | TESTADO | `site/index.html`, HTML-1…5 |
| R-912 | — | Operação, backups e recuperação; escalabilidade | IMPLEMENTADO | `docs/OPERACAO-BACKUP.md`, `docs/ESCALABILIDADE.md` |

---

### Resumo por estado (contagem automática das 143 linhas desta matriz)

| Estado | Quantidade |
|---|---|
| TESTADO | 90 |
| IMPLEMENTADO | 42 |
| BLOQUEADO POR DEPENDÊNCIA EXTERNA | 8 |
| TESTADO (código) · BLOQUEADO (ativação) | 1 (R-900, entregáveis de código) |
| NÃO INICIADO | 2 (R-605 vale-presente — opcional no Prompt Master; R-712 teste em dispositivos modestos/rede lenta) |
| CONFIGURADO / ATIVO EM PRODUÇÃO | 0 |

Os 8 bloqueios externos: pagamentos reais (R-201, R-209), frete/etiquetas reais (R-222), WhatsApp Cloud API (R-422),
envio real de e-mails (R-431), alertas (R-521), testes no ambiente oficial do Mercado Pago (R-802) e infraestrutura de
produção (R-810). Pagamentos, frete e WhatsApp têm o código testado com respostas simuladas do provedor; e-mail e alertas
têm o código pronto (e-mail fica na fila como "registrado"); a infraestrutura tem a documentação pronta. O procedimento de
ativação está em `docs/INTEGRACOES.md` e `docs/CHECKLIST-PRODUCAO.md`.
