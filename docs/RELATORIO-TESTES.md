# Relatório de testes — GAZU

Execução: 16/10/2026 · Node 22.22 · Chromium (Playwright 1.56) · Linux.
Todos os testes abaixo foram **executados** nesta data; nenhum resultado foi presumido.

## Resumo

| Verificação | Comando | Resultado |
|---|---|---|
| Build de produção (cliente + servidor) | `npm run build` | ✓ sem erros |
| TypeScript estrito — servidor e tipos compartilhados | `npm run typecheck:server` | ✓ 0 erros |
| TypeScript — cliente | ver nota | ✓ 0 erros (com tipos React simplificados) |
| Testes de API, regras de negócio e segurança | `npm test` | ✓ **22/22** |
| Testes ponta a ponta no navegador | `npm run test:e2e` | ✓ **5/5** |
| Revisão visual automatizada (10 páginas × 5 resoluções) | `npm run test:visual` | ✓ **50/50** sem problemas detectados |
| Revisão visual manual (comparação lado a lado com as referências) | capturas | ✓ ver seção abaixo |
| Versão HTML autônoma aberta como arquivo (sem servidor) | `npm run test:html` | ✓ **4/4** (hero, catálogo/produto/busca, compra completa no celular, painel) |

**Nota sobre o TypeScript do cliente:** o ambiente desta entrega não tinha acesso ao registro npm e os pacotes `@types/react`/`@types/react-dom` não estavam instalados. O cliente foi verificado com declarações simplificadas de React (descartando apenas erros que dependem dessas declarações). Após `npm install`, rode `npm run typecheck` para a verificação completa com os tipos oficiais.

## Testes de API e regras (`tests/unit`, banco em memória, Mercado Pago simulado)

- ✓ cadastro inválido e login inválido
- ✓ sessão: login, /me e logout
- ✓ cliente não acessa pedido de outro cliente
- ✓ cliente não acessa endereços de outro cliente
- ✓ painel: visitante e cliente comum recebem 401/403; admin acessa
- ✓ admin: altera preço, cria variante, ajusta estoque e registra rastreio
- ✓ requisições de outra origem são bloqueadas (CSRF)
- ✓ catálogo: categoria, filtros, ordenação e busca sem acento
- ✓ produto: variantes, relacionados e 404
- ✓ home: vitrines não repetem produtos
- ✓ sacola: preço vem do servidor, estoque limita quantidade e itens inexistentes são ignorados
- ✓ cupom: válido, abaixo do mínimo e inexistente
- ✓ frete: CEP inválido não gera cotação; demonstração é sinalizada
- ✓ assinatura do webhook: válida, adulterada, segredo errado e expirada
- ✓ mapeamento de status do Mercado Pago
- ✓ checkout exige login
- ✓ pedido: total divergente do servidor é recusado (sem alterar preço)
- ✓ pedido: estoque insuficiente é recusado no servidor
- ✓ fluxo completo Pix: reserva estoque, webhook assinado aprova, evento repetido é idempotente
- ✓ valor divergente informado pelo provedor não aprova o pedido
- ✓ webhook de pedido inexistente é ignorado
- ✓ cancelamento pelo cliente devolve estoque; admin não pode marcar como pago

## Testes ponta a ponta (`tests/e2e/run.mjs`, navegador real, banco temporário)

- ✓ hero: 4 modelos em ordem, permanência ≈3 s, retorno ao 1º, sem palco vazio, palavra fixa
- ✓ hero: controles anterior/próximo/pausa funcionam
- ✓ movimento reduzido: hero estático (sem troca automática)
- ✓ compra completa: variante → sacola → cadastro → checkout → pagamento simulado aprovado
- ✓ painel: admin registra envio com rastreio; cliente comum não acessa /admin

Medições do hero: permanência de cada modelo na posição final entre 2,8 s e 3,3 s (alvo do PRD: ≈3 s); nenhuma amostra com palco vazio após a primeira entrada; a palavra GAZU manteve posição e tamanho idênticos durante todas as trocas (amostragem a cada 50 ms por 21 s).

## Revisão visual automatizada (`tests/e2e/visual.mjs`)

Verifica em cada captura: rolagem horizontal, imagens deformadas, textos cortados, colisão do menu com a logomarca e erros no console do navegador.

Resoluções: desktop 1440×900 · notebook 1280×720 · tablet 820×1180 · celular 390×844 · celular pequeno 360×740.

| Página | desktop | notebook | tablet | celular | celular-pequeno |
|---|---|---|---|---|---|
| home | ✓ | ✓ | ✓ | ✓ | ✓ |
| produto | ✓ | ✓ | ✓ | ✓ | ✓ |
| produto-esgotado | ✓ | ✓ | ✓ | ✓ | ✓ |
| categoria | ✓ | ✓ | ✓ | ✓ | ✓ |
| tenis | ✓ | ✓ | ✓ | ✓ | ✓ |
| busca | ✓ | ✓ | ✓ | ✓ | ✓ |
| sacola | ✓ | ✓ | ✓ | ✓ | ✓ |
| entrar | ✓ | ✓ | ✓ | ✓ | ✓ |
| entrega | ✓ | ✓ | ✓ | ✓ | ✓ |
| 404 | ✓ | ✓ | ✓ | ✓ | ✓ |

## Problemas encontrados e corrigidos nesta revisão

| Problema | Onde | Causa | Correção |
|---|---|---|---|
| Site não abria | geral | Folha de estilos, ponto de entrada, scripts de build e telas do painel ausentes | Implementados |
| Palavra GAZU estreita (76% da largura vs 85% na referência) e letras juntas | Hero | Escala e espaçamento | Escala 28vw, espaçamento 0,085em |
| Menu de 6 itens encostando na logomarca | Cabeçalho ≥1200 px | Largura do menu maior que a coluna | Fonte/espaçamento ajustados; abaixo de 1200 px usa gaveta; verificação automática adicionada |
| "COMPRAR MASCULINO" invadindo a foto vizinha | Faixa de categorias | Texto do botão longo para 5 colunas | Rótulo "Comprar →" (título já identifica a categoria) |
| Modelo cobrindo o meio da palavra no celular ("G … U") | Hero ≤1023 px | Proporção desktop aplicada a tela estreita | Palavra no topo do palco, cabeça do modelo sobre a base das letras |
| Botão de compra abaixo da dobra em notebook 720 px | Produto | Espaçamentos para telas altas | Compactação apenas para telas baixas (media query de altura) |
| Faixa lateral vazia | Produto | "Relacionados" buscava só na subcategoria exata | Busca no departamento, priorizando a subcategoria |
| Produtos repetidos entre "Novidades" e "Roupas" | Home | Consultas independentes | Vitrines excluem produtos já exibidos |
| Margens do rodapé diferentes das seções | Global | Dois recuos distintos | Recuo de conteúdo único (≈7,2%), cabeçalho mais próximo da borda (como na referência) |
| Aviso cobrindo "Finalizar compra" | Gaveta da sacola | Toasts no canto inferior direito | Toasts no canto inferior esquerdo (desktop) e no topo (celular) |
| "Selecione um tamanho" em verde (parecia sucesso) | Produto | Estado neutro com cor de sucesso | Cor neutra |
| Produtos "esgotados" de demonstração com estoque | Seed | Comparação de `slug:cor` com `slug` | Corrigido; teste cobre |
| `db:seed --reset` falhava | Seed | Ordem de exclusão das categorias (chave estrangeira) | Subcategorias excluídas primeiro |
| Histórico com status em inglês ("shipped") | Pedido | Código interno exibido ao cliente | Rótulos em português |
| Bordas da tabela desalinhadas e campos desnivelados | Painel | `display:flex` em `<td>`; grade esticando campos | Corrigido |

## Não testado nesta entrega (depende de contas externas)

- Pagamento real ou de teste no Mercado Pago (a integração foi testada contra um servidor simulado com o formato da API; requer credenciais TEST para validar ponta a ponta).
- Recebimento de webhook real (requer domínio HTTPS).
- Login com Google (requer credenciais OAuth).
- Envio real de e-mail (requer conta Resend).
- Navegadores Safari/iOS e Firefox (testes feitos em Chromium com emulação de celular).
