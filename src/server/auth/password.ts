import crypto from 'node:crypto';

// scrypt com parâmetros configuráveis; formato: scrypt$N$r$p$salt(b64)$hash(b64)
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

const scrypt = (pw: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    crypto.scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Executa trabalho equivalente para não revelar (por tempo) se o e-mail existe.
    await scrypt(password, crypto.randomBytes(16), N, R, P);
    return false;
  }
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** Regras mínimas de senha (validadas também no cliente). */
export function passwordProblems(pw: string): string | null {
  if (pw.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (pw.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letras e números na senha.';
  return null;
}
