import { getDb } from '../db.ts';

/**
 * Registro de auditoria de ações críticas (preços, estoque, permissões, cancelamentos, estornos, financeiro…).
 * Guarda quem executou, o quê, quando, de onde e o resultado — nunca senhas, tokens ou dados de cartão.
 */
export interface AuditInput {
  actor: string;                 // admin:<id> | customer:<id> | system | provider:<nome>
  action: string;                // ex.: product.update, refund.request, team.role
  entity: string;
  entityId?: string | number | null;
  data?: unknown;
  result?: 'success' | 'denied' | 'failed';
  ip?: string | null;
}

const SENSITIVE = /(password|senha|token|secret|card|cvv|cvc|cpf|authorization)/i;

/** Remove campos sensíveis antes de gravar (defesa em profundidade). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? '[omitido]' : redact(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export function audit(a: AuditInput): void {
  getDb().run(
    'INSERT INTO audit_log (actor, action, entity, entity_id, data, result, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    a.actor, a.action, a.entity, a.entityId === undefined || a.entityId === null ? null : String(a.entityId),
    a.data === undefined ? null : JSON.stringify(redact(a.data)), a.result ?? 'success', a.ip ?? null,
  );
}
