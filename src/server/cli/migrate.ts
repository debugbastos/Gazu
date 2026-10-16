import { getDb } from '../db.ts';

const db = getDb();
const applied = db.migrate();
console.log(applied.length ? `Migrations aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.');
db.close();
