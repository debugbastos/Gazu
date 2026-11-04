import { env } from './config.ts';
import { getDb } from './db.ts';
import { createApp } from './app.ts';
import { startJobs, stopJobs } from './services/jobs.ts';

const db = getDb();
const applied = db.migrate();
if (applied.length) console.log(`Migrations aplicadas: ${applied.join(', ')}`);

const server = createApp();
server.listen(env.PORT, env.HOST, () => {
  console.log(`GAZU rodando em ${env.APP_URL} (escutando ${env.HOST}:${env.PORT}, ambiente ${env.NODE_ENV})`);
  if (env.DEMO_MODE) console.log('Modo demonstração ATIVO: produtos, preços e estoques de demonstração são sinalizados na interface.');
});

// Rotinas periódicas (expiração de pedidos, reconciliação, e-mails, rastreio, carrinho abandonado,
// consistência, backups e limpeza). Registradas em job_runs; desligue com JOBS_ENABLED=false nas réplicas.
startJobs();
if (!env.JOBS_ENABLED) console.log('Rotinas periódicas DESLIGADAS nesta instância (JOBS_ENABLED=false).');

const shutdown = () => {
  stopJobs();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
