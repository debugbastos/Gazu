// Mesma interface de src/client/lib/api.ts, mas as "requisições" são atendidas pelo backend local (backend.ts).
import { handle, HttpErr } from './backend';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: { fieldErrors?: Record<string, string[] | undefined> } & Record<string, unknown>) { super(message); }
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.details?.fieldErrors ?? {})) if (v?.[0]) out[k] = v[0];
    return out;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  // Pequena latência para os estados de carregamento se comportarem como no site real.
  await new Promise((r) => setTimeout(r, 40));
  try {
    return (await handle(method, url, body)) as T;
  } catch (e) {
    if (e instanceof HttpErr) throw new ApiError(e.status, e.code, e.message, e.details as ApiError['details']);
    console.error(e);
    throw new ApiError(500, 'internal_error', 'Erro inesperado na versão de demonstração.');
  }
}

/** Reduz a imagem enviada no painel (máx. 900 px, WebP) para caber no armazenamento do navegador. */
async function fileToDataUrl(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/webp', 0.82), width: w, height: h };
}

export const api = {
  get: <T>(url: string, _init?: RequestInit) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
  async upload<T>(url: string, file: File): Promise<T> {
    let payload;
    try { payload = await fileToDataUrl(file); } catch { throw new ApiError(415, 'bad_image', 'Arquivo de imagem inválido.'); }
    return request<T>('POST', url, payload);
  },
};

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.');
