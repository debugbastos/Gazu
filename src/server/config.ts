import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Carrega um arquivo .env simples (KEY=valor) sem sobrescrever variáveis já definidas. */
function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export const ROOT = path.resolve(process.env.GAZU_ROOT ?? process.cwd());
if (process.env.NODE_ENV !== 'test') loadDotEnv(path.join(ROOT, '.env'));

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_PATH: z.string().default('data/gazu.db'),
  SESSION_SECRET: z.string().min(16).optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  DEMO_MODE: bool, // exibe avisos de demonstração e libera provedores simulados
  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Pagamentos
  PAYMENT_PROVIDER: z.enum(['mercadopago', 'demo', 'none']).default('none'),
  MP_ACCESS_TOKEN: z.string().optional(),
  MP_PUBLIC_KEY: z.string().optional(),
  MP_WEBHOOK_SECRET: z.string().optional(),
  MP_ENABLED_METHODS: z.string().default('pix,credit_card'),
  MP_MAX_INSTALLMENTS: z.coerce.number().int().min(1).max(12).default(1),
  PIX_EXPIRATION_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  // Frete
  SHIPPING_PROVIDER: z.enum(['manual', 'demo']).default('manual'),
  // E-mail
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('GAZU <nao-responda@exemplo.com>'),
  // Pedidos
  ORDER_PAYMENT_WINDOW_MINUTES: z.coerce.number().int().min(10).max(2880).default(60),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuração inválida:', parsed.error.flatten().fieldErrors);
  throw new Error('Variáveis de ambiente inválidas. Veja .env.example.');
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProd) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET é obrigatório em produção.');
  if (env.PAYMENT_PROVIDER === 'demo') throw new Error('PAYMENT_PROVIDER=demo não é permitido em produção.');
  if (env.SHIPPING_PROVIDER === 'demo') throw new Error('SHIPPING_PROVIDER=demo não é permitido em produção.');
}

/** Segredo usado para assinar cookies temporários (state do OAuth etc.). */
export const sessionSecret = env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me';

export const features = {
  googleAuth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  mercadoPago: env.PAYMENT_PROVIDER === 'mercadopago' && Boolean(env.MP_ACCESS_TOKEN),
  mercadoPagoCard: env.PAYMENT_PROVIDER === 'mercadopago' && Boolean(env.MP_ACCESS_TOKEN && env.MP_PUBLIC_KEY) && env.MP_ENABLED_METHODS.split(',').includes('credit_card'),
  mercadoPagoPix: env.PAYMENT_PROVIDER === 'mercadopago' && Boolean(env.MP_ACCESS_TOKEN) && env.MP_ENABLED_METHODS.split(',').includes('pix'),
  demoPayments: env.PAYMENT_PROVIDER === 'demo' && !isProd,
  demoShipping: env.SHIPPING_PROVIDER === 'demo' && !isProd,
  webhookSignature: Boolean(env.MP_WEBHOOK_SECRET),
};
