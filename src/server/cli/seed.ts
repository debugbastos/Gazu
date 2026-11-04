import { getDb } from '../db.ts';
import { seedDatabase } from './seed-data.ts';
import { seedContent } from './seed-content.ts';

const db = getDb();
db.migrate();
const reset = process.argv.includes('--reset');
const r = seedDatabase(db, { reset });
const c = seedContent(db);
console.log(`Conteúdo: ${c.sizeGuides} guias de medidas (referência), ${c.faq} perguntas frequentes, ${c.pages} páginas, ${c.collections} coleções, ${c.lookbooks} lookbooks e ${c.articles} artigos (demonstração).`);
console.log(r.skipped ? `Catálogo já existente (${r.products} produtos). Use --reset para recriar.` : `Seed concluído: ${r.categories} categorias e ${r.products} produtos de DEMONSTRAÇÃO.`);
db.close();
