# Pendências, dependências externas e ativação — GAZU

Situação em 18/10/2026. O código está implementado e testado em desenvolvimento (ver `docs/RELATORIO-TESTES.md` e
`docs/REQUISITOS.md`). **A loja não está pronta para vender** até que os itens críticos abaixo sejam resolvidos e verificados
em produção (`docs/CHECKLIST-PRODUCAO.md`). Nada disso é simulado em produção: sem a configuração, o site informa que o
recurso não está disponível.

## 1. Credenciais e serviços que a GAZU precisa configurar

> **Não envie chaves por chat, e-mail ou ticket.** Cada valor é colado diretamente nas variáveis de ambiente do servidor
> (arquivo `.env` com permissão restrita ou painel de variáveis da hospedagem). Nomes exatos em `.env.example`.

| Serviço | O que criar | Variáveis | Prioridade |
|---|---|---|---|
| Hospedagem Node 22 com disco persistente | Servidor/serviço + domínio + HTTPS | `APP_URL`, `TRUST_PROXY`, `SESSION_SECRET` (gerar no servidor) | Crítica |
| Mercado Pago | Conta vendedora, aplicação, credenciais de teste e de produção, webhook | `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET` (ou `MERCADOPAGO_*`), `MP_ENABLED_METHODS`, `MP_MAX_INSTALLMENTS` | Crítica |
| Resend | Conta + domínio verificado (SPF/DKIM) | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_PROVIDER=resend` | Crítica |
| Frete | Melhor Envio (token com permissões de cotação/etiqueta/rastreio) **ou** regras manuais reais | `MELHORENVIO_TOKEN`, `MELHORENVIO_ENV`, `SHIPPING_ORIGIN_CEP`, `MELHORENVIO_USER_AGENT` | Crítica |
| Armazenamento externo de backups | Bucket/snapshots com credencial só de gravação | configurado na hospedagem (fora do app) | Crítica |
| Alertas | E-mail de operação e/ou webhook (Slack/Discord/Teams) | `ALERT_EMAIL`, `ALERT_WEBHOOK_URL` | Importante |
| Monitor de disponibilidade | UptimeRobot, Better Stack ou similar em `/api/health` | — | Importante |
| Google (opcional) | Cliente OAuth "Aplicativo da Web" | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Opcional |
| WhatsApp Cloud API (opcional) | Meta Business verificada, número, token permanente, App Secret | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Opcional |

Procedimentos passo a passo: `docs/INTEGRACOES.md`.

## 2. Dados e decisões que dependem da GAZU

| Item | Situação atual | Onde resolver |
|---|---|---|
| Catálogo real (preços, estoque, cores confirmadas, tamanhos, composição, cuidados, medidas, custos, peso/dimensões) | 98 produtos **de demonstração** sinalizados; composição/medidas/custos vazios (nada inventado) | Painel › Produtos e › Qualidade do catálogo |
| Fotos | 1 foto por produto; hero com resolução baixa (300–624 px); **direito de uso e autenticidade a confirmar** (há marcas de terceiros e uma marca d'água) | Painel › Produtos › Imagens; `assets-source/` |
| Dados da empresa (razão social, CNPJ, endereço), contato, horário, WhatsApp, redes | Vazios — rodapé e e-mails omitem em vez de inventar | Painel › Configurações |
| Políticas (privacidade, termos, trocas além dos 7 dias legais, entrega, pagamento, cancelamento) | Textos-base sinalizados como pendentes de revisão | Painel › Conteúdo › Páginas e `src/client/pages/Static.tsx` |
| Prazo comercial de trocas, custo de embalagem, janela de "novidades", estoque baixo, horas para carrinho abandonado | Valores padrão/vazios | Painel › Configurações › Operação e custos |
| Remetente das etiquetas | Vazio | Painel › Configurações › Remetente |
| Conteúdo editorial (coleções, lookbooks, journal, FAQ) | Exemplos de demonstração montados com fotos do catálogo | Painel › Conteúdo e vitrine |
| Cupom `BEMVINDO10` | Ativo, marcado como demonstração | Painel › Cupons |
| Equipe e funções | Só o proprietário criado por linha de comando | Painel › Equipe |
| Materiais impressos | Arquivos prontos; nenhum produzido | Gráfica (`public/assets/branding/print/`) |
| Fonte oficial | Inter / Inter Display (OFL) | `styles/tokens.css` |

## 3. Pendências técnicas (do próprio projeto)

| Item | Detalhe |
|---|---|
| Vale-presente | Não implementado (opcional no Prompt Master). Exige definição comercial e fiscal. |
| Redirecionamento de URLs antigas | Ao mudar o slug de um produto, a URL antiga dá 404 (não há tabela de redirecionamento). |
| Testes em aparelhos modestos e rede lenta | Não executados (sem dispositivos neste ambiente). |
| Checagem de tipos do front com os tipos oficiais do React | Feita com um "shim" local (registro npm indisponível); rodar `npm install && npm run typecheck` no primeiro ambiente com internet. |
| Mensagens de WhatsApp fora da janela de 24 h | Exigem modelos aprovados pela Meta — não implementado (resposta segue por e-mail). |
| Cartão de débito / carteiras | Não habilitados (dependem da conta MP). |
| Limitador de tentativas | Em memória (uma instância). Com várias instâncias, mover para Redis. |
| Busca | `LIKE` normalizado + correção por similaridade; para catálogos muito grandes, FTS5/Postgres. |
| Banco | SQLite (equivalente adotado). Migração para Postgres documentada em `docs/ESCALABILIDADE.md` §3. |
| Auditoria com leitor de tela real | Não executada; a navegação por teclado e os rótulos foram testados automaticamente. |

## 4. Ordem sugerida de ativação
1. Hospedagem + domínio + HTTPS + `.env` de produção (sem `demo`).
2. Dados da empresa, políticas revisadas, catálogo real (com custos) e equipe.
3. Resend (e-mails) → Mercado Pago em **teste** → testes completos → produção com compra real autorizada e estorno.
4. Frete (Melhor Envio ou regras manuais reais) → primeira etiqueta.
5. Backups externos + teste de restauração em produção + alertas + monitor.
6. Opcionais: Google, WhatsApp Cloud API, Search Console.
