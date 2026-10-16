import { getDb } from '../db.ts';
import { seedDatabase } from './seed-data.ts';

const db = getDb();
db.migrate();
const reset = process.argv.includes('--reset');
const r = seedDatabase(db, { reset });
console.log(r.skipped ? `Catálogo já existente (${r.products} produtos). Use --reset para recriar.` : `Seed concluído: ${r.categories} categorias e ${r.products} produtos de DEMONSTRAÇÃO.`);
db.close();
