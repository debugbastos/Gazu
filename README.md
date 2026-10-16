# GAZU — loja virtual de moda

E-commerce completo da marca **GAZU**: vitrine editorial com hero animado dos quatro modelos, catálogo com filtros, página de produto com variantes, sacola persistente, cadastro/login (e-mail e Google), checkout com frete e cupom, pagamentos via Mercado Pago (Pix e cartão), webhooks verificados, área do cliente e painel administrativo.

> **Modo demonstração.** O catálogo inicial (98 produtos) foi montado a partir das fotos fornecidas. Preços, estoques e cores são **ilustrativos** e aparecem sinalizados como “Demonstração” na loja. Substitua-os pelo painel antes de vender. Veja [docs/PENDENCIAS.md](docs/PENDENCIAS.md).

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
  routes/               public · cart · auth · account (inclui checkout) · admin · webhooks
  services/             catálogo, sacola, pedidos, estoque, cupons, frete, pagamentos, e-mail
  cli/                  migrate, seed, create-admin
src/client/             Front-end React (SPA) — componentes, páginas, estilos (design tokens)
  styles/tokens.css     Paleta, fontes e espaçamentos centralizados
tests/unit/             Testes de API/regras (node:test) com banco em memória e Mercado Pago simulado
tests/e2e/              Navegador real: fluxo de compra, animação do hero, revisão visual
docs/                   Inventário de imagens, decisões técnicas, pendências, relatório de testes
```

Arquitetura e motivos das escolhas: [docs/DECISOES.md](docs/DECISOES.md).

## 5. Banco de dados e migrations

- SQLite em arquivo (`DATABASE_PATH`, padrão `data/gazu.db`), modo WAL, chaves estrangeiras ativas.
- Valores monetários em **centavos (inteiros)**. Itens de pedido guardam **snapshot** de nome, SKU, cor, tamanho, imagem e preço — alterar um produto não muda o histórico.
- Estoque é reservado na criação do pedido dentro de transação (sem venda acima do disponível) e devolvido em cancelamento/expiração. Toda movimentação fica em `inventory_movements`.
- Novas mudanças de esquema: crie `db/migrations/002_descricao.sql`; o servidor aplica ao iniciar.
- **Backup:** copie `data/gazu.db` (com o servidor parado) ou use `sqlite3 data/gazu.db ".backup copia.db"`.

Migração futura para PostgreSQL/Supabase: o acesso a dados está concentrado em `src/server/db.ts` e nos serviços (SQL padrão, sem ORM). Ver [docs/DECISOES.md](docs/DECISOES.md#banco).

## 6. Primeiro administrador

O papel de administrador **só** pode ser concedido por quem tem acesso ao servidor:

```bash
npm run admin:create -- admin@seudominio.com.br
```

A senha é pedida no terminal (sem eco). Em automações use `ADMIN_PASSWORD=... npm run admin:create -- email`. Se o e-mail já existir, a conta é promovida (a senha atual é mantida). Não há rota, botão ou variável de front-end que conceda esse papel; todas as rotas `/api/admin/*` validam o papel no servidor.

## 7. Login com Google (OAuth)

1. Google Cloud Console → *APIs e serviços* → *Credenciais* → **Criar ID do cliente OAuth** (Aplicativo da Web).
2. **URI de redirecionamento autorizado:** `https://SEU-DOMINIO/api/auth/google/callback` (em desenvolvimento: `http://localhost:3000/api/auth/google/callback`).
3. Preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` e reinicie.

Sem essas variáveis o botão “Continuar com Google” **não aparece** (nada é simulado). O fluxo usa *state* + PKCE e só aceita e-mails verificados pelo Google.

## 8. Pagamentos — Mercado Pago

Integração pela **API de Pagamentos (Checkout Transparente)**: Pix e cartão de crédito (com campos seguros do SDK oficial — número e CVV nunca passam pelo servidor da GAZU).

1. Crie a conta e uma aplicação em https://www.mercadopago.com.br/developers/panel.
2. **Teste primeiro** com as credenciais de teste:
   ```env
   PAYMENT_PROVIDER=mercadopago
   MP_ACCESS_TOKEN=TEST-...
   MP_PUBLIC_KEY=TEST-...
   MP_ENABLED_METHODS=pix,credit_card     # somente o que estiver habilitado na sua conta
   MP_MAX_INSTALLMENTS=1                  # parcelas máximas oferecidas
   ```
3. Use os cartões e usuários de teste da documentação do Mercado Pago.
4. Produção: troque por credenciais `APP_USR-...`, confirme quais meios a conta tem aprovados e ajuste `MP_ENABLED_METHODS`. A loja só exibe como aceitos os métodos listados ali.

Regras implementadas: preço sempre recalculado no servidor; o pedido só vira **Pago** quando o provedor confirma (webhook assinado ou consulta à API); o valor confirmado precisa bater com o total do pedido; idempotência por `X-Idempotency-Key` na criação e por chave de evento nos webhooks; pedidos não pagos expiram (`ORDER_PAYMENT_WINDOW_MINUTES`) e devolvem o estoque.

Mapeamento de status (`src/server/services/payments/mercadopago.ts`): `pending`/`in_process`/`authorized`/`in_mediation` → **pendente**; `approved` → **aprovado** (ou **estornado parcialmente** se houver valor devolvido); `rejected` → **recusado**; `cancelled` → **cancelado**; `refunded`/`charged_back` → **estornado**. Status desconhecidos são tratados como pendentes (nunca como aprovados).

## 9. Webhooks

1. No painel do Mercado Pago → *Webhooks* → URL: `https://SEU-DOMINIO/api/webhooks/mercadopago`, evento **Pagamentos**.
2. Copie a **assinatura secreta** para `MP_WEBHOOK_SECRET`.
3. O servidor valida `x-signature` (HMAC-SHA256 com tolerância de 10 min), registra o evento em `payment_events`, ignora repetições e **consulta o pagamento na API** antes de aplicar qualquer status.

`localhost` não recebe notificações. Para testar localmente use um túnel HTTPS (ex.: `cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000`) e ajuste `APP_URL`. Mesmo sem webhook, a tela do Pix consulta o status no servidor a cada poucos segundos.

## 10. Frete

- `SHIPPING_PROVIDER=demo`: opções simuladas e **sinalizadas como simulação** (só em desenvolvimento).
- `SHIPPING_PROVIDER=manual`: regras por faixa de CEP cadastradas em **/admin/frete** (valor, prazo, frete grátis acima de um valor). Sem regras ativas, o checkout informa que o frete não está configurado e não permite finalizar.
- Integração com transportadora/agregador (Correios, Melhor Envio etc.) ainda não existe — ver pendências. O ponto de extensão é `src/server/services/shipping.ts`.
- Rastreamento: o administrador registra código e link no pedido; o cliente vê em *Meus pedidos*.

## 11. E-mails

`EMAIL_PROVIDER=console` imprime os e-mails (confirmação de conta, redefinição de senha) no terminal. Para enviar de verdade use `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` e `EMAIL_FROM` com domínio verificado.

## 12. Testes

```bash
npm test                 # 22 testes: catálogo, sacola, cupom, frete, checkout, Pix + webhook, permissões
npm run build && npm run test:e2e     # navegador: hero, movimento reduzido, compra completa, painel
npm run dev  # em outro terminal:
npm run test:visual      # capturas em desktop/notebook/tablet/celular + checagens automáticas de layout
```

Resultados da última execução: [docs/RELATORIO-TESTES.md](docs/RELATORIO-TESTES.md).

## 13. Implantação (produção)

Qualquer hospedagem com Node 22 e **disco persistente** (VPS, Render com disco, Railway com volume, Fly.io com volume):

```bash
npm ci
npm run build
NODE_ENV=production npm start
```

Checklist:

- `NODE_ENV=production`, `APP_URL=https://seu-dominio`, `SESSION_SECRET` forte e exclusivo.
- `PAYMENT_PROVIDER=mercadopago` com credenciais de produção, `MP_WEBHOOK_SECRET` e webhook cadastrado.
- `SHIPPING_PROVIDER=manual` com regras cadastradas (ou integração de frete).
- `DEMO_MODE=false` **somente** depois de substituir preços, estoques e cores de demonstração.
- HTTPS obrigatório (cookies de sessão ficam `Secure`). Atrás de proxy reverso confiável, `TRUST_PROXY=1`.
- `DATABASE_PATH` apontando para o volume persistente + rotina de backup.
- Preencha em **/admin/configuracoes**: contato, razão social, CNPJ, endereço e redes sociais (o site não inventa esses dados).
- Revise os textos de Política de privacidade, Termos e Trocas com o responsável jurídico.

## 14. Identidade visual e imagens

- **Referência 1 (home)** e **Referência 2 (produto)** estão em `assets-source/references/`. A implementação reproduz composição, proporções e hierarquia dessas capturas (medidas convertidas para viewport); a fidelidade foi verificada por comparação lado a lado, não pixel a pixel.
- **Logomarca:** vetorizada a partir de `gazu-logo-original.png` (traçado por contorno, sem redesenho) → `public/assets/branding/logo/`.
- **Fonte provisória:** Inter / Inter Display (licença SIL OFL, incluída). Para trocar, edite `--font-display` e `--font-sans` em `src/client/styles/tokens.css` e adicione os arquivos em `public/assets/branding/fonts/`.
- **Modelos do hero:** recortes com fundo transparente gerados a partir das fotos originais (que continuam intactas). As fotos de origem têm baixa resolução (300–624 px de largura) — recomenda-se fornecer versões maiores.
- **Inventário completo** das 107 fotos (dimensões, categoria, cor provável, duplicatas, itens fora do catálogo): [docs/INVENTARIO-IMAGENS.md](docs/INVENTARIO-IMAGENS.md).

## 15. Segurança

- Senhas com scrypt; sessões em cookie `HttpOnly`/`SameSite=Lax` (`Secure` em produção), token guardado apenas como hash.
- Proteção CSRF por verificação de origem em toda requisição que altera dados; limites de tentativa em login, cadastro, recuperação de senha, pedidos e pagamentos.
- Validação de entrada com Zod no servidor; SQL sempre parametrizado; cabeçalhos de segurança (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`).
- Clientes só acessam os próprios pedidos e endereços; rotas administrativas exigem papel `admin` no servidor; ações administrativas ficam em `audit_log`.
- Uploads: tipo verificado pela assinatura do arquivo, limite de 8 MB e dimensões, reprocessados para WebP.
- Credenciais apenas em variáveis de ambiente; `.env` está no `.gitignore` e não é distribuído.

## 16. Versão HTML autônoma (`dist/index.html`)

`npm run build:html` gera **um único arquivo** com a loja inteira: o mesmo aplicativo React, estilos, fontes, logomarca, os 4 modelos do hero, as fotos dos 98 produtos e o catálogo. Abra com duplo clique (sem servidor, sem internet).

Funciona tudo localmente: hero animado, catálogo com filtros e ordenação, busca, página de produto, favoritos, sacola, cadastro/login, endereços, checkout com cupom (`BEMVINDO10`) e frete **simulado**, pagamento **simulado**, área do cliente e **painel administrativo** (entre com `admin@gazu.demo` / `gazu2026` — o login mostra um botão “Preencher”).

É uma **demonstração**: os dados ficam salvos apenas no navegador de quem abriu o arquivo (para recomeçar, limpe os dados do site no navegador), não há cobrança real, e-mail, login com Google, webhook nem frete real, e a navegação usa endereços `#/` porque o arquivo é aberto localmente. Para operar a loja, use o projeto completo acima.

Implementação: `src/standalone/` (backend local que replica as regras do servidor, API e roteador por hash) + `scripts/build-standalone.mjs`.

### Publicar a versão HTML na Vercel

O projeto já inclui `vercel.json`, que manda a Vercel publicar a pasta `site/` (onde fica o `index.html` pronto), sem instalar nem compilar nada. Importe o repositório na Vercel (Framework Preset: **Other**) e faça o deploy. Depois de mudar catálogo ou design, rode `npm run build:html` (atualiza `site/index.html`) e envie de novo.

Atenção: a Vercel publica apenas a **versão de demonstração**. O servidor completo (Node + SQLite, pagamentos e webhooks reais) precisa de hospedagem com processo contínuo e disco persistente (§13); funções serverless da Vercel não mantêm o banco SQLite.
