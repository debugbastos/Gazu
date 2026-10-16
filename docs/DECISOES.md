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
