# Fórmulas financeiras — GAZU

Implementação: `src/server/services/finance.ts` (resumo, margem por produto, CSV) e `src/server/routes/management.ts`
(rotas `/api/admin/finance/*`, permissão `finance.read`). Testes: `tests/unit/management.test.ts` (fórmulas com dados
controlados, exclusão de demonstração, custos ausentes, CSV).

> Os números do painel não substituem a contabilidade da empresa nem a apuração fiscal. Impostos sobre a venda
> (ex.: Simples Nacional, ICMS, ISS) **não** são calculados automaticamente: lance-os como despesa (categoria
> "impostos") a partir da apuração do contador.

## 1. Regras gerais

| Regra | Como é aplicada |
|---|---|
| Somente dados reais | Pedidos com `orders.is_demo = 1` e pagamentos com `payments.provider = 'demo'` nunca entram. |
| Reconhecimento da receita | Data de **aprovação pelo provedor** (`payments.approved_at`), não a data do pedido. |
| Estornos | Data em que o provedor **confirmou** o estorno (`refunds.confirmed_at`, `refunds.status = 'approved'`). |
| Período | Datas `de`/`até` no fuso de Brasília (UTC−3), fim inclusivo; máximo de 2 anos; padrão: últimos 30 dias. |
| Valores | Inteiros em centavos (sem ponto flutuante); exibidos em R$. |
| Dados ausentes | **Nada é estimado.** Se faltar um custo, o indicador que depende dele fica "—" (nulo) e o motivo aparece em "Rentabilidade não pode ser calculada com precisão". |
| Pagamentos considerados | `payments.status ∈ {approved, partially_refunded, refunded}` (já foram aprovados; o estorno é descontado à parte). |

## 2. Indicadores

Seja **P** o conjunto de pedidos cujo pagamento foi aprovado no período (regras acima).

| Indicador | Fórmula |
|---|---|
| Faturamento bruto (produtos) | Σ `orders.subtotal_cents` de P (preço dos itens já com promoção, antes de cupom e frete) |
| Descontos concedidos | Σ `orders.discount_cents` de P (cupons) |
| Frete cobrado | Σ `orders.shipping_cents` de P |
| Valores pagos (provedor) | Σ `payments.amount_cents` de P (valor efetivamente aprovado) |
| Reembolsos confirmados | Σ `refunds.amount_cents` com `status = 'approved'` e `confirmed_at` no período |
| **Receita líquida** | Valores pagos − Reembolsos confirmados |
| Taxas do provedor | Σ `payments.fee_cents` de P — nulo se algum pagamento não tiver a taxa informada pelo provedor |
| Custo dos produtos (CMV) | Σ `order_items.unit_cost_cents × quantity` dos itens de P — nulo se algum item não tiver custo |
| Custo de frete | Σ `shipments.cost_cents` (envios não cancelados) dos pedidos de P — nulo se algum pedido não tiver custo registrado |
| Embalagem | Σ `orders.packaging_cost_cents` de P — nulo se algum pedido não tiver o valor |
| Despesas | Σ `expenses.amount_cents` (não excluídas) com `incurred_on` no período |
| **Lucro estimado** | Receita líquida − Taxas − Custo dos produtos − Custo de frete − Embalagem − Despesas · nulo se qualquer parcela for nula |
| Margem (%) | Lucro estimado ÷ Receita líquida × 100, com 1 casa decimal · nula se o lucro for nulo ou a receita for zero |
| Ticket médio | Valores pagos ÷ quantidade de pedidos em P (arredondado ao centavo) · nulo sem pedidos |
| Cancelamentos | Quantidade de pedidos reais com `cancelled_at` no período |
| Pedidos reembolsados | Quantidade de pedidos distintos com estorno confirmado no período |

### Por dia, por forma de pagamento e despesas por categoria
- **Por dia:** Valores pagos e quantidade de pedidos agrupados pelo dia da aprovação (horário de Brasília).
- **Por forma de pagamento:** mesmo cálculo agrupado por `payments.method` (pix, cartão, boleto).
- **Despesas por categoria:** Σ por `expenses.category`.

### Margem por produto
Para cada produto vendido em P: unidades = Σ `quantity`; receita = Σ `line_total_cents`; custo = Σ `unit_cost_cents × quantity`
(nulo se alguma venda do produto não tiver custo); margem = (receita − custo) ÷ receita × 100.
A receita por produto **não** desconta cupons do pedido nem estornos (é a receita de itens).

## 3. Origem de cada custo

| Custo | Origem | Momento em que é fixado |
|---|---|---|
| Custo do produto | Painel › Produto › "Custo unitário" (ou custo próprio da variante, que tem prioridade) | Copiado para `order_items.unit_cost_cents` na criação do pedido — mudanças posteriores não alteram vendas passadas. |
| Taxa do provedor | Resposta do Mercado Pago (`fee_details`); sem o campo = nulo, lista vazia = 0 | Webhook / sincronização do pagamento. |
| Frete pago à transportadora | Etiqueta do Melhor Envio (custo da compra) ou valor informado manualmente no envio | Registro/compra do envio. |
| Embalagem | Configurações › Operação › custo de embalagem por pedido | Copiado para `orders.packaging_cost_cents` na criação do pedido. Vazio = desconhecido. |
| Despesas | Financeiro › Despesas (lançamentos manuais com data e categoria; exclusão lógica) | Lançamento. |

## 4. Campanhas (Marketing)
- **Pedidos e receita da campanha:** pedidos reais com `orders.campaign_id` (atribuído pelo `utm_campaign` da primeira
  visita da sessão) e pagamento aprovado; receita = Σ `payments.amount_cents`.
- **Gasto:** Σ despesas vinculadas à campanha (`expenses.campaign_id`).
- **ROAS** = receita ÷ gasto, 2 casas — só aparece quando há gasto registrado.

## 5. Painel inicial
"Últimos 30 dias" na Visão geral usa exatamente o mesmo `financeSummary()` (somente para quem tem `finance.read`).

## 6. Exportação CSV
`/api/admin/finance/export.csv?de=AAAA-MM-DD&ate=AAAA-MM-DD` — uma linha por pagamento aprovado no período, separador `;`,
vírgula decimal, BOM UTF-8 (abre corretamente no Excel). Colunas: pedido, aprovado_em, metodo, parcelas, produtos,
descontos, frete_cobrado, total_pedido, valor_pago, taxa_provedor, liquido_provedor, estornado, status_pedido,
custo_embalagem, custo_produtos, custo_frete, utm_source, utm_campaign. Células que começam com `= + - @` recebem `'`
na frente (proteção contra injeção de fórmulas). Cada exportação é registrada na auditoria.

## 7. Exemplo verificado (teste automatizado `financeiro: fórmulas…` em `tests/unit/management.test.ts`)

| Pedido | Produtos | Cupom | Frete cobrado | Pago | Taxa | Custo itens | Frete pago | Embalagem |
|---|---|---|---|---|---|---|---|---|
| A | 200,00 | 20,00 | 15,00 | 195,00 | 0,99 | 2 × 40,00 | 18,00 | 3,00 |
| B | 100,00 | — | — | 100,00 | 0,50 | 1 × 35,00 | 0,00 | 3,00 |

Mais: estorno **confirmado** de 25,00 (um estorno ainda pendente é ignorado) e despesas de 30,00 no período.
Excluídos do cálculo: pedido de demonstração, pedido não pago, pedido aprovado fora do período e pagamento do provedor simulado.

- Valores pagos = 295,00 · Receita líquida = 295,00 − 25,00 = **270,00**
- Lucro estimado = 270,00 − 1,49 − 115,00 − 18,00 − 6,00 − 30,00 = **99,51** · Margem = 99,51 ÷ 270,00 = **36,9%**
- Ticket médio = 295,00 ÷ 2 = **147,50**
- Ao incluir um pedido com item sem custo cadastrado, o lucro e a margem passam a "—" e o motivo é listado; o mesmo vale para taxa ausente.
