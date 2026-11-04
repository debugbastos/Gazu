import { api } from './api';
import { readJson, writeJson } from './storage';

// "Vistos recentemente": conveniência de navegação. Para visitantes fica no navegador;
// para clientes com conta é sincronizado no servidor (lista única em todos os dispositivos).

const KEY = 'gazu.viewed.v1';
const MAX = 12;

export function localViewed(): number[] {
  return readJson<number[]>(KEY, []).filter((n) => Number.isSafeInteger(n)).slice(0, MAX);
}

export function rememberViewed(productId: number, logged: boolean): void {
  const next = [productId, ...localViewed().filter((id) => id !== productId)].slice(0, MAX);
  writeJson(KEY, next);
  if (logged) void api.post('/api/account/viewed', { productIds: [productId] }).catch(() => undefined);
}

/** Ao entrar na conta: envia o histórico do navegador e recebe a lista unificada. */
export async function syncViewed(): Promise<number[]> {
  try {
    const local = localViewed();
    const r = local.length ? await api.post<{ ids: number[] }>('/api/account/viewed', { productIds: local }) : await api.get<{ ids: number[] }>('/api/account/viewed');
    writeJson(KEY, r.ids.slice(0, MAX));
    return r.ids;
  } catch {
    return localViewed();
  }
}
