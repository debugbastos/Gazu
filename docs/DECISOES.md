# Decisões técnicas — GAZU

Registro das escolhas que diferem da sugestão do PRD ou que precisam ser conhecidas por quem continuar o projeto.

## Arquitetura

**PRD sugeria:** Next.js (App Router) + Tailwind + Supabase (Auth/Postgres/Storage) + GSAP/Framer Motion.
**Implementado:** servidor Node.js nativo (`node:http`) em TypeScript + React 19 (SPA) empacotado com esbuild + SQLite (`node:sqlite`) + CSS com design tokens + Web Animations API.

Motivo: o ambiente de desenvolvimento desta entrega **não tinha acesso ao registro npm** — só os pacotes já presentes (React, esbuild, TypeScript, Zod, sharp, Playwright) podiam ser usados. Em vez de entregar um protótipo, optou-se por uma arquitetura completa com essas peças, que:

- roda em qualquer máquina com Node 22, **sem Docker, banco ou contas externas** para desenvolver;
- mantém a separação exigida pelo PRD: interface (`src/client`), regras de negócio (`src/server/services`), acesso a dados (`src/server/db.ts`), validação (`src/server/validation.ts`, Zod) e contratos tipados (`src/shared`);
- implementa no servidor tudo o que o PRD pede do Supabase: autenticação (scrypt + sessões com hash), autorização por linha (cada consulta de cliente filtra por `user_id`), papéis, armazenamento de uploads.

### Banco

SQLite com WAL atende bem uma loja em uma instância. Para escalar horizontalmente ou usar Supabase:
- o SQL é padrão e parametrizado, concentrado nos serviços (sem ORM);
- pontos específicos de SQLite: `gz_norm()` (função de busca sem acento — no Postgres use `unaccent`), `INSERT ... ON CONFLICT` (compatível), datas em ISO-8601 texto (use `timestamptz`);
- estoque é protegido por transação única (`BEGIN IMMEDIATE`) — no Postgres use `SELECT ... FOR UPDATE` ou `UPDATE ... WHERE stock >= ?`.

### Animações

PRD sugeria GSAP para o hero. Implementado com a **Web Animations API** nativa em `src/client/components/home/heroController.ts`: uma única linha do tempo, um timer por vez, fila para cliques rápidos, cancelamento ao desmontar, pausa automática com a aba oculta e modo estático com `prefers-reduced-motion`. Mesma capacidade, sem dependência. Interações menores (gavetas, menus, cartões) usam transições CSS.

### Tipografia

Inter Display (títulos) + Inter (interface), licença SIL OFL. A **Referência 1 usa uma grotesca geométrica em negrito** para o “GAZU” gigante e textos em caixa-alta espaçada; Inter Display Bold reproduz esse peso e proporção melhor do que a sugestão do PRD (Cormorant Garamond), que é serifada e não aparece nas referências. A marca gráfica no cabeçalho continua sendo a **logomarca fornecida** (vetorizada), não uma fonte.

## Fidelidade às referências

- **Home:** proporções medidas na captura de 736 px e convertidas para viewport. A palavra GAZU ocupa ≈85% da largura com altura de maiúscula ≈20% da largura; o modelo fica à frente das letras, centrado em ≈53%; chamada a ≈8,4% da borda; conteúdo das seções a ≈7,2% (mesmo recuo da referência); cabeçalho mais próximo da borda, como na referência.
- **Altura do hero:** a referência é uma composição de página inteira (~1000 px a 1440 de largura). Aqui o hero ocupa a primeira tela (`100svh` menos barra e cabeçalho), para que a chamada e o botão fiquem visíveis sem rolar.
- **Celular/tablet:** a referência só tem versão desktop. Com o modelo na escala proporcional da referência, ele cobriria “A” e “Z” numa tela estreita. A palavra sobe para o topo do palco e a cabeça do modelo sobrepõe apenas a base das letras — GAZU continua legível e o modelo mantém o impacto. Botões ficam abaixo do palco (nunca sobre o modelo).
- **Modelos sem pés:** as fotos do homem e da mulher são cortadas na coxa/joelho. Eles foram ancorados à base do hero com um esmaecimento suave de 7% para o corte não parecer acidental. Nenhuma parte foi inventada.
- **Bloco “Nova estação”:** usa uma foto do catálogo (camiseta básica) com tratamento em preto e branco via CSS para seguir a estética monocromática da referência. O arquivo não é alterado; remover o filtro em `home.css` (`.editorial__media img`) devolve as cores.
- **Página de produto:** reproduz a coluna de informações (voltar + detalhes, título grande, tamanho e cor sublinhados, botão octogonal com preço), a imagem central e a faixa lateral que vaza pela borda com contador “01 —— 0N”. Como **cada produto tem uma única foto**, a faixa mostra “Combine com” (produtos relacionados, identificados como tal) em vez de inventar ângulos; quando o produto tiver 2+ fotos, a faixa passa a ser a galeria do próprio produto automaticamente.
- **Quantidade e estoque** (não existem na referência) foram incluídos de forma discreta por exigência do PRD.

## Catálogo de demonstração

- 98 produtos montados a partir de 107 fotos; 5 duplicatas exatas e 3 imagens que não são produtos foram excluídas (ver inventário).
- Nomes descritivos, **sem marcas de terceiros**, apesar de várias fotos exibirem logotipos (esportivos, automobilísticos, de times).
- Preço, estoque e cor são ilustrativos (`is_demo = 1`, `color_confirmed = 0`), sinalizados na loja e excluídos da receita no painel.
- Dois produtos ficam propositalmente esgotados para demonstrar esse estado.

---

## Ciclo 2 — Prompt Master Definitivo (outubro/2026)

### Banco: SQLite agora, caminho para PostgreSQL documentado
O Prompt Master sugere PostgreSQL/Supabase "ou solução equivalente compatível". O registro npm continuou indisponível
(sem driver `pg`/Supabase), então o banco segue em SQLite (`node:sqlite`) com **migrations versionadas**
(`db/migrations/001–003`), chaves estrangeiras, `CHECK`, índices, `UNIQUE` para idempotência e transações
`BEGIN IMMEDIATE` para estoque. RLS não se aplica ao SQLite: **toda autorização é feita no servidor** (cliente só acessa
linhas com o próprio `user_id` ou com token assinado de visitante; painel exige permissão por rota). Migração para Postgres:
`docs/ESCALABILIDADE.md`.

### Permissões por função (servidor)
Seis funções (`owner`, `manager`, `catalog`, `finance`, `support`, `marketing`) com permissões explícitas em
`src/server/auth/permissions.ts`. Toda rota `/api/admin` chama `requirePermission()`; negações são auditadas. A interface
apenas esconde o que a pessoa não pode usar. O proprietário inicial é criado pela linha de comando; os demais membros criam a
própria conta e recebem a função pelo painel (sem contas compartilhadas, sem senha definida por terceiros).

### Compra sem cadastro
Usuário técnico `is_guest = 1` por e-mail + token por pedido (hash em `orders.guest_access_hash`), entregue por link no
e-mail e por cookie HttpOnly assinado no navegador da compra. Cadastrar-se depois com o mesmo e-mail exige ativação pelo
link enviado (prova de posse do e-mail), impedindo que alguém veja pedidos alheios.

### Eventos de domínio após o commit
Notificações, e-mails e atualizações derivadas reagem a eventos (`emit()` → `db.onCommit`), executados só depois de a
transação confirmar. Assim um rollback nunca dispara e-mail de "pagamento aprovado". Deduplicação por `notifications.dedupe_key`.

### Pagamentos: máquina de estados e fonte de verdade
Transições permitidas explícitas (`canTransition`), notificações fora de ordem são ignoradas, aprovação implícita
(ex.: `refunded` antes de `approved`) é tratada. O status vem sempre da consulta à API do provedor; a chave do evento inclui
`x-request-id` e `ts` para idempotência. Estornos ficam em `refunds` e só são "approved" com confirmação do provedor.

### Financeiro
Receita reconhecida na aprovação do pagamento; estorno na confirmação; custo do produto e da embalagem copiados para o
pedido no momento da venda (histórico estável). Qualquer custo desconhecido torna o indicador nulo — nunca estimado.
Fórmulas: `docs/FORMULAS-FINANCEIRAS.md`.

### Analytics próprio (first-party) com consentimento
Sem ferramentas de terceiros (sem chave, sem dependência e sem envio de dados a outras empresas): eventos só são enviados
depois do consentimento, com identificador de sessão anônimo, sem nome/e-mail/IP e com textos de busca higienizados.
Compras e receita vêm dos pagamentos aprovados, nunca da página de sucesso. Integração com GA4/Meta pode ser adicionada no
mesmo ponto (`src/client/lib/analytics.ts`) respeitando o consentimento.

### Rotinas, monitoramento e backups no próprio processo
Agendador interno simples (`setInterval`, sem sobreposição, registro em `job_runs`) ligado por `JOBS_ENABLED` em uma
única instância. Backups com `VACUUM INTO` + verificação por restauração em arquivo temporário. Alertas por e-mail/webhook.
Cópia externa e monitor de disponibilidade dependem da hospedagem (documentados, não ativos).

### Melhor Envio e WhatsApp Cloud API
Escolhidos por serem as integrações oficiais mais comuns para lojas brasileiras de pequeno porte (cotação multi-transportadora
com etiqueta; API oficial da Meta). Ambos implementados contra a API pública documentada e testados com respostas simuladas;
ativação exige contas da GAZU (`docs/INTEGRACOES.md`). Sem WhatsApp API o site oferece só o link `wa.me` — nunca apresentado
como atendimento automatizado.

### Divisão de código
O painel administrativo é carregado sob demanda (`React.lazy` + `splitting` do esbuild): visitantes não baixam os ~180 KB
do painel. Medido neste build (minificado, antes de gzip): sem divisão, 603 KB; com divisão, a loja carrega ~430 KB
(pacote principal 375 KB + bloco compartilhado 55 KB) e o painel (~185 KB) só é baixado em `/admin`.

### Kit de marca gerado por script
`scripts/assets/build-brand-kit.mjs` gera logotipos, favicons, ícones, imagens sociais e materiais impressos (SVG/PDF em
milímetros) a partir dos vetores do logotipo — uma única fonte de verdade, reprodutível. Detalhes: `docs/IDENTIDADE-VISUAL.md`.

### Versão HTML autônoma
Continua sendo uma **demonstração** (não substitui a loja): o catálogo é editável no navegador e o conteúdo editorial é um
retrato das respostas públicas do servidor real gerado no build (`scripts/standalone-seed.ts`). Recursos que dependem de
servidor respondem "disponível apenas na loja completa"; o painel da demonstração mostra apenas os módulos que funcionam
localmente e é acessado por um botão (sem senha publicada).

### Ferramentas de teste
Vitest/Testing Library não estavam disponíveis offline. Equivalentes usados: `node:test` + `tsx` (unitários e integração
com o servidor HTTP real e banco em memória) e Playwright/Chromium (ponta a ponta, visual e versão HTML). A checagem de tipos
do front-end usa um "shim" local dos tipos do React (ver `docs/RELATORIO-TESTES.md`); com `npm install` normal, `npm run typecheck`
cobre tudo com os tipos oficiais.
