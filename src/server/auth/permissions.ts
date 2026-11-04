// Funções (papéis) da equipe e permissões verificadas no servidor em cada rota administrativa.
// O papel "owner" é atribuído pelo comando `npm run admin:create`; os demais, somente por um owner (painel → Equipe).

export const STAFF_ROLES = ['owner', 'manager', 'catalog', 'finance', 'support', 'marketing'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  'catalog.read', 'catalog.write', 'content.write',
  'orders.read', 'orders.write', 'payments.refund',
  'customers.read', 'customers.privacy',
  'support.read', 'support.write',
  'finance.read', 'finance.write',
  'marketing.read', 'marketing.write',
  'analytics.read', 'settings.write', 'team.manage',
  'ops.read', 'ops.write', 'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_LABEL: Record<StaffRole, string> = {
  owner: 'Proprietário(a)',
  manager: 'Gerente',
  catalog: 'Catálogo e conteúdo',
  finance: 'Financeiro',
  support: 'Atendimento',
  marketing: 'Marketing',
};

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: ALL,
  manager: ALL.filter((p) => p !== 'team.manage'),
  catalog: ['catalog.read', 'catalog.write', 'content.write', 'orders.read', 'analytics.read', 'marketing.read'],
  finance: ['finance.read', 'finance.write', 'orders.read', 'payments.refund', 'analytics.read', 'audit.read', 'catalog.read', 'marketing.read'],
  support: ['support.read', 'support.write', 'orders.read', 'orders.write', 'customers.read', 'catalog.read'],
  marketing: ['marketing.read', 'marketing.write', 'content.write', 'catalog.read', 'analytics.read'],
};

export function permissionsFor(role: StaffRole | null | undefined): Permission[] {
  if (!role) return [];
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export const isStaffRole = (v: unknown): v is StaffRole => typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);
