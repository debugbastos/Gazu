import { getDb } from '../db.ts';
import { runBackup, verifyBackup } from '../services/backup.ts';

// Backup manual: npm run backup
// Cria uma cópia consistente do banco em BACKUP_DIR e executa o teste de restauração (cópia isolada).
const db = getDb();
db.migrate();
const b = runBackup('manual');
const v = verifyBackup(b.id);
console.log(`Backup criado: ${b.file} (${(b.sizeBytes / 1024).toFixed(1)} KB, SHA-256 ${b.sha256.slice(0, 16)}…)`);
for (const c of v.checks) console.log(`  ${c.ok ? 'OK ' : 'ERRO'}  ${c.name}: ${c.detail}`);
console.log(v.ok ? 'Verificação concluída: backup íntegro e restaurável.' : 'ATENÇÃO: o backup NÃO passou na verificação.');
db.close();
process.exit(v.ok ? 0 : 1);
