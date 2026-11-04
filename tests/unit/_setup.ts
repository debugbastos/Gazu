// Ambiente isolado para os testes: banco em memória, Mercado Pago com fetch simulado, frete de demonstração.
// Deve ser o PRIMEIRO import de cada arquivo de teste (antes de qualquer módulo do servidor).
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.APP_URL = 'http://gazu.test';
process.env.SESSION_SECRET = 'test-session-secret-0123456789';
process.env.DEMO_MODE = 'true';
process.env.PAYMENT_PROVIDER = 'mercadopago';
process.env.MP_ACCESS_TOKEN = 'TEST-access-token';
process.env.MP_PUBLIC_KEY = 'TEST-public-key';
process.env.MP_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.MP_ENABLED_METHODS = 'pix,credit_card,boleto';
process.env.MP_MAX_INSTALLMENTS = '6';
process.env.MELHORENVIO_TOKEN = 'TEST-melhorenvio-token';
process.env.SHIPPING_ORIGIN_CEP = '01001000';
process.env.WHATSAPP_TOKEN = 'TEST-wa-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.BACKUP_DIR = `${process.env.TMPDIR ?? '/tmp'}/gazu-test-backups-${process.pid}`;
process.env.JOBS_ENABLED = 'false';
process.env.SHIPPING_PROVIDER = 'demo';
process.env.EMAIL_PROVIDER = 'console';
process.env.GAZU_ROOT = new URL('../..', import.meta.url).pathname;
// Silencia o "e-mail" de console durante os testes.
const origLog = console.log;
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[e-mail')) return; origLog(...a); };
export {};
