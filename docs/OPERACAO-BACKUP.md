# Operação, monitoramento, backups e recuperação — GAZU

## 1. Rotinas automáticas (`src/server/services/jobs.ts`)

Rodam dentro do processo do servidor quando `JOBS_ENABLED=true`. **Ative em apenas uma instância** (as demais com
`JOBS_ENABLED=false`). Cada execução fica registrada em `job_runs` e aparece em Painel › Operação, onde também é possível
executar uma rotina manualmente.

| Rotina | Frequência | O que faz |
|---|---|---|
| `expirar-pedidos` | 1 min | Para pedidos não pagos no prazo, consulta antes o provedor; se ainda houver cobrança válida (Pix ou boleto dentro do vencimento) aguarda, senão cancela o pedido, marca o pagamento como expirado, devolve o estoque reservado e libera o cupom. (Cancelamentos feitos pelo cliente ou pelo painel também cancelam a cobrança pendente no provedor.) |
| `reconciliar-pagamentos` | 10 min | Consulta no Mercado Pago os pagamentos pendentes/em processamento e reprocessa webhooks com erro. |
| `reenviar-emails` | 15 min | Reenvia e-mails com falha (até 3 tentativas, últimas 24 h). |
| `rastrear-envios` | 60 min | Atualiza o rastreio das etiquetas do Melhor Envio e notifica o cliente. |
| `carrinho-abandonado` | 60 min | Um lembrete por carrinho, só para clientes com conta que autorizaram comunicações de marketing. |
| `consistencia` | 30 min | Procura divergências — críticas: pedido pago sem pagamento aprovado, pagamento aprovado em pedido cancelado, estoque diferente do histórico de movimentações, valor pago diferente do pedido; demais: webhooks com erro, cobranças pendentes vencidas, e-mails com falha, estornos sem confirmação, entregas sem atualização, pedidos pagos há mais de 3 dias sem envio — e envia alerta para as críticas. |
| `backup` | 30 min (cria se o último tiver mais de `BACKUP_INTERVAL_HOURS`) | Backup + verificação (seção 3). |
| `limpeza` | 6 h | Remove sessões expiradas, eventos de analytics com mais de 13 meses e o corpo de e-mails de acesso com mais de 3 dias. |

**Hospedagem sem processo contínuo (serverless):** as rotinas não rodam sozinhas. Use um agendador externo que chame,
com uma conta de operação (permissão `ops.write`), `POST /api/admin/ops/jobs/{nome}/run` — ou mantenha um processo Node
contínuo (recomendado; ver `docs/ESCALABILIDADE.md`).

## 2. Monitoramento

- **Saúde:** `GET /api/health` (público, sem detalhes) e Painel › Operação (banco, `PRAGMA quick_check`, migrations,
  integrações detectadas, último backup, erros abertos). Configure um monitor de disponibilidade externo (ex.: UptimeRobot,
  Better Stack) apontando para `/api/health` — **não incluído/configurado neste pacote**.
- **Erros:** exceções do servidor e falhas de provedores vão para `error_log` (agrupadas por "impressão digital", com contagem
  de ocorrências), sem dados sensíveis. Painel › Operação lista e permite marcar como resolvido.
- **Alertas:** erros críticos e divergências críticas disparam e-mail (`ALERT_EMAIL`, requer Resend) e/ou webhook
  (`ALERT_WEBHOOK_URL`); o mesmo alerta não se repete em menos de 6 h. **Sem essas variáveis, nenhum alerta sai do painel.**
- **Webhooks de pagamento:** cada notificação recebida fica em `payment_events` (assinatura válida?, resultado, tentativas);
  eventos com erro podem ser reprocessados (o status é sempre consultado de novo na API do provedor).
- **Comunicações:** notificações e fila de e-mails visíveis no painel, com reenvio manual.

## 3. Backups

**Como é feito:** `VACUUM INTO` gera uma cópia consistente do SQLite (funciona com o modo WAL, sem parar o site) em
`BACKUP_DIR`, com SHA-256 registrado na tabela `backups`. **Não copie apenas o arquivo `.db` com o servidor rodando** — as
gravações recentes ficam no arquivo `-wal` e seriam perdidas.

**Verificação (teste de restauração) — feita automaticamente após cada backup:**
1. SHA-256 do arquivo confere com o registrado;
2. a cópia é restaurada num arquivo temporário (nunca sobre o banco em uso) e aberta somente leitura;
3. `PRAGMA integrity_check` = ok e `PRAGMA foreign_key_check` sem violações;
4. tabelas essenciais presentes e migrations registradas;
5. contagens de pedidos, produtos e pagamentos coerentes com o banco em uso.
Falha em qualquer item → backup marcado "failed" e erro crítico (alerta, se configurado).

**Retenção:** mantém os `BACKUP_RETENTION` mais recentes (padrão 14); os antigos são apagados do disco e marcados "removed".

**Comandos:**
```bash
npm run backup                     # cria e verifica um backup agora
npm run restore -- backups/<arquivo>.db   # restauração (com o servidor PARADO)
```

**Cópia externa — obrigatória em produção e NÃO automatizada aqui.** Um backup no mesmo disco não protege contra perda do
servidor. Configure no provedor: volume com snapshots diários, ou sincronização da pasta `BACKUP_DIR` para armazenamento de
objetos (S3, Cloudflare R2, Backblaze B2, Google Cloud Storage) com criptografia e retenção ≥ 30 dias, usando credenciais
restritas a gravação. Registre em `docs/CHECKLIST-PRODUCAO.md` quando estiver ativo **e testado**.

## 4. Recuperação

### Restaurar o banco
1. Coloque o site em manutenção ou pare o processo (`systemctl stop gazu`, `pm2 stop gazu`…).
2. `npm run restore -- <arquivo>` — o arquivo é verificado **antes**; se inválido, nada é alterado. O banco atual é
   preservado como `<banco>.antes-da-restauracao-<data>.db`.
3. Inicie o servidor (migrations pendentes são aplicadas automaticamente).
4. **Reconcilie com os provedores:** Painel › Operação › executar `reconciliar-pagamentos` (pagamentos aprovados depois do
   backup voltam a ser aplicados a partir do Mercado Pago) e `consistencia`; confira pedidos do período entre o backup e a
   falha diretamente no painel do Mercado Pago e do Melhor Envio.

### Teste de recuperação executado (18/10/2026, ambiente de desenvolvimento)
`npm run backup` sobre uma cópia do banco de desenvolvimento → verificação OK (integridade, chaves estrangeiras, 8 tabelas
essenciais, 3 migrations, contagens) → `npm run restore` para um banco novo → mesmas contagens (98 produtos, 496 variantes,
4 coleções, 2 lookbooks), nenhuma migration pendente e `quick_check = ok`. Repita o teste **no ambiente de produção** após a
implantação (ver checklist) — este teste não substitui o de produção.

### Outros incidentes
| Situação | Ação |
|---|---|
| Mercado Pago fora do ar | Pedidos ficam "aguardando pagamento"; a reconciliação aplica os resultados quando o provedor voltar. Não marque pagamentos manualmente. |
| Webhook com assinatura inválida em massa | Confira `MP_WEBHOOK_SECRET` (foi regenerado no painel do MP?). Eventos rejeitados podem ser reprocessados após corrigir. |
| Melhor Envio indisponível | Cotação cai para as regras manuais apenas se configuradas; etiquetas podem ser compradas depois. |
| E-mails falhando | Verifique domínio/chave na Resend; reenvie pela Operação. |
| Disco cheio | Reduza `BACKUP_RETENTION`, mova backups antigos para o armazenamento externo, verifique uploads. |
| Vazamento de credencial | Revogue/gere nova chave no provedor, atualize o `.env`, reinicie, revise a auditoria. |

## 5. Auditoria e LGPD na operação
- Auditoria (Painel › Auditoria): ações críticas com autor, IP, data e resultado, inclusive tentativas negadas.
- Solicitações de titulares (Painel › Privacidade): prazo recomendado de 15 dias; exportação automática pela conta do cliente.
- Logs nunca contêm senhas, tokens, CPF completo ou dados de cartão.
