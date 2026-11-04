# Relatório de testes — GAZU

Execução final: **18/10/2026** · Node 22 · Chromium (Playwright 1.56) · Linux (contêiner sem acesso ao registro npm).
Todos os resultados abaixo foram **executados** nesta data; nenhum foi presumido. Integrações externas foram testadas com
respostas simuladas no formato das APIs oficiais (não há credenciais da GAZU neste ambiente).

## Resumo

| Verificação | Comando | Resultado |
|---|---|---|
| Build de produção (cliente com divisão de código + servidor) | `npm run build` | ✓ sem erros nem avisos |
| TypeScript estrito — servidor e tipos compartilhados | `npm run typecheck:server` | ✓ 0 erros |
| TypeScript — cliente + versão HTML (tipos React simplificados) | `tsc -p scripts/typecheck-offline` | ✓ nenhum erro além de 46 avisos TS7006/TS7031 causados pelo shim (ver nota) |
| Testes de API, regras de negócio, segurança e integrações simuladas | `npm test` | ✓ **61/61** |
| Testes ponta a ponta no navegador (servidor e banco temporários) | `npm run test:e2e` | ✓ **9/9** |
| Revisão visual automatizada (20 páginas × 5 tamanhos) | `npm run test:visual` | ✓ **100/100** sem problemas detectados |
| Versão HTML autônoma aberta como arquivo | `npm run test:html` | ✓ **5/5** |
| Painel administrativo — capturas em 390, 820 e 1440 px (18 telas) | script de captura | ✓ sem erros de console, HTTP ≥ 400 ou rolagem horizontal |
| Backup → verificação → restauração em banco novo | `npm run backup` / `npm run restore` | ✓ contagens idênticas, `quick_check = ok` |
| ZIP de entrega extraído em pasta limpa | `npm run build` + `npm test` + migrations em banco novo | ✓ build sem erros, 61/61, 3 migrations aplicadas |

**Nota sobre o TypeScript do cliente:** sem acesso ao registro npm, `@types/react`/`@types/react-dom` não puderam ser
instalados. O cliente foi verificado com declarações simplificadas de React (`scripts/typecheck-offline/react-shim.d.ts`).
Os únicos avisos restantes (TS7006/TS7031 — parâmetros de eventos sem tipo inferido) existem porque o shim não tipa os
eventos do JSX; não indicam erro do projeto. Após `npm install` com internet, `npm run typecheck` faz a verificação completa.

## Testes de API e regras (`tests/unit`, servidor HTTP real + banco em memória)

**access** — cadastro/login inválidos · sessão (login, /me, logout) · cliente não acessa pedido nem endereço de outro ·
visitante/cliente recebem 401/403 no painel · admin altera preço, cria variante, ajusta estoque e registra rastreio ·
CSRF (outra origem bloqueada).

**catalog-cart** — categoria, filtros, ordenação e busca sem acento · variantes, relacionados e 404 · vitrines da home sem
repetição · sacola com preço do servidor e estoque limitado · cupom válido/abaixo do mínimo/inexistente · CEP inválido e
frete de demonstração sinalizado.

**checkout-payments** — assinatura do webhook (válida, adulterada, segredo errado, expirada) · mapeamento de status do
Mercado Pago · checkout autenticado exige login · total divergente recusado · estoque insuficiente recusado · fluxo Pix
completo com evento repetido idempotente · valor divergente do provedor não aprova · webhook de pedido inexistente ignorado ·
cancelamento devolve estoque e admin não marca como pago.

**commerce-ops** — máquina de estados sem regressão · evento fora de ordem ignorado · em processamento → aprovado com
notificação única · boleto (CPF, link, reserva) · parcelamento limitado ao configurado · estorno total e parcial só após
confirmação, com permissões · webhook com provedor indisponível reprocessado pela reconciliação · visitante só com token e
rastreio público sem dados pessoais · envio exige rastreio e notifica uma vez; observação interna não vaza · trocas e
devoluções (prazos legais, quantidades, reposição, estorno vinculado) · Melhor Envio (carrinho → checkout → gerar → imprimir).

**management** — fórmulas financeiras com dados controlados (inclui exclusão de demonstração/pendentes/fora do período,
custo e taxa ausentes, **movimentações = resumo** e **vendas por categoria = receita de itens**) · rota financeira exige
permissão e CSV neutraliza fórmulas · analytics sem consentimento não grava, revogação apaga, compra não vem do navegador ·
auditoria registra ações críticas sem segredos · matriz de funções e gestão da equipe · atendimento por token e nota
interna nunca enviada ao cliente · WhatsApp Cloud API (verificação, assinatura, idempotência, janela de 24 h) · newsletter
double opt-in e descadastro · lista de espera com aviso único · avaliações só após entrega, com moderação · LGPD (exportação
e anonimização) · backup (cópia consistente, SHA-256, teste de restauração, detecção de adulteração) · produto sem imagem
não publica · configuração pública sem custos nem segredos.

**catalog-admin** — busca com erro de digitação ("camiseya" → "camiseta") e sugestões só de termos reais · filtros de
novidades e coleção combinados · ciclo do produto (rascunho → bloqueio de publicação → publicar → despublicar → arquivar →
duplicar → lixeira → restaurar) com auditoria e 403 sem permissão · categoria com dependências não é excluída · cupom com
limite por cliente · atribuição de pedidos a campanhas por UTM (sem ROAS sem gasto) · carrinho abandonado (lembrete único,
só com consentimento) · verificação de consistência detecta pedido pago sem pagamento e estoque divergente.

**identity** — e-mails de conta com logotipo e versão texto · modelo de e-mail sem contato/CNPJ inventados · limpeza do
corpo de e-mails de acesso após 3 dias · kit de marca (arquivos, SVG em milímetros, sem preço impresso, manifesto) ·
HTML com manifesto, cor do tema e ícones.

## Testes ponta a ponta (`tests/e2e/run.mjs`)

| # | Cenário | Resultado | Tempo |
|---|---|---|---|
| 1 | Hero: 4 modelos em ordem, permanência ≈3 s, retorno ao 1º, sem palco vazio, palavra fixa | ✓ | 22,6 s |
| 2 | Hero: controles anterior/próximo/pausa | ✓ | 9,5 s |
| 3 | Movimento reduzido: hero estático | ✓ | 6,4 s |
| 4 | Compra completa no celular: variante → sacola → cadastro → checkout → pagamento simulado aprovado | ✓ | 7,7 s |
| 5 | Painel: admin registra envio com rastreio; visitante recebe 401 na API do painel | ✓ | 2,2 s |
| 6 | Compra sem cadastro: visitante paga e acompanha pelo link; sem token, sem acesso | ✓ | 3,0 s |
| 7 | Cookies: nenhum evento de analytics antes do consentimento nem após recusa | ✓ | 3,2 s |
| 8 | 15 páginas editoriais/institucionais sem erro de console, com título; lookbook com pontos | ✓ | 12,5 s |
| 9 | 18 módulos do painel sem erros nem HTTP ≥ 400; função Atendimento recebe 403 no financeiro e 200 na central | ✓ | 17,4 s |

Resultado: **9/9 cenários aprovados** (execução final com rotinas desligadas e backups em pasta temporária).

Medição do hero (asserções do teste): ordem 0,1,2,3,0; permanência de cada modelo entre 2,8 s e 3,3 s; nenhuma amostra
com palco vazio; palavra GAZU com posição e tamanho constantes (amostragem a cada 50 ms).

## Versão HTML autônoma (`tests/e2e/standalone.mjs`, arquivo aberto via `file://`)

| # | Cenário | Resultado |
|---|---|---|
| 1 | Abre sem servidor; hero com 4 modelos alterna; nenhuma imagem quebrada; fonte carregada | ✓ |
| 2 | Catálogo com filtro, produto, favoritos e busca | ✓ |
| 3 | Conteúdo editorial: coleções, lookbook (imagens embutidas), journal, FAQ, Monte seu look | ✓ |
| 4 | Compra completa no celular com pagamento simulado; persiste após recarregar | ✓ |
| 5 | Painel de demonstração (entrada sem senha), menu só com módulos locais, envio com rastreio, ajuste de estoque | ✓ |

Resultado: **5/5 cenários aprovados**, sem erros de console.

## Revisão visual (`tests/e2e/visual.mjs`)

Verifica em cada captura: rolagem horizontal, imagens deformadas, textos cortados, colisão do menu com a logomarca e erros
no console. Tamanhos: desktop 1440×900 · notebook 1280×720 · tablet 820×1180 · celular 390×844 · celular pequeno 360×740.
Páginas: home, produto, produto esgotado, categoria, tênis, busca, sacola, entrar, entrega, coleções, coleção, lookbook,
journal, artigo, monte seu look, ajuda, atendimento, rastreio, checkout e 404 — **100/100 sem problemas**.

## Problemas encontrados e corrigidos neste ciclo

| Problema | Onde | Correção |
|---|---|---|
| Rolagem horizontal de 15 px em tablet (820 px) | Newsletter do rodapé | Coluna do formulário com `minmax(0, 1fr)` e `min-width: 0` |
| Prévias de arquivos cortadas/estouro de 93 px | Painel › Marca | Prévia posicionada com `object-fit: contain` |
| Botões "Novo(a) despesa" | Painel (CRUD genérico) | Gênero por recurso ("Nova despesa", "Novo aviso") |
| "Lucro estimado: dados insuficientes" mostrado com valor 0 | Financeiro | Texto distingue "faltam custos" de "sem receita no período" |
| Integrações com nomes internos em inglês | Painel › Operação | Rótulos em português e "não configurado" em destaque |
| Chave `}` solta no CSS | `admin.css` | Removida (aviso do esbuild zerado) |
| Saída do retrato do servidor truncada em 64 KB | `standalone-seed.ts` | Encerrar o processo só após o *flush* do stdout |
| Testes de navegador esperando a URL errada (`returnTo=/admin` casava com `/admin$`) | `tests/e2e/run.mjs` | Espera pelo `pathname` exato |
| Rótulo "Cidade" ambíguo ("Política de privaCIDADE") | testes e2e | Rótulos exatos |
| Faixa de cookies cobrindo botões nos fluxos | testes e2e | Escolha registrada antes do fluxo; a faixa tem cenário próprio |
| Servidor de teste gravando backups automáticos na pasta do projeto | `tests/e2e/run.mjs` | Rotinas desligadas e `BACKUP_DIR` temporário |
| Credencial do painel publicada na versão HTML | `src/standalone` | Entrada por botão, senha aleatória descartada |
| Painel da versão HTML mostrando módulos que dependem de servidor | `Admin.tsx` | Menu restrito aos módulos locais + aviso |
| Ativar variante apagava o custo da variante | `AdminProducts.tsx` | Custo preservado; edição de preço/custo por variante |

## Não testado nesta entrega (depende de contas ou recursos externos)

- Pagamento no **ambiente oficial de testes** do Mercado Pago e webhook real (requer credenciais e domínio HTTPS).
- Etiqueta real/sandbox do Melhor Envio (requer token).
- Envio real de e-mail (Resend), login com Google, WhatsApp Cloud API real, alertas reais.
- Cópia externa de backups e teste de restauração **em produção**.
- Safari/iOS, Firefox, aparelhos modestos e rede lenta (testes em Chromium com emulação de celular).
- Leitor de tela real (a navegação por teclado e os rótulos acessíveis são exercitados pelos testes).
