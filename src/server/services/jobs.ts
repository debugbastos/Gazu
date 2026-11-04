import { env, isTest } from '../config.ts';
import { getDb } from '../db.ts';
import { purgeExpiredSessions } from '../auth/sessions.ts';
import { expireStaleOrders, reconcilePayments } from './payments/index.ts';
import { retryFailedEmails } from './email.ts';
import { syncMelhorEnvioTracking } from './shipments.ts';
import { remindAbandonedCarts } from './engagement.ts';
import { purgeOldAnalytics } from './analytics.ts';
import { scheduledBackup } from './backup.ts';
import { alertOnce, consistencyChecks, runJob } from './monitoring.ts';

// Rotinas periódicas. Cada execução é registrada em job_runs (visível em Admin › Operação).
// Em múltiplas instâncias, apenas UMA deve ter JOBS_ENABLED=true (ver docs/ESCALABILIDADE.md).

export const JOBS: { name: string; everyMs: number; run: () => Promise<unknown> | unknown; description: string }[] = [
  { name: 'expirar-pedidos', everyMs: 60_000, run: () => expireStaleOrders(), description: 'Cancela pedidos não pagos após o prazo e devolve o estoque.' },
  { name: 'reconciliar-pagamentos', everyMs: 10 * 60_000, run: () => reconcilePayments(), description: 'Sincroniza pagamentos pendentes com o provedor e reprocessa webhooks com erro.' },
  { name: 'reenviar-emails', everyMs: 15 * 60_000, run: () => retryFailedEmails(), description: 'Reenvia e-mails transacionais que falharam (até 3 tentativas).' },
  { name: 'rastrear-envios', everyMs: 60 * 60_000, run: () => syncMelhorEnvioTracking(), description: 'Atualiza o rastreio das etiquetas do Melhor Envio.' },
  { name: 'carrinho-abandonado', everyMs: 60 * 60_000, run: () => remindAbandonedCarts(), description: 'Envia um lembrete por carrinho (somente clientes com consentimento).' },
  {
    name: 'consistencia', everyMs: 30 * 60_000, description: 'Verifica divergências de pagamento, estoque, webhooks, e-mails e entregas; alerta problemas críticos.',
    run: async () => {
      const issues = consistencyChecks();
      for (const i of issues.filter((x) => x.level === 'critical')) await alertOnce(`consistency:${i.key}`, `[GAZU] ${i.title}`, `${i.detail}\nReferências: ${i.refs.join(', ')}`);
      return { issues: issues.length, critical: issues.filter((x) => x.level === 'critical').length };
    },
  },
  { name: 'backup', everyMs: 30 * 60_000, run: () => scheduledBackup(), description: 'Cria e verifica um backup a cada BACKUP_INTERVAL_HOURS.' },
  { name: 'limpeza', everyMs: 6 * 3600_000, run: () => ({ sessions: purgeExpiredSessions(), analytics: purgeOldAnalytics(), accountEmails: redactOldAccountEmails() }), description: 'Remove sessões expiradas, eventos de analytics com mais de 13 meses e o corpo de e-mails de acesso (links com token) com mais de 3 dias.' },
];

/** E-mails de conta (verificação, ativação, senha) carregam links com token: após 3 dias o corpo é apagado da fila (assunto e status ficam). */
export function redactOldAccountEmails(): number {
  const before = new Date(Date.now() - 3 * 86400_000).toISOString();
  return getDb().run("UPDATE email_outbox SET body_text = '[conteúdo removido: link de acesso expirado]', body_html = NULL WHERE event LIKE 'account_%' AND status IN ('sent','logged') AND created_at < ? AND body_html IS NOT NULL", before).changes;
}

const timers: NodeJS.Timeout[] = [];
const running = new Set<string>();

export function startJobs(): void {
  if (!env.JOBS_ENABLED || isTest) return;
  for (const j of JOBS) {
    const tick = async () => {
      if (running.has(j.name)) return; // evita execuções sobrepostas
      running.add(j.name);
      try { await runJob(j.name, j.run); } finally { running.delete(j.name); }
    };
    const t = setInterval(() => void tick(), j.everyMs);
    t.unref();
    timers.push(t);
    setTimeout(() => void tick(), 5_000 + Math.random() * 10_000).unref();
  }
}

export function stopJobs(): void {
  while (timers.length) clearInterval(timers.pop()!);
}

export async function runJobNow(name: string): Promise<unknown> {
  const j = JOBS.find((x) => x.name === name);
  if (!j) return null;
  return runJob(j.name, j.run);
}
