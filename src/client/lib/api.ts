import type { ApiErrorBody } from '../../shared/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { fieldErrors?: Record<string, string[] | undefined> } & Record<string, unknown>,
  ) {
    super(message);
  }
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.details?.fieldErrors ?? {})) if (v?.[0]) out[k] = v[0];
    return out;
  }
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, 'network', 'Não foi possível conectar. Verifique sua internet e tente novamente.');
  }
  const text = await resp.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
  if (!resp.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(resp.status, err?.code ?? 'http_error', err?.message ?? `Erro ${resp.status}. Tente novamente.`, err?.details as ApiError['details']);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, init?: RequestInit) => request<T>('GET', url, undefined, init),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
  async upload<T>(url: string, file: File): Promise<T> {
    let resp: Response;
    try {
      resp = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    } catch {
      throw new ApiError(0, 'network', 'Falha de conexão ao enviar a imagem.');
    }
    const data = (await resp.json().catch(() => null)) as (ApiErrorBody & T) | null;
    if (!resp.ok) throw new ApiError(resp.status, data?.error?.code ?? 'http_error', data?.error?.message ?? 'Falha no envio.');
    return data as T;
  },
};

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.');
