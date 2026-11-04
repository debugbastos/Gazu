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
  BOLETO_DAYS: z.coerce.number().int().min(1).max(30).default(3),
  // Frete
  SHIPPING_PROVIDER: z.enum(['manual', 'demo', 'melhorenvio']).default('manual'),
  SHIPPING_ORIGIN_CEP: z.string().regex(/^\d{5}-?\d{3}$/).optional(),
  MELHORENVIO_TOKEN: z.string().optional(),
  MELHORENVIO_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MELHORENVIO_USER_AGENT: z.string().default('GAZU Store (contato@exemplo.com)'),
  MELHORENVIO_SERVICES: z.string().default(''),
  /** Embalagem padrão usada na cotação quando o produto não tem dimensões cadastradas (cm / gramas). */
  PACKAGE_DEFAULT: z.string().default('30x20x10x500'),
  // WhatsApp Business (API oficial da Meta — Cloud API)
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  // Monitoramento, alertas e backups
  ALERT_EMAIL: z.string().email().optional().or(z.literal('')),
  ALERT_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
  BACKUP_DIR: z.string().default('backups'),
  BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(0).max(168).default(24),
  BACKUP_RETENTION: z.coerce.number().int().min(1).max(365).default(14),
  JOBS_ENABLED: bool.default('true'),
  // E-mail
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('GAZU <nao-responda@exemplo.com>'),
  // Pedidos
  ORDER_PAYMENT_WINDOW_MINUTES: z.coerce.number().int().min(10).max(2880).default(60),
});

// Nomes alternativos aceitos (convenção do PRD): MERCADOPAGO_* → MP_*.
for (const [alias, key] of [['MERCADOPAGO_ACCESS_TOKEN', 'MP_ACCESS_TOKEN'], ['MERCADOPAGO_PUBLIC_KEY', 'MP_PUBLIC_KEY'], ['MERCADOPAGO_WEBHOOK_SECRET', 'MP_WEBHOOK_SECRET']] as const) {
  if (!process.env[key] && process.env[alias]) process.env[key] = process.env[alias];
}

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

const [pkgL, pkgW, pkgH, pkgG] = env.PACKAGE_DEFAULT.split('x').map(Number);
export const defaultPackage = { lengthCm: pkgL || 30, widthCm: pkgW || 20, heightCm: pkgH || 10, weightGrams: pkgG || 500 };

export const features = {
  googleAuth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  mercadoPago: env.PAYMENT_PROVIDER === 'mercadopago' && Boolean(env.MP_ACCESS_TOKEN),
  mercadoPagoCard: env.PAYMENT_PROVIDER === 'mercadopago' && Boolean(env.MP_ACCESS_TOKEN && env.MP_PUBLIC_KEY) && env.MP_ENABLED_METHODS.split(',').includes('credit_card'),
  mercadoPagoPix: env.PAYMENT_PROVIDER === 'mercadopago' && Boolean(env.MP_ACCESS_TOKEN) && env.MP_ENABLED_METHODS.split(',').includes('pix'),
  demoPayments: env.PAYMENT_PROVIDER === 'demo' && !isProd,
  demoShipping: env.SHIPPING_PROVIDER === 'demo' && !isProd,
  melhorEnvio: env.SHIPPING_PROVIDER === 'melhorenvio' && Boolean(env.MELHORENVIO_TOKEN && env.SHIPPING_ORIGIN_CEP),
  mercadoPagoBoleto: env.PAYMENT_PROVIDER === 'mercadopago' && Boolean(env.MP_ACCESS_TOKEN) && env.MP_ENABLED_METHODS.split(',').includes('boleto'),
  whatsappApi: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
  whatsappWebhook: Boolean(env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_APP_SECRET),
  email: env.EMAIL_PROVIDER === 'resend' && Boolean(env.RESEND_API_KEY),
  webhookSignature: Boolean(env.MP_WEBHOOK_SECRET),
};
