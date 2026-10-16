import crypto from 'node:crypto';
import { env, features } from '../config.ts';
import { HttpError } from '../http.ts';

// Fluxo Authorization Code + PKCE com o Google (OpenID Connect).
// Só fica ativo quando GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET estão configurados.

export const GOOGLE_REDIRECT_PATH = '/api/auth/google/callback';

export function googleAuthUrl(state: string, codeVerifier: string): string {
  if (!features.googleAuth) throw new HttpError(503, 'Login com Google não configurado.', 'google_not_configured');
  const challenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: new URL(GOOGLE_REDIRECT_PATH, env.APP_URL).toString(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function exchangeGoogleCode(code: string, codeVerifier: string, fetchImpl: typeof fetch = fetch): Promise<GoogleIdentity> {
  const resp = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: new URL(GOOGLE_REDIRECT_PATH, env.APP_URL).toString(),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  if (!resp.ok) throw new HttpError(502, 'Falha ao validar o login com o Google.', 'google_exchange_failed');
  const json = (await resp.json()) as { id_token?: string };
  if (!json.id_token) throw new HttpError(502, 'Resposta inválida do Google.', 'google_exchange_failed');
  // O id_token foi recebido diretamente do endpoint de token do Google via TLS (OIDC Core §3.1.3.7),
  // então validamos as declarações (iss, aud, exp) sem precisar baixar as chaves JWKS.
  const payloadPart = json.id_token.split('.')[1];
  if (!payloadPart) throw new HttpError(502, 'Token inválido do Google.', 'google_exchange_failed');
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>;
  const iss = String(claims.iss ?? '');
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') throw new HttpError(401, 'Emissor do token inválido.', 'google_invalid');
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, 'Token destinado a outro aplicativo.', 'google_invalid');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) throw new HttpError(401, 'Token expirado.', 'google_invalid');
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') throw new HttpError(401, 'Token incompleto.', 'google_invalid');
  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name : '',
  };
}
