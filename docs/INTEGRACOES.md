# Integrações externas — GAZU

Situação de cada integração **neste pacote**: o código está implementado e testado com respostas simuladas do provedor
(testes automatizados), mas **nenhuma integração foi ativada com credenciais reais** — isso depende de contas e chaves
que só a GAZU pode criar. Nenhuma credencial foi inventada ou incluída no projeto.

| Integração | Para quê | Situação | Variáveis | Sem configurar… |
|---|---|---|---|---|
| Mercado Pago | Pix, cartão (SDK oficial), boleto, estornos, taxas | Implementado · testado com API simulada · **aguardando credenciais** | `PAYMENT_PROVIDER=mercadopago`, `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`, `MP_ENABLED_METHODS`, `MP_MAX_INSTALLMENTS`, `PIX_EXPIRATION_MINUTES`, `BOLETO_DAYS` | Checkout não oferece pagamento real (em desenvolvimento: pagamento simulado). |
| Melhor Envio | Cotação, compra de etiqueta, rastreio | Implementado · testado com API simulada · **aguardando token** | `SHIPPING_PROVIDER=melhorenvio`, `MELHORENVIO_TOKEN`, `MELHORENVIO_ENV`, `MELHORENVIO_USER_AGENT`, `SHIPPING_ORIGIN_CEP`, `MELHORENVIO_SERVICES`, `PACKAGE_DEFAULT` + remetente em Configurações | Frete por regras manuais do painel; envio e rastreio registrados à mão. |
| Resend (e-mail) | E-mails transacionais e alertas | Implementado · **aguardando chave e domínio** | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` | E-mails só ficam registrados na fila (status "registrado"); **nada é enviado**. |
| Google (login) | "Continuar com Google" | Implementado · **aguardando cliente OAuth** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Botão oculto; login por e-mail e senha. |
| WhatsApp Cloud API | Receber/responder mensagens na central | Implementado · testado com API simulada · **aguardando conta Business** | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Botão flutuante abre o WhatsApp (link wa.me com o número das Configurações). Sem atendimento automatizado nem conversas simuladas. |
| ViaCEP | Preencher endereço pelo CEP | Ativo (serviço público, sem chave) | — | Se falhar, o formulário segue manual. |
| Alertas | Avisar erros críticos e divergências | Implementado · **aguardando destino** | `ALERT_EMAIL` e/ou `ALERT_WEBHOOK_URL` | Alertas só aparecem no painel (Operação). |

---

## 1. Mercado Pago

**Pré-requisitos:** conta Mercado Pago de vendedor (PJ recomendada) com Pix e cartões habilitados; para boleto, habilitar
o meio na conta. Em "Suas integrações" crie uma aplicação (Checkout Transparente / API de Pagamentos).

**Credenciais:** use primeiro as de **teste** (contas de teste comprador/vendedor do próprio Mercado Pago) e só depois as de produção.
- `MP_ACCESS_TOKEN` — privado; só no servidor (`.env`/painel do provedor de hospedagem).
- `MP_PUBLIC_KEY` — pública; enviada ao navegador apenas para o SDK oficial (`sdk.mercadopago.com/js/v2`) tokenizar o cartão.
- `MP_WEBHOOK_SECRET` — "assinatura secreta" mostrada na configuração de Webhooks.

**Webhook:** URL `{APP_URL}/api/webhooks/mercadopago`, evento **Pagamentos**. O servidor:
1. recusa (401) se `MP_WEBHOOK_SECRET` não estiver configurado ou se a assinatura `x-signature` (HMAC-SHA256 de
   `id:{data.id};request-id:{x-request-id};ts:{ts};`, tolerância de 10 min) for inválida;
2. registra o evento com chave única (idempotência — reenvios não duplicam efeitos);
3. **consulta o pagamento na API** do Mercado Pago (o corpo da notificação nunca é fonte de verdade);
4. confere pedido (`external_reference`) e valor; aplica a transição pela máquina de estados (notificações fora de ordem
   não fazem o status "voltar"); grava taxa (`fee_details`) e valor líquido;
5. responde 502 em falha temporária para o Mercado Pago reenviar. Painel › Operação permite reprocessar eventos.

**Cartão:** o número, validade e CVV são digitados em campos do SDK oficial e viram um token no navegador; o servidor da
GAZU recebe apenas o token, o `payment_method_id`, o emissor e as parcelas. Nunca armazenamos número completo nem CVV.
Parcelas: consultadas na API (`/v1/payment_methods/installments`) até `MP_MAX_INSTALLMENTS`; juros conforme a conta.

**Pix:** QR Code e "copia e cola" retornados pelo provedor, expiração `PIX_EXPIRATION_MINUTES`. **Boleto:** linha digitável
e PDF do provedor, vencimento `BOLETO_DAYS`; exige CPF e endereço do pagador.

**Estornos e cancelamentos:** sempre pela API (`/v1/payments/{id}/refunds`); o status "reembolsado"/"parcialmente reembolsado"
só é aplicado com a confirmação do provedor. Não existe ação para "marcar como pago" manualmente.

**Reconciliação:** a rotina `reconciliar-pagamentos` (10 min) consulta pagamentos pendentes/em processamento e reprocessa
eventos com erro; `expirar-pedidos` (1 min) consulta o provedor e, sem cobrança válida, cancela o pedido não pago e devolve
o estoque reservado. Cancelamentos pelo cliente ou pelo painel cancelam também a cobrança pendente no provedor.

**Ativação (checklist):** credenciais de teste → `PAYMENT_PROVIDER=mercadopago` → webhook apontando para o domínio público
(https) → compra de teste com cartão de teste aprovado, recusado e Pix → conferir Painel › Operação (webhooks "processed",
assinatura válida) → trocar para credenciais de produção → uma compra real de baixo valor **autorizada pela GAZU** e
estorno dela pelo painel.

## 2. Melhor Envio

**Pré-requisitos:** conta no Melhor Envio com saldo/carteira e dados do remetente; token com permissões de cotação
(`shipping-calculate`), carrinho/compra/geração/impressão de etiquetas (`cart-*`, `shipping-checkout`, `shipping-generate`,
`shipping-print`) e rastreio (`shipping-tracking`).

**Configuração:** `.env` (token, ambiente, CEP de origem, user agent) + Painel › Configurações › Remetente (nome, documento,
telefone, e-mail, endereço completo). Produtos sem peso/medidas usam `PACKAGE_DEFAULT`.

**Fluxo:** cotação no carrinho/checkout (o servidor recalcula o frete escolhido na criação do pedido) → no pedido pago,
Painel › Pedido › "Comprar etiqueta" (inserir no carrinho → comprar → gerar → imprimir) → link da etiqueta e código de
rastreio gravados no envio → rotina `rastrear-envios` (60 min) atualiza status (postado, em trânsito, entregue, falha,
devolvido) e notifica o cliente. O custo da etiqueta vira o custo de frete do pedido no Financeiro.

**Ativação:** começar com `MELHORENVIO_ENV=sandbox` (etiquetas sem validade) → cotar e comprar uma etiqueta de teste →
`production` → primeira etiqueta real de um pedido real.

## 3. Resend (e-mails)

Criar conta, **verificar o domínio** (registros SPF/DKIM no DNS), gerar `RESEND_API_KEY`, definir `EMAIL_FROM` com o domínio
verificado e `EMAIL_PROVIDER=resend`. E-mails com falha são reenviados pela rotina `reenviar-emails` (até 3 tentativas) e
podem ser reenviados no Painel › Operação. Corpo de e-mails de acesso (links com token) é apagado da fila após 3 dias.

## 4. Login com Google

Google Cloud Console › APIs e serviços › Credenciais › ID do cliente OAuth (Aplicativo da Web). Origem autorizada: `APP_URL`.
URI de redirecionamento: `{APP_URL}/api/auth/google/callback`. Tela de consentimento com nome, logotipo e links de
privacidade/termos da GAZU. O login vincula a conta pelo e-mail verificado do Google.

## 5. WhatsApp Business (Cloud API)

Requer conta Meta Business verificada, número dedicado registrado na Cloud API, **token permanente** (usuário do sistema),
App Secret e um token de verificação escolhido pela GAZU.
- Webhook: `{APP_URL}/api/webhooks/whatsapp` — verificação GET (`hub.verify_token` = `WHATSAPP_VERIFY_TOKEN`) e POST
  assinado (`X-Hub-Signature-256` com `WHATSAPP_APP_SECRET`); assine o campo **messages**.
- Mensagens recebidas abrem/atualizam um atendimento na central (canal WhatsApp). Respostas do painel são enviadas pela API
  **somente dentro da janela de 24 h** da última mensagem do cliente; fora dela, a resposta segue por e-mail (mensagens fora
  da janela exigem modelo aprovado pela Meta — não implementado).
- Sem a API: o botão do site usa `wa.me/<número de Configurações>` com mensagem padrão — nenhuma conversa é simulada.

## 6. Alertas

`ALERT_EMAIL` (requer Resend) e/ou `ALERT_WEBHOOK_URL` (recebe `POST {"text": "..."}`, compatível com Slack/Discord/Teams via
webhook de entrada). Disparados para erros críticos e divergências encontradas pela rotina `consistencia`, com
agrupamento para não repetir o mesmo alerta.

## 7. Onde as chaves ficam

Somente nas variáveis de ambiente do servidor (arquivo `.env` fora do repositório ou painel de variáveis da hospedagem).
O navegador recebe apenas `MP_PUBLIC_KEY` (pública por definição). Logs e auditoria removem tokens, senhas, CPF completo e
dados de cartão (`redact()` em `services/audit.ts`). A rota `/api/config` foi testada para não expor nenhum segredo.
