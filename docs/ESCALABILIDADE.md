# Escalabilidade e manutenção — GAZU

## 1. Arquitetura atual (adequada ao estágio de lançamento)

```
Navegador ── React 19 (SPA, esbuild, divisão de código: loja / painel)
   │  JSON (mesma origem, cookies HttpOnly, CSRF por Origin)
Node 22 (node:http) ── rotas finas (src/server/routes) → serviços com as regras (src/server/services)
   │                                              → provedores externos (Mercado Pago, Melhor Envio, Resend, Meta)
SQLite (WAL) ── migrations versionadas (db/migrations) · backups VACUUM INTO + verificação
```

- **Separação de responsabilidades:** interface (`src/client`), contratos tipados (`src/shared/types.ts`), validação Zod
  (`src/server/validation.ts`), regras de negócio (`src/server/services/*`), acesso a dados (`src/server/db.ts`),
  autorização (`src/server/auth/*`), eventos de domínio (`src/server/events.ts` + `handlers.ts`), rotinas (`jobs.ts`).
- **Capacidade estimada de uma instância:** SQLite com WAL suporta milhares de leituras/s e centenas de gravações/s em
  disco SSD — muito acima do volume de uma loja em lançamento (dezenas a centenas de pedidos/dia). O gargalo real tende a ser
  a latência dos provedores externos, já isolada em chamadas com timeout e reprocessamento.
- **Paginação e índices:** listas do catálogo e do painel são paginadas; consultas de catálogo, pedidos, pagamentos,
  eventos, atendimento e analytics têm índices dedicados (ver migrations).

## 2. Quando e como crescer

| Sinal | Ação |
|---|---|
| Mais de uma instância do servidor (alta disponibilidade, deploy sem parada) | Migrar para PostgreSQL (seção 3); mover limitador de tentativas e cache de sessões para Redis; `JOBS_ENABLED=true` em só uma instância. |
| Muitas imagens enviadas pelo painel | Mover `public/uploads` para armazenamento de objetos (S3/R2) com CDN; o upload já gera variações WebP e grava a URL — basta trocar o destino em `services/uploads.ts`. |
| Catálogo com milhares de produtos | Busca com FTS5 (SQLite) ou `tsvector` + `unaccent` (Postgres); facetas com contagens materializadas. |
| Picos de tráfego (campanhas) | CDN na frente (cache de `/assets` e `/build` já é imutável/longo); páginas públicas são SPA + API cacheável por poucos segundos. |
| Volume de e-mails | Fila dedicada (a tabela `email_outbox` já funciona como fila com reenvio). |
| Relatórios lentos | Tabelas de agregação diária (vendas, analytics) alimentadas pela rotina noturna. |

## 3. Migração para PostgreSQL (Supabase ou outro)

1. Converter `db/migrations/*.sql`: `INTEGER PRIMARY KEY` → `bigserial`/`identity`; datas ISO-8601 em `TEXT` → `timestamptz`;
   `strftime(...)` → `now()`; `CHECK` e `UNIQUE` permanecem iguais.
2. Substituir `gz_norm()` (função registrada no SQLite para busca sem acento) por `unaccent(lower(...))`.
3. Trocar `src/server/db.ts` por um adaptador `pg` com a mesma interface (`get`, `all`, `run`, `tx`, `onCommit`). Os serviços
   usam SQL parametrizado padrão (sem ORM), então a mudança fica concentrada nesse arquivo.
4. Estoque: manter a gravação condicional já usada (`UPDATE product_variants SET stock = stock + ? WHERE id = ? AND stock + ? >= 0`) dentro de transação;
   em Postgres ela já é segura sob concorrência.
5. Supabase: **não expor a service role ao navegador**; o front continua falando só com este servidor. RLS pode ser ativado
   como camada extra, mas a autorização principal continua no servidor.
6. Migrar dados com exportação por tabela (CSV) e conferir contagens e somatórios (pedidos, pagamentos, estoque).

## 4. Como adicionar funcionalidades sem quebrar as existentes

| Quero adicionar… | Onde |
|---|---|
| Novo meio de pagamento | `services/payments/` (novo provedor implementando criação, consulta, estorno) + estados existentes; webhook próprio em `routes/webhooks.ts`. Nunca confiar no retorno do navegador. |
| Nova transportadora | `services/shipping.ts` (cotação) e `services/shipments.ts` (etiqueta/rastreio), mantendo os estados de envio. |
| Nova seção da home | Componente em `components/content/Editorial.tsx` + chave em `HomeSectionKey` + ordem em Configurações. |
| Novo conteúdo administrável | `registerResource()` em `routes/admin-content.ts` (CRUD com validação, auditoria e permissão) + `ResourceConfig` no painel. |
| Nova função da equipe | `auth/permissions.ts` (permissões explícitas) — rotas já verificam por permissão, não por função. |
| Nova notificação | Evento em `events.ts` + handler em `handlers.ts` + modelo em `services/notifications.ts` (deduplicação por chave). |
| Nova métrica | Evento em `lib/analytics.ts` (só com consentimento) + agregação em `services/analytics.ts`. |
| Nova migration | `db/migrations/00N_descricao.sql` — aplicada automaticamente na inicialização, registrada em `schema_migrations`. |

## 5. Ambientes

| Ambiente | Banco | Pagamento | Frete | E-mail |
|---|---|---|---|---|
| Desenvolvimento | `data/gazu.db` (seed de demonstração) | `demo` (simulado, sinalizado) | `demo` | `console` |
| Testes automatizados | memória / arquivo temporário | API do MP simulada no teste | API simulada | console |
| Homologação | banco próprio | Mercado Pago **credenciais de teste** | Melhor Envio sandbox | Resend (domínio de teste) |
| Produção | banco próprio + backups externos | credenciais de produção | produção | Resend |

Em produção o servidor **recusa** `PAYMENT_PROVIDER=demo` e `SHIPPING_PROVIDER=demo` e exige `SESSION_SECRET`.

## 6. Manutenção

- `npm test` (unitários/integração), `npm run test:e2e` (fluxos no navegador), `npm run test:visual` (layout em 5 tamanhos),
  `npm run test:html` (versão HTML) — rodar antes de cada publicação.
- Painel › Operação: rotinas, divergências, erros, webhooks, backups e comunicações.
- Painel › Qualidade do catálogo: corrigir bloqueios antes de publicar produtos.
- Atualizações de dependências: React, esbuild, Zod e Playwright; o servidor não depende de frameworks HTTP.
