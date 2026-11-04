# GAZU — loja virtual de moda

E-commerce completo da marca **GAZU**: vitrine editorial administrável com hero animado dos quatro modelos, catálogo com
filtros e busca tolerante a erros, página de produto completa, lookbook comprável, Journal, Archive e Monte seu Look,
sacola persistente, cadastro/login (e-mail e Google) e compra sem cadastro, checkout com frete e cupom, pagamentos via
Mercado Pago (Pix, cartão pelo SDK oficial, boleto, parcelamento, estornos), webhooks verificados, envio e rastreio
(Melhor Envio), trocas e devoluções, central de atendimento (+ WhatsApp), notificações, LGPD, analytics com consentimento
e um painel com financeiro, auditoria do catálogo, estoque, marketing, operação (rotinas, backups, alertas), equipe e
auditoria.

> **Estado: implementado e testado em desenvolvimento — NÃO está pronto para vender.** O catálogo inicial (98 produtos)
> é de **demonstração** (preços, estoques e cores ilustrativos, sinalizados). Pagamentos, frete, e-mails e alertas reais
> dependem de contas e credenciais da GAZU. Veja [docs/CHECKLIST-PRODUCAO.md](docs/CHECKLIST-PRODUCAO.md),
> [docs/PENDENCIAS.md](docs/PENDENCIAS.md) e a matriz [docs/REQUISITOS.md](docs/REQUISITOS.md).

### Documentação

| Documento | Conteúdo |
|---|---|
| [docs/REQUISITOS.md](docs/REQUISITOS.md) | Matriz de rastreabilidade (143 requisitos, status, testes, evidências) |
| [docs/RELATORIO-TESTES.md](docs/RELATORIO-TESTES.md) | Resultados reais da última execução |
| [docs/CHECKLIST-PRODUCAO.md](docs/CHECKLIST-PRODUCAO.md) | O que falta para vender, em ordem |
| [docs/PENDENCIAS.md](docs/PENDENCIAS.md) | Credenciais/serviços a configurar, dados da loja, pendências técnicas |
| [docs/INTEGRACOES.md](docs/INTEGRACOES.md) | Mercado Pago, Melhor Envio, Resend, Google, WhatsApp, alertas — ativação passo a passo |
| [docs/FORMULAS-FINANCEIRAS.md](docs/FORMULAS-FINANCEIRAS.md) | Indicadores financeiros e exemplo verificado |
| [docs/IDENTIDADE-VISUAL.md](docs/IDENTIDADE-VISUAL.md) | Sistema de marca, materiais impressos, tom de voz |
| [docs/OPERACAO-BACKUP.md](docs/OPERACAO-BACKUP.md) | Rotinas, monitoramento, backups e recuperação |
| [docs/ESCALABILIDADE.md](docs/ESCALABILIDADE.md) | Crescimento, migração para PostgreSQL, como estender |
| [docs/DECISOES.md](docs/DECISOES.md) | Decisões técnicas |
| [docs/INVENTARIO-IMAGENS.md](docs/INVENTARIO-IMAGENS.md) | Inventário das fotos fornecidas |

## Sumário

1. [Pré-requisitos](#1-pré-requisitos)
2. [Instalação e primeira execução](#2-instalação-e-primeira-execução)
3. [Comandos](#3-comandos)
4. [Estrutura do projeto](#4-estrutura-do-projeto)
5. [Banco de dados e migrations](#5-banco-de-dados-e-migrations)
6. [Primeiro administrador](#6-primeiro-administrador)
7. [Login com Google (OAuth)](#7-login-com-google-oauth)
8. [Pagamentos — Mercado Pago](#8-pagamentos--mercado-pago)
9. [Webhooks](#9-webhooks)
10. [Frete](#10-frete)
11. [E-mails](#11-e-mails)
12. [Testes](#12-testes)
13. [Implantação (produção)](#13-implantação-produção)
14. [Identidade visual e imagens](#14-identidade-visual-e-imagens)
15. [Segurança](#15-segurança)
16. [Versão HTML autônoma](#16-versão-html-autônoma-distindexhtml)
17. [Painel administrativo e funções](#17-painel-administrativo-e-funções)
18. [Operação, backups e monitoramento](#18-operação-backups-e-monitoramento)

---

## 1. Pré-requisitos

- **Node.js 22.13 ou superior** (recomendado: 22 LTS). O banco usa o módulo nativo `node:sqlite`; não é preciso instalar banco de dados, Docker nem serviços externos para rodar localmente.
- npm 10+.

Verifique com `node -v`.

## 2. Instalação e primeira execução

```bash
npm install
cp .env.example .env          # Windows: copy .env.example .env
# edite o .env e defina SESSION_SECRET (comando de geração está no próprio arquivo)
npm run db:migrate            # cria as tabelas (também roda automaticamente ao iniciar o servidor)
npm run db:seed               # catálogo de demonstração a partir das fotos fornecidas
npm run admin:create -- voce@seudominio.com.br
npm run dev
```

Abra **http://localhost:3000**. O painel fica em **/admin** (entre com a conta criada acima).

O `.env.example` já vem com `PAYMENT_PROVIDER=demo` e `SHIPPING_PROVIDER=demo`, que simulam pagamento e frete **apenas em desenvolvimento** (ambos são bloqueados quando `NODE_ENV=production`). Assim é possível percorrer a compra inteira sem credenciais.

## 3. Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor com recarga automática + recompilação do front-end |
| `npm run build` | Gera `public/build` (JS/CSS com hash) e `dist/server.mjs` |
| `npm start` | Executa o build de produção |
| `npm run db:migrate` | Aplica migrations pendentes de `db/migrations` |
| `npm run db:seed` | Popula o catálogo de demonstração (`-- --reset` recria; bloqueado se houver pedidos) |
| `npm run admin:create -- email` | Cria um administrador ou promove uma conta existente |
| `npm run images` | Regera as versões web das fotos a partir de `assets-source/` |
| `npm run brand` | Regera logotipos, favicons, imagens sociais e materiais impressos (SVG/PDF) |
| `npm run backup` | Cria e verifica (teste de restauração) um backup do banco |
| `npm run restore -- arquivo.db` | Restaura um backup verificado (servidor parado; o banco atual é preservado) |
| `npm test` | Testes automatizados de API, regras de negócio e segurança |
| `npm run test:e2e` | Testes ponta a ponta no navegador (requer `npm run build`) |
| `npm run test:visual` | Revisão visual em 5 resoluções (requer servidor rodando) |
| `npm run typecheck` | Verificação TypeScript estrita (cliente + servidor) |
| `npm run build:html` | Gera `dist/index.html`: a loja inteira em um único arquivo (ver §16) |
| `npm run test:html` | Testa o `dist/index.html` aberto como arquivo, sem servidor |

Para os testes de navegador: `npx playwright install chromium` (uma vez).

## 4. Estrutura do projeto

```
assets-source/          Arquivos ORIGINAIS fornecidos (nunca alterados): fotos, modelos, logo, referências
public/assets/          Versões web geradas (WebP), logomarca vetorizada, fontes
db/migrations/          Esquema SQL versionado
db/seed/                Inventário do catálogo de demonstração e manifesto das imagens
src/shared/             Tipos e formatação compartilhados (contratos da API)
src/server/             Servidor Node (HTTP nativo), rotas, serviços, autenticação, pagamentos
  routes/               public · cart · auth · account (checkout) · content · engagement · support · admin · admin-orders · admin-content · management · webhooks
  services/             catálogo, sacola, pedidos, estoque, cupons, frete, envios, pagamentos, trocas, notificações, atendimento,
                        financeiro, analytics, privacidade, auditoria do catálogo, monitoramento, backups, rotinas
  auth/                 senhas, sessões, Google, funções e permissões
  cli/                  migrate, seed, create-admin, backup, restore
src/client/             Front-end React (SPA) — componentes, páginas, estilos (design tokens)
  styles/tokens.css     Paleta, fontes e espaçamentos centralizados
  pages/admin/          Painel (carregado sob demanda): AdminKit (CRUD genérico), conteúdo, financeiro, operação…
src/standalone/         Versão HTML de demonstração (backend local + retrato do conteúdo)
scripts/assets/         Processamento de imagens e kit de marca
tests/unit/             Testes de API/regras (node:test) com banco em memória e Mercado Pago simulado
tests/e2e/              Navegador real: fluxo de compra, animação do hero, revisão visual
docs/                   Inventário de imagens, decisões técnicas, pendências, relatório de testes
```

Arquitetura e motivos das escolhas: [docs/DECISOES.md](docs/DECISOES.md).

## 5. Banco de dados e migrations

- SQLite em arquivo (`DATABASE_PATH`, padrão `data/gazu.db`), modo WAL, chaves estrangeiras ativas.
- Valores monetários em **centavos (inteiros)**. Itens de pedido guardam **snapshot** de nome, SKU, cor, tamanho, imagem e preço — alterar um produto não muda o histórico.
- Estoque é reservado na criação do pedido dentro de transação (sem venda acima do disponível) e devolvido em cancelamento/expiração. Toda movimentação fica em `inventory_movements`.
- Novas mudanças de esquema: crie `db/migrations/004_descricao.sql`; o servidor aplica ao iniciar (registradas em `schema_migrations`).
- **Backup:** `npm run backup` (cópia consistente com o servidor rodando + verificação) e rotina automática — ver §18.
  Não copie só o arquivo `.db` com o servidor ligado (as gravações recentes ficam no `-wal`).

Migração futura para PostgreSQL/Supabase: o acesso a dados está concentrado em `src/server/db.ts` e nos serviços (SQL padrão, sem ORM). Ver [docs/DECISOES.md](docs/DECISOES.md#banco).

## 6. Primeiro administrador

O papel de administrador **só** pode ser concedido por quem tem acesso ao servidor:

```bash
npm run admin:create -- admin@seudominio.com.br
```

A senha é pedida no terminal (sem eco). Em automações use `ADMIN_PASSWORD=... npm run admin:create -- email`. Se o e-mail já existir, a conta é promovida (a senha atual é mantida). A conta criada assim é **proprietária** (acesso total). As demais pessoas da equipe criam a própria conta no site e o proprietário atribui a função em **/admin/equipe** (ver §17). Todas as rotas `/api/admin/*` validam a permissão no servidor.

## 7. Login com Google (OAuth)

1. Google Cloud Console → *APIs e serviços* → *Credenciais* → **Criar ID do cliente OAuth** (Aplicativo da Web).
2. **URI de redirecionamento autorizado:** `https://SEU-DOMINIO/api/auth/google/callback` (em desenvolvimento: `http://localhost:3000/api/auth/google/callback`).
3. Preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` e reinicie.

Sem essas variáveis o botão “Continuar com Google” **não aparece** (nada é simulado). O fluxo usa *state* + PKCE e só aceita e-mails verificados pelo Google.

## 8. Pagamentos — Mercado Pago

Integração pela **API de Pagamentos (Checkout Transparente)**: Pix, boleto e cartão de crédito com parcelamento (campos seguros do SDK oficial — número e CVV nunca passam pelo servidor da GAZU). Estornos totais e parciais pelo painel, sempre pela API. Passo a passo completo e checklist de ativação: [docs/INTEGRACOES.md](docs/INTEGRACOES.md) §1.

1. Crie a conta e uma aplicação em https://www.mercadopago.com.br/developers/panel.
2. **Teste primeiro** com as credenciais de teste:
   ```env
   PAYMENT_PROVIDER=mercadopago
   MP_ACCESS_TOKEN=TEST-...
   MP_PUBLIC_KEY=TEST-...
   MP_WEBHOOK_SECRET=...
   MP_ENABLED_METHODS=pix,credit_card,boleto   # somente o que estiver habilitado na sua conta
   MP_MAX_INSTALLMENTS=1                  # parcelas máximas oferecidas
   ```
3. Use os cartões e usuários de teste da documentação do Mercado Pago.
4. Produção: troque por credenciais `APP_USR-...`, confirme quais meios a conta tem aprovados e ajuste `MP_ENABLED_METHODS`. A loja só exibe como aceitos os métodos listados ali.

Regras implementadas: preço sempre recalculado no servidor; o pedido só vira **Pago** quando o provedor confirma (webhook assinado ou consulta à API); o valor confirmado precisa bater com o total do pedido; idempotência por `X-Idempotency-Key` na criação e por chave de evento nos webhooks; pedidos não pagos expiram (`ORDER_PAYMENT_WINDOW_MINUTES`) e devolvem o estoque.

Estados do pagamento: pendente, em processamento, aprovado, recusado, cancelado, expirado, reembolsado e parcialmente reembolsado, com transições controladas (notificações fora de ordem não fazem o status regredir). Status desconhecidos nunca viram "aprovado". O painel **não** tem ação para marcar pagamento como pago.

## 9. Webhooks

1. No painel do Mercado Pago → *Webhooks* → URL: `https://SEU-DOMINIO/api/webhooks/mercadopago`, evento **Pagamentos**.
2. Copie a **assinatura secreta** para `MP_WEBHOOK_SECRET`.
3. O servidor valida `x-signature` (HMAC-SHA256 com tolerância de 10 min), registra o evento em `payment_events`, ignora repetições e **consulta o pagamento na API** antes de aplicar qualquer status.

`localhost` não recebe notificações. Para testar localmente use um túnel HTTPS (ex.: `cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000`) e ajuste `APP_URL`. Mesmo sem webhook, a tela do Pix consulta o status no servidor a cada poucos segundos.

## 10. Frete

- `SHIPPING_PROVIDER=demo`: opções simuladas e **sinalizadas como simulação** (só em desenvolvimento).
- `SHIPPING_PROVIDER=manual`: regras por faixa de CEP cadastradas em **/admin/frete** (valor, prazo, frete grátis acima de um valor). Sem regras ativas, o checkout informa que o frete não está configurado e não permite finalizar.
- `SHIPPING_PROVIDER=melhorenvio`: cotação real multi-transportadora, compra de etiqueta pelo painel e rastreio automático (rotina a cada hora). Requer `MELHORENVIO_TOKEN`, `SHIPPING_ORIGIN_CEP` e remetente em Configurações — [docs/INTEGRACOES.md](docs/INTEGRACOES.md) §2.
- Envio manual: o administrador registra transportadora, código, link e custo no pedido; o cliente acompanha em *Meus pedidos* e em `/rastreio`.

## 11. E-mails

Todos os e-mails (conta, pedido, pagamento, envio, entrega, cancelamento, estorno, trocas, atendimento, newsletter, lista de espera, carrinho abandonado) usam o modelo da marca, com versão em texto puro. `EMAIL_PROVIDER=console` só **registra** os e-mails na fila (nada é enviado); para enviar use `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` e `EMAIL_FROM` com domínio verificado. Falhas são reenviadas automaticamente (até 3 tentativas).

## 12. Testes

```bash
npm test                 # 61 testes: catálogo, sacola, cupons, frete, checkout, pagamentos/webhooks, estornos, envios,
                         # trocas, visitante, financeiro, analytics, auditoria, permissões, atendimento, WhatsApp,
                         # newsletter, LGPD, backups, qualidade do catálogo, campanhas, marca
npm run build && npm run test:e2e     # 9 cenários no navegador: hero, compra, visitante, cookies, páginas, painel
npm run dev  # em outro terminal:
npm run test:visual      # 20 páginas × 5 tamanhos de tela + checagens automáticas de layout
npm run build:html && npm run test:html   # 5 cenários da versão HTML autônoma
```

Resultados da última execução: [docs/RELATORIO-TESTES.md](docs/RELATORIO-TESTES.md).

## 13. Implantação (produção)

Qualquer hospedagem com Node 22 e **disco persistente** (VPS, Render com disco, Railway com volume, Fly.io com volume):

```bash
npm install            # gera o package-lock.json na primeira vez (versione-o); depois use npm ci
npm run build
NODE_ENV=production npm start
```

Checklist completo e ordem de ativação: **[docs/CHECKLIST-PRODUCAO.md](docs/CHECKLIST-PRODUCAO.md)**. Resumo:

- `NODE_ENV=production`, `APP_URL=https://seu-dominio`, `SESSION_SECRET` forte e exclusivo.
- `PAYMENT_PROVIDER=mercadopago` com credenciais de produção, `MP_WEBHOOK_SECRET` e webhook cadastrado.
- `SHIPPING_PROVIDER=melhorenvio` (token + remetente) ou `manual` com regras reais cadastradas.
- `EMAIL_PROVIDER=resend`; `ALERT_EMAIL`/`ALERT_WEBHOOK_URL`; `JOBS_ENABLED=true` em uma instância; cópia externa dos backups.
- `DEMO_MODE=false` **somente** depois de substituir preços, estoques e cores de demonstração.
- HTTPS obrigatório (cookies de sessão ficam `Secure`). Atrás de proxy reverso confiável, `TRUST_PROXY=1`.
- `DATABASE_PATH` apontando para o volume persistente + rotina de backup.
- Preencha em **/admin/configuracoes**: contato, razão social, CNPJ, endereço e redes sociais (o site não inventa esses dados).
- Revise os textos de Política de privacidade, Termos e Trocas com o responsável jurídico.

## 14. Identidade visual e imagens

- **Referência 1 (home)** e **Referência 2 (produto)** estão em `assets-source/references/`. A implementação reproduz composição, proporções e hierarquia dessas capturas (medidas convertidas para viewport); a fidelidade foi verificada por comparação lado a lado, não pixel a pixel.
- **Logomarca:** vetorizada a partir de `gazu-logo-original.png` (traçado por contorno, sem redesenho) → `public/assets/branding/logo/`. Variações (preto, branco, monograma, e-mail), favicons, imagens sociais e **materiais impressos** (tag, cartão de agradecimento, adesivo, cuidados, formulário de troca, caixa, papel de seda, etiqueta de remetente) em SVG/PDF: `public/assets/branding/` — sistema completo em [docs/IDENTIDADE-VISUAL.md](docs/IDENTIDADE-VISUAL.md).
- **Fonte provisória:** Inter / Inter Display (licença SIL OFL, incluída). Para trocar, edite `--font-display` e `--font-sans` em `src/client/styles/tokens.css` e adicione os arquivos em `public/assets/branding/fonts/`.
- **Modelos do hero:** recortes com fundo transparente gerados a partir das fotos originais (que continuam intactas). As fotos de origem têm baixa resolução (300–624 px de largura) — recomenda-se fornecer versões maiores.
- **Inventário completo** das 107 fotos (dimensões, categoria, cor provável, duplicatas, itens fora do catálogo): [docs/INVENTARIO-IMAGENS.md](docs/INVENTARIO-IMAGENS.md).

## 15. Segurança

- Senhas com scrypt; sessões em cookie `HttpOnly`/`SameSite=Lax` (`Secure` em produção), token guardado apenas como hash.
- Proteção CSRF por verificação de origem em toda requisição que altera dados; limites de tentativa em login, cadastro, recuperação de senha, pedidos e pagamentos.
- Validação de entrada com Zod no servidor; SQL sempre parametrizado; cabeçalhos de segurança (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`).
- Clientes só acessam os próprios pedidos e endereços (visitantes, com token assinado do pedido); rotas administrativas exigem a **permissão** correspondente no servidor; ações críticas e tentativas negadas ficam em `audit_log` (sem senhas, tokens, CPF completo ou cartão).
- LGPD: exportação dos dados pela conta, solicitações de titulares no painel, anonimização, consentimentos registrados, analytics só com consentimento.
- Uploads: tipo verificado pela assinatura do arquivo, limite de 8 MB e dimensões, reprocessados para WebP.
- Credenciais apenas em variáveis de ambiente; `.env` está no `.gitignore` e não é distribuído.

## 16. Versão HTML autônoma (`dist/index.html`)

> **A versão HTML NÃO substitui a loja completa** (servidor, banco, painel completo e integrações). É uma demonstração.

`npm run build:html` gera **um único arquivo** com o mesmo aplicativo React, estilos, fontes, logomarca, os 4 modelos do hero, as fotos dos produtos, o catálogo e um retrato do conteúdo editorial (coleções, lookbooks, journal, FAQ). Abra com duplo clique (sem servidor, sem internet).

Funciona localmente: hero, catálogo com filtros, busca, produto, conteúdo editorial, favoritos, sacola, cadastro/login, checkout com cupom (`BEMVINDO10`) e frete **simulados**, pagamento **simulado**, área do cliente e um **painel reduzido** (pedidos, clientes, produtos, categorias, cupons, frete) — acesso pelo botão "entrar no painel de demonstração" na tela de login (não há senha publicada). Atendimento, trocas, financeiro, envios reais, conteúdo, equipe, auditoria e operação mostram que exigem a loja completa.

Os dados ficam apenas no navegador de quem abriu o arquivo; não há cobrança, e-mail, login com Google, webhook nem frete real; a navegação usa endereços `#/`.

Implementação: `src/standalone/` (backend local + roteador por hash) + `scripts/standalone-seed.ts` (retrato das respostas públicas do servidor real) + `scripts/build-standalone.mjs`.

### Publicar a versão HTML na Vercel

O projeto já inclui `vercel.json`, que manda a Vercel publicar a pasta `site/` (onde fica o `index.html` pronto), sem instalar nem compilar nada. Importe o repositório na Vercel (Framework Preset: **Other**) e faça o deploy. Depois de mudar catálogo ou design, rode `npm run build:html` (atualiza `site/index.html`) e envie de novo.

Atenção: a Vercel publica apenas a **versão de demonstração**. O servidor completo (Node + SQLite, pagamentos e webhooks reais) precisa de hospedagem com processo contínuo e disco persistente (§13); funções serverless da Vercel não mantêm o banco SQLite.

## 17. Painel administrativo e funções

| Área | Rota | Permissão |
|---|---|---|
| Visão geral (pedidos, pendências, estoque baixo, últimos 30 dias) | `/admin` | `orders.read` (+ `finance.read` para os valores) |
| Pedidos, envios, trocas e devoluções | `/admin/pedidos`, `/admin/envios`, `/admin/trocas` | `orders.read` / `orders.write`; estornos `payments.refund` |
| Atendimento (WhatsApp quando configurado) | `/admin/atendimento` | `support.read` / `support.write` |
| Clientes e privacidade (LGPD) | `/admin/clientes`, `/admin/privacidade` | `customers.read` / `customers.privacy` |
| Produtos, categorias, estoque, qualidade, avaliações | `/admin/produtos`… | `catalog.read` / `catalog.write` |
| Conteúdo e vitrine (avisos, banners, coleções, lookbooks, journal, páginas, FAQ, guias) | `/admin/conteudo/:aba` | `content.write` |
| Financeiro (indicadores, margens, movimentações, despesas, CSV) | `/admin/financeiro` | `finance.read` / `finance.write` |
| Analytics, marketing (campanhas, newsletter, carrinhos), cupons | `/admin/analytics`, `/admin/marketing`, `/admin/cupons` | `analytics.read`, `marketing.*` |
| Operação, auditoria, equipe, marca, configurações | `/admin/operacao`, `/admin/auditoria`, `/admin/equipe`, `/admin/marca`, `/admin/configuracoes` | `ops.*`, `audit.read`, `team.manage`, `settings.write` |

Funções: **Proprietário(a)** (tudo), **Gerente** (tudo, exceto equipe), **Catálogo e conteúdo**, **Financeiro**, **Atendimento**, **Marketing** — matriz completa em `/admin/equipe` e `src/server/auth/permissions.ts`.

## 18. Operação, backups e monitoramento

Com `JOBS_ENABLED=true` (uma instância), o servidor executa: expiração de pedidos não pagos, reconciliação de pagamentos,
reenvio de e-mails, rastreio de envios, lembrete de carrinho abandonado, verificação de consistência (com alerta), backup
verificado e limpeza. Tudo aparece em **/admin/operacao** (com execução manual, erros, webhooks e comunicações).
Backups externos, alertas e monitor de disponibilidade **dependem da hospedagem** — procedimentos e teste de restauração em
[docs/OPERACAO-BACKUP.md](docs/OPERACAO-BACKUP.md).

