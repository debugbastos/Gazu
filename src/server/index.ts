import { env } from './config.ts';
import { getDb } from './db.ts';
import { createApp } from './app.ts';
import { expireStaleOrders } from './services/payments/index.ts';
import { purgeExpiredSessions } from './auth/sessions.ts';

const db = getDb();
const applied = db.migrate();
if (applied.length) console.log(`Migrations aplicadas: ${applied.join(', ')}`);

const server = createApp();
server.listen(env.PORT, env.HOST, () => {
  console.log(`GAZU rodando em ${env.APP_URL} (escutando ${env.HOST}:${env.PORT}, ambiente ${env.NODE_ENV})`);
  if (env.DEMO_MODE) console.log('Modo demonstração ATIVO: produtos, preços e estoques de demonstração são sinalizados na interface.');
});

// Rotinas periódicas: expiração de pedidos não pagos e limpeza de sessões.
const timer = setInterval(() => {
  expireStaleOrders().catch((e) => console.error('[expiração de pedidos]', e));
  try { purgeExpiredSessions(); } catch (e) { console.error('[sessões]', e); }
}, 60_000);
timer.unref();

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
