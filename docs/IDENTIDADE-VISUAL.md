# GAZU — Sistema de identidade visual

Documento de referência da marca para o site, o painel, os e-mails, as redes sociais e a embalagem.
Os valores abaixo são os mesmos usados no código (`src/client/styles/tokens.css`) e nos arquivos gerados por
`node scripts/assets/build-brand-kit.mjs`. Ao mudar um valor aqui, mude também no código (e vice-versa).

> Origem: o logotipo foi vetorizado da proposta original enviada pela GAZU (`assets-source/branding/gazu-logo-original.png`),
> sem redesenho das letras. A paleta e a tipografia seguem o PRD e as imagens de referência do projeto.
> Nenhum material físico foi produzido: os arquivos de impressão estão prontos para revisão com a gráfica.

---

## 1. Essência e tom

**Posicionamento:** moda casual e urbana para toda a família (masculino, feminino e infantil), com visual editorial,
limpo e contemporâneo. Assinatura: **"Moda que se move com você."**

**Atributos:** essencial · urbano · confiante · acolhedor · honesto.

### Tom de voz

| Faça | Evite |
|---|---|
| Frases curtas e diretas, em português do Brasil. | Jargão, anglicismos desnecessários, CAIXA ALTA em frases inteiras. |
| Tratar por "você". | "Prezado cliente", "Caro(a) usuário(a)". |
| Dizer exatamente o que acontece ("O pagamento foi aprovado pelo Mercado Pago."). | Promessas que a loja não controla ("Entrega garantida amanhã!"). |
| Informar prazos e condições reais, com a fonte (transportadora, provedor, CDC). | Urgência artificial ("Últimas unidades!" sem estoque real baixo). |
| Assumir erros e dizer o próximo passo ("Não conseguimos gerar o Pix. Tente de novo ou escolha cartão."). | Mensagens técnicas ("Erro 500", "Falha na transação"). |
| Descrever o produto pelo que ele é (tecido, caimento, uso). | Superlativos vazios ("a melhor camiseta do Brasil"), avaliações ou números inventados. |

Exemplos aplicados no site:
- Botões: verbos no infinitivo — **Comprar agora**, **Adicionar à sacola**, **Ver coleção**, **Avise-me**.
- Estados vazios: explicam e oferecem saída — "Sua sacola está vazia. Que tal começar pelas novidades?"
- Selos ("Novo", "Últimas unidades", "Promoção") só aparecem quando o dado existe (data de publicação, estoque, preço promocional vigente).

---

## 2. Logotipo

| Arquivo | Uso |
|---|---|
| `public/assets/branding/logo/gazu-logo-preto.svg` (+ `-2000.png`) | Padrão. Fundos claros: off-white, pedra, branco. |
| `public/assets/branding/logo/gazu-logo-branco.svg` (+ `-2000.png`) | Fundos escuros e fotos com área escura uniforme. |
| `gazu-logo-preto-sobre-offwhite.svg`, `gazu-logo-branco-sobre-preto.svg` | Versões com fundo, para terceiros que pedem arquivo "fechado". |
| `gazu-wordmark.svg` | Vetor-fonte (cor = `currentColor`), usado pelo site. |
| `gazu-logo.svg` | Versão com o traço inferior da proposta original. |
| `gazu-monograma-preto.svg` / `gazu-monograma-branco.svg` | Monograma "G": favicon, avatar, lacre, padrões. |
| `gazu-logo-email.png` | Cabeçalho dos e-mails (264 × 48 px, exibido a 132 px). |

**Área de proteção:** no mínimo **36% da altura do logotipo** livre em todos os lados (nos arquivos acima ela já está embutida).
**Tamanho mínimo:** logotipo 72 px de largura (tela) / 20 mm (impresso); monograma 16 px / 6 mm.

**Claro × escuro:**
- Fundo claro → logotipo preto `#111111`. Fundo escuro → logotipo off-white `#F7F6F3` ou branco.
- Sobre foto: só onde a área atrás do logotipo for uniforme; caso contrário, use uma faixa sólida.

**Não faça:** distorcer ou inclinar; trocar a fonte; aplicar sombra, contorno, gradiente ou cores fora da paleta;
recriar o logotipo digitando "GAZU"; colocar sobre fundos com contraste menor que 4,5 : 1.

---

## 3. Paleta

| Nome | Hex | Token | Uso |
|---|---|---|---|
| Preto GAZU | `#111111` | `--c-black` | Texto, logotipo, botões primários, rodapé. |
| Grafite | `#242424` | `--c-graphite` | Texto longo, superfícies escuras secundárias. |
| Off-white | `#F7F6F3` | `--c-offwhite` | Fundo padrão do site, e-mails e embalagem. |
| Pedra | `#E8E7E3` | `--c-stone` | Hero, faixa de confiança, cartão de agradecimento. |
| Pedra escura | `#DCDBD7` | `--c-stone-2` | Blocos editoriais ("Nova estação"), padrões. |
| Moldura de foto | `#ECEBE7` | `--c-photo` | Fundo enquanto a foto carrega. |
| Branco | `#FFFFFF` | `--c-white` | Cartões, painel, formulários. |
| Cinza de apoio | `#6B6B6B` | `--c-muted` | Legendas e textos auxiliares. |
| Linha | `#D6D5D0` / `#E6E5E1` | `--c-line` / `--c-line-soft` | Divisórias e bordas. |
| Estados | `#2F6B46` sucesso · `#8A5A12` atenção · `#A3271F` erro · `#2D4A6B` informação | `--c-success` etc. | Somente feedback de sistema, nunca decoração. |

**Contraste (WCAG 2.1, medido):** preto sobre branco 18,9 : 1 · preto sobre off-white 17,5 · preto sobre pedra 15,3 ·
cinza de apoio sobre branco 5,3 · sobre off-white 4,9 · sobre pedra 4,3 (use só em texto ≥ 18,66 px negrito ou ≥ 24 px) ·
estados sobre branco ≥ 5,9. Texto principal sempre ≥ 4,5 : 1.

---

## 4. Tipografia

Família: **Inter** (texto) e **Inter Display** (títulos) — licença SIL Open Font License, arquivos em
`public/assets/branding/fonts/` (WOFF para o site) e `assets-source/branding/fonts/` (OTF para design/gráfica).
Fallback: `'Helvetica Neue', Arial, sans-serif`.

| Papel | Fonte / peso | Tamanho (token) | Observação |
|---|---|---|---|
| Display (hero) | Inter Display Bold | `--fs-3xl` clamp(41.6 → 84 px) | Caixa alta, entrelinha 0,95–1,05. |
| Título de seção | Inter Display Bold | `--fs-2xl` clamp(32 → 52 px) | Caixa alta, tracking −0,01em. |
| Título de página | Inter Display Bold | `--fs-xl` clamp(24 → 32 px) | |
| Subtítulo | Inter SemiBold | `--fs-lg` 22 px | |
| Texto | Inter Regular | `--fs-base` 15 px / `--fs-md` 17 px | Entrelinha 1,5–1,6. |
| Rótulos, botões, sobretítulos | Inter Medium/SemiBold | `--fs-micro` 11 px | Caixa alta, tracking `--tracking-caps` 0,14em (amplo: 0,22em). |
| Auxiliar | Inter Regular | `--fs-xs` 12 px / `--fs-sm` 13 px | |

Preços usam algarismos tabulares (`font-variant-numeric: tabular-nums`).

---

## 5. Espaçamento, grade e formas

- **Contêiner:** 1440 px. **Margem lateral:** `--gutter` = clamp(16 px, 7,2vw, 108 px); cabeçalho `--header-gutter` = clamp(16, 3,9vw, 56).
- **Escala de espaço:** múltiplos de 4 px (4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96). Seções da home: 64–120 px verticais.
- **Grade de produtos:** 2 colunas (celular), 3 (tablet), 4 (desktop); vão de 12–24 px.
- **Cantos:** retos (`--radius: 0`); exceções: pontos do lookbook e indicadores circulares.
- **Sombras:** apenas em elementos flutuantes (`--shadow-pop`). Foco do teclado: anel duplo branco + preto (`--focus`).
- **Fotos de produto:** proporção 4 : 5, exibidas inteiras (`object-fit: cover` só em miniaturas).

---

## 6. Direção de fotografia

- **Luz natural ou de estúdio suave**, sombras leves; cores fiéis à peça (sem filtros que alterem o tom do tecido).
- **Fundos neutros** (pedra, off-white, concreto, parede clara) ou **cenário urbano** limpo; nada que dispute com a roupa.
- **Corpo inteiro e meio corpo** para looks; detalhes (textura, etiqueta, costura) em close para a galeria do produto.
- **Enquadramento 4 : 5** (produto) e **16 : 9 / 4 : 5** (banners desktop/celular), com a peça centralizada e respiro para texto.
- **Mínimo 1600 px** no lado maior (o hero atual tem fotos de 300–624 px — substituir por originais em alta resolução).
- **Modelos reais e diversos**, poses naturais em movimento (coerente com "Moda que se move com você").
- **Cada foto mostra apenas o produto cadastrado**; no lookbook, só são marcados produtos que aparecem de fato na foto.
- Sem marcas de terceiros visíveis sem licença; confirmar direitos de uso de toda imagem (ver `docs/INVENTARIO-IMAGENS.md`).
- Texto alternativo descreve peça, cor e contexto ("Camisa de linho off-white com bermuda preta, vista frontal").

---

## 7. Linguagem de movimento

| Token | Valor | Uso |
|---|---|---|
| `--dur-fast` | 160 ms | Hover, foco, troca de cor de botão. |
| `--dur` | 320 ms | Abrir/fechar gaveta, menu, acordeão, painel. |
| `--dur-slow` | 700 ms | Revelação de seções ao rolar (`.reveal`). |
| `--ease-out` | cubic-bezier(0.16, 1, 0.3, 1) | Entradas. |
| `--ease-in-out` | cubic-bezier(0.65, 0, 0.35, 1) | Transições entre estados. |

- **Hero:** os quatro modelos se alternam com entrada de 1100 ms, permanência de 3 s e saída de 800 ms (sobreposição de 45%);
  para quando a aba fica oculta; controles anterior / próximo / pausar.
- **Princípios:** movimento curto, vertical e sutil (deslocamento ≤ 26 px); nada pisca; nada se move sozinho sem controle de pausa.
- **Acessibilidade:** com `prefers-reduced-motion: reduce` todas as durações caem para 1 ms e o hero não troca sozinho
  (a pessoa avança pelos controles, com esmaecimento curto).

---

## 8. Banners e peças digitais

| Peça | Tamanho | Observação |
|---|---|---|
| Hero (modelos recortados) | PNG/WebP com fundo transparente, ≥ 1600 px de altura | Os quatro modelos do hero ficam em `public/assets/hero/`. |
| Banner editorial | 1920 × 1080 (16 : 9), assunto centralizado | Painel › Conteúdo › Banners — uma imagem por banner, recortada no celular; mantenha o assunto no centro. |
| Banner de categoria/coleção | 1600 × 2000 (4 : 5) | Capa de coleção no Archive. |
| Barra de avisos | texto até 90 caracteres | Painel › Conteúdo › Avisos do topo, com início e fim. |
| Imagem de compartilhamento (OG) | 1200 × 630 | `public/assets/branding/og-image.png`. |
| Avatar redes sociais | 1080 × 1080 | `social/gazu-avatar-preto-1080.png` (e versão clara). |
| Capa redes sociais | 1500 × 500 | `social/gazu-capa-1500x500.png`. |

Texto sobre imagem: sempre em área uniforme, contraste ≥ 4,5 : 1; no máximo um título, uma linha de apoio e um botão.

---

## 9. Favicon e ícones

`public/favicon.svg` (alterna preto/claro conforme o tema do navegador), `favicon-16/32/48.png`, `apple-touch-icon.png` (180),
`icon-192.png`, `icon-512.png`, `icon-maskable-512.png` e `site.webmanifest` (cor do tema `#111111`, fundo `#F7F6F3`).

---

## 10. Embalagem e materiais impressos

Arquivos em `public/assets/branding/print/` — **SVG e PDF no tamanho real** (milímetros) e uma prova A4 (`gazu-prova-materiais.pdf`).
Campos variáveis ficam em branco; nenhum preço, SKU ou dado de pedido é impresso de antemão.

| Peça | Tamanho | Conteúdo |
|---|---|---|
| Tag de roupa (frente/verso) | 50 × 90 mm, furo Ø 4 mm | Logotipo + assinatura / campos produto, tamanho, cor, SKU, preço. |
| Cartão de agradecimento (frente/verso) | A6 105 × 148 mm | "Obrigado" / ajuda, trocas e direito de arrependimento (CDC art. 49). |
| Adesivo de lacre (preto/claro) | Ø 50 mm | Monograma. |
| Cartão de cuidados | A6 | Cuidados gerais; a etiqueta interna da peça prevalece. |
| Formulário de troca e devolução | A5 148 × 210 mm | Passo a passo + campos do pedido, itens e tipo de solicitação. |
| Tampa da caixa | 300 × 220 mm | Ajustar à faca (dimensões) do fornecedor da caixa. |
| Papel de seda | módulo 200 × 200 mm | Padrão repetível de monogramas em pedra escura sobre off-white. |
| Etiqueta de remetente | 100 × 150 mm | Complementa — não substitui — a etiqueta da transportadora (Melhor Envio). |

**Para a gráfica:** confirmar papel (sugestão: tag e cartões em papel 300 g/m² fosco; adesivo vinil fosco), sangria de 2–3 mm
(acrescentar no arquivo final conforme o fornecedor), cores em CMYK aproximado — Preto GAZU: rico 60/40/40/100; Pedra: 0/0/2/9;
Off-white: 0/0/1/3 (valores de partida, validar com prova impressa). Converter textos em curvas se a gráfica não tiver a fonte Inter.

**Kit de envio sugerido:** caixa ou envelope → papel de seda envolvendo as peças → lacre → cartão de agradecimento +
cartão de cuidados + formulário de troca → etiqueta da transportadora (+ remetente, opcional).

---

## 11. E-mails

Todos os e-mails transacionais (pedido recebido, pagamento aprovado/recusado/expirado, Pix e boleto, envio, entrega,
cancelamento, estorno, trocas, atendimento, lista de espera, newsletter, verificação de conta e redefinição de senha) usam
`renderBrandEmail()` em `src/server/services/notifications.ts`:

- Fundo off-white, cartão branco de 560 px, cabeçalho com `gazu-logo-email.png` (texto alternativo "GAZU") e assinatura.
- Título em caixa alta (20 px), texto 15 px, tabela de resumo, **um** botão primário preto.
- Rodapé com contato, razão social e CNPJ **apenas quando preenchidos em Configurações** (nada é inventado).
- Sempre há versão em texto puro. Pré-visualização: Painel › Marca › "Ver modelo de e-mail" (`/api/admin/email-preview`).

---

## 12. Onde editar

| O quê | Onde |
|---|---|
| Cores, fontes, espaçamento, movimento | `src/client/styles/tokens.css` |
| Logotipo no site | `src/client/components/ui/Logo.tsx` |
| Arquivos de marca e impressos | `scripts/assets/build-brand-kit.mjs` → `public/assets/branding/` |
| Textos do hero e ordem das seções da home | Painel › Configurações |
| Avisos, banners, coleções, lookbooks, journal, FAQ, páginas | Painel › Conteúdo e vitrine |
| Modelo de e-mail | `src/server/services/notifications.ts` |
