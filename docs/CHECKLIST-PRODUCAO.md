# Checklist de produção — GAZU

**Estado em 18/10/2026: NÃO está pronto para vender.** O código está implementado e testado em desenvolvimento, mas os
itens críticos abaixo dependem de contas, credenciais, dados comerciais e infraestrutura da GAZU. Marque cada item somente
depois de executado **e verificado** no ambiente de produção.

Legenda: 🔴 crítico (impede vender) · 🟠 importante (antes de divulgar) · 🟢 recomendado

## 1. Infraestrutura
- [ ] 🔴 Servidor Node 22 com disco persistente (VPS, Render, Railway, Fly.io…) e processo supervisionado (systemd/PM2).
- [ ] 🔴 Domínio próprio com **HTTPS** e `APP_URL=https://…`; `TRUST_PROXY=1` se houver proxy reverso.
- [ ] 🔴 `NODE_ENV=production`, `SESSION_SECRET` aleatório (48 bytes), `.env` fora do repositório, permissões 600.
- [ ] 🔴 `DEMO_MODE=false`; `PAYMENT_PROVIDER` e `SHIPPING_PROVIDER` diferentes de `demo` (o servidor recusa `demo` em produção).
- [ ] 🔴 `npm run build` + `npm start`; migrations aplicadas na inicialização (conferir Painel › Operação).
- [ ] 🟠 `JOBS_ENABLED=true` em **uma** instância.

## 2. Dados comerciais (responsável pela loja)
- [ ] 🔴 Remover ou substituir **todos** os produtos de demonstração (preço, estoque, cores, medidas e fotos reais, com direito de uso) — Painel › Qualidade do catálogo sem bloqueios e sem "Dados de demonstração".
- [ ] 🔴 Custos de aquisição cadastrados (sem eles o Financeiro não calcula margem/lucro).
- [ ] 🔴 Razão social, CNPJ, endereço, e-mail, telefone/WhatsApp e horário — Painel › Configurações.
- [ ] 🔴 Políticas de privacidade, termos, trocas/devoluções, entrega, pagamento e cancelamento **revisadas por profissional** (textos atuais são base e sinalizam pendência).
- [ ] 🔴 Prazo comercial de trocas (Configurações › Operação) definido pela loja (o direito de arrependimento de 7 dias já é aplicado).
- [ ] 🟠 Custo de embalagem por pedido, remetente e dimensões dos produtos.
- [ ] 🟠 Desativar o cupom de demonstração `BEMVINDO10` e o conteúdo editorial de demonstração (coleções, lookbooks, journal marcados "demo").

## 3. Pagamentos — Mercado Pago (`docs/INTEGRACOES.md` §1)
- [ ] 🔴 Conta vendedora aprovada; meios habilitados (Pix, cartão, boleto) conferidos com `MP_ENABLED_METHODS`.
- [ ] 🔴 Testes com **credenciais de teste**: cartão aprovado, recusado, pendente; Pix; boleto; expiração; estorno total e parcial.
- [ ] 🔴 Webhook configurado em `https://…/api/webhooks/mercadopago` com `MP_WEBHOOK_SECRET`; Painel › Operação mostra eventos "processed" com assinatura válida e nenhum rejeitado.
- [ ] 🔴 Credenciais de produção; **uma compra real de baixo valor autorizada pela GAZU** + estorno pelo painel.
- [ ] 🟠 Parcelamento (`MP_MAX_INSTALLMENTS`) e condições de juros conferidos na conta.

## 4. Entrega (`docs/INTEGRACOES.md` §2)
- [ ] 🔴 Escolher: Melhor Envio (token, CEP de origem, remetente) **ou** regras manuais de frete reais no painel (sem valores inventados).
- [ ] 🟠 Melhor Envio: cotação conferida no sandbox → produção → primeira etiqueta real → rastreio atualizado pela rotina.
- [ ] 🟠 Fluxo de postagem/coleta definido com a transportadora.

## 5. E-mail, login e atendimento
- [ ] 🔴 Resend com domínio verificado (SPF/DKIM), `EMAIL_PROVIDER=resend`; enviar e receber um e-mail de pedido de teste.
- [ ] 🟠 Login com Google (opcional): cliente OAuth com o domínio de produção.
- [ ] 🟠 WhatsApp: número configurado em Configurações (link) **ou** Cloud API (opcional) com webhook validado.
- [ ] 🟠 Equipe: cada pessoa com conta própria e função adequada (Painel › Equipe); nenhum acesso compartilhado.

## 6. Confiabilidade
- [ ] 🔴 Backups automáticos rodando (Painel › Operação mostra backup "verificado" nas últimas 24 h).
- [ ] 🔴 **Cópia externa** dos backups (snapshot do volume ou sincronização para armazenamento de objetos) — e um **teste de restauração em produção** registrado.
- [ ] 🟠 `ALERT_EMAIL` e/ou `ALERT_WEBHOOK_URL` configurados e um alerta de teste recebido.
- [ ] 🟠 Monitor de disponibilidade externo em `/api/health`.
- [ ] 🟢 Logs do processo com rotação (journald/PM2).

## 7. Qualidade antes do lançamento
- [ ] 🔴 `npm test`, `npm run test:e2e`, `npm run test:visual` e `npm run typecheck` (com `npm install` completo) sem falhas.
- [ ] 🟠 Revisão manual em celulares reais (iOS e Android) e navegação por teclado.
- [ ] 🟠 Lighthouse/PageSpeed na home, categoria e produto (com fotos reais em alta resolução).
- [ ] 🟠 Sitemap enviado ao Google Search Console; `robots.txt` conferido.
- [ ] 🟢 Faixa de cookies revisada pelo jurídico.

## 8. Materiais físicos
- [ ] 🟢 Provas impressas dos arquivos de `public/assets/branding/print/` aprovadas com a gráfica (nenhum material foi produzido).

---
Quando todos os itens 🔴 estiverem marcados com evidência, atualize `docs/REQUISITOS.md` para "ATIVO EM PRODUÇÃO" nos requisitos correspondentes.
