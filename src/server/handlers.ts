import { clearHandlers } from './events.ts';
import { registerNotificationHandlers } from './services/notifications.ts';
import { registerReturnHandlers } from './services/returns.ts';
import { registerEngagementHandlers } from './services/engagement.ts';

// Assinantes dos eventos de domínio (executados após o COMMIT). Registro idempotente.
let done = false;
export function registerDomainHandlers(): void {
  if (done) return;
  done = true;
  registerNotificationHandlers();
  registerReturnHandlers();
  registerEngagementHandlers();
}

/** Para testes: remove e registra novamente todos os assinantes. */
export function resetDomainHandlers(): void {
  clearHandlers();
  done = false;
  registerDomainHandlers();
}
