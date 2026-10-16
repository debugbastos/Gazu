#!/usr/bin/env node
// Gera as versões web (WebP) das imagens a partir de assets-source/, sem alterar os originais.
// Produz também db/seed/images.json (manifesto com dimensões) e docs/INVENTARIO-IMAGENS.md.
// Uso: node scripts/process-images.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = (...p) => path.join(root, 'assets-source', ...p);
const pub = (...p) => path.join(root, 'public', ...p);
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'db/seed/catalog.json'), 'utf8'));
const files = fs.readdirSync(src('roupas'));
const dupFiles = new Set(catalog.duplicates.map((d) => d.file));

const groupOf = (p) => {
  if (p.cats.some((c) => c.startsWith('tenis'))) return 'sneakers';
  if (p.cats.some((c) => c.startsWith('acessorios'))) return 'accessories';
  return 'clothing';
};

const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
const ensure = (d) => fs.mkdirSync(d, { recursive: true });

async function webpVariants(input, outDir, base, widths, opts = {}) {
  ensure(outDir);
  const meta = await sharp(input).metadata();
  const out = [];
  for (const w of widths) {
    const width = Math.min(w, meta.width);
    if (out.some((o) => o.width === width)) continue;
    const file = path.join(outDir, `${base}-${width}.webp`);
    const info = await sharp(input)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: opts.quality ?? 82, alphaQuality: 95, effort: 5 })
      .toFile(file);
    out.push({ width: info.width, height: info.height, url: '/' + path.relative(pub(), file).split(path.sep).join('/') });
  }
  return { original: { width: meta.width, height: meta.height, format: meta.format }, variants: out };
}

const manifest = { products: {}, hero: {}, references: {}, editorial: {}, generatedAt: new Date().toISOString() };
const inventory = [];

// 1) Produtos
for (const p of catalog.products) {
  const file = files.find((f) => f.startsWith(p.f.slice(0, 10)) && !dupFiles.has(f));
  if (!file) throw new Error(`Arquivo não encontrado para ${p.slug}`);
  const input = src('roupas', file);
  const group = groupOf(p);
  const res = await webpVariants(input, pub('assets/products', group, p.slug), p.slug, [480, 960]);
  manifest.products[p.slug] = { file, group, ...res };
  inventory.push({ file, path: `assets-source/roupas/${file}`, size: fs.statSync(input).size, ...res.original, status: 'produto', product: p.slug, category: p.cats.join(', '), color: p.colors.map((c) => c[0]).join(' / '), note: p.note || '' });
}
for (const d of catalog.duplicates) {
  const input = src('roupas', d.file);
  const meta = await sharp(input).metadata();
  const same = md5(input) === md5(src('roupas', d.of));
  inventory.push({ file: d.file, path: `assets-source/roupas/${d.file}`, size: fs.statSync(input).size, width: meta.width, height: meta.height, format: meta.format, status: same ? 'duplicata exata (ignorada)' : 'possível duplicata — revisar', product: '', category: '', color: '', note: `Duplicata de ${d.of}` });
}
for (const e of catalog.excluded) {
  const input = src('roupas', e.file);
  const meta = await sharp(input).metadata();
  inventory.push({ file: e.file, path: `assets-source/roupas/${e.file}`, size: fs.statSync(input).size, width: meta.width, height: meta.height, format: meta.format, status: 'fora do catálogo — revisar', product: '', category: '', color: '', note: e.reason });
}
for (const e of catalog.editorial) {
  const input = src('roupas', e.file);
  const res = await webpVariants(input, pub('assets/editorial'), 'acessorios-composicao', [480, 960]);
  manifest.editorial['acessorios'] = { file: e.file, ...res };
  inventory.push({ file: e.file, path: `assets-source/roupas/${e.file}`, size: fs.statSync(input).size, ...res.original, status: 'editorial', product: '', category: 'acessorios (imagem de categoria)', color: '', note: e.use });
}

// 2) Modelos do hero (recortes com transparência, gerados por scripts/assets/*.py)
const heroMap = { male: ['male', 'male-original.jpg'], female: ['female', 'female-original.jpg'], boys: ['boy', 'boy-original.jpg'], girls: ['girl', 'girl-original.png'] };
for (const [dir, [key, original]] of Object.entries(heroMap)) {
  const cut = src('hero/cutouts', `${key}@2x.png`);
  const out = pub('assets/hero', dir);
  ensure(out);
  const meta = await sharp(cut).metadata();
  const variants = [];
  for (const h of [700, meta.height]) {
    const height = Math.min(h, meta.height);
    if (variants.some((v) => v.height === height)) continue;
    const file = path.join(out, `${key}-${height}.webp`);
    const info = await sharp(cut).resize({ height }).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(file);
    variants.push({ width: info.width, height: info.height, url: '/' + path.relative(pub(), file).split(path.sep).join('/') });
  }
  fs.copyFileSync(src('hero', original), path.join(out, original));
  const om = await sharp(src('hero', original)).metadata();
  manifest.hero[dir] = { original: { file: original, width: om.width, height: om.height }, variants };
  inventory.push({ file: original, path: `assets-source/hero/${original}`, size: fs.statSync(src('hero', original)).size, width: om.width, height: om.height, format: om.format, status: `modelo do hero (${dir})`, product: '', category: 'hero', color: '', note: 'Recorte com segmentação (isnet/u2net) + revisão visual. Resolução de origem baixa.' });
}

// 3) Referências
for (const [k, f] of [['homepage', 'homepage-template.jpg'], ['product', 'product-template.jpg']]) {
  fs.copyFileSync(src('references', f), pub('assets/references', f));
  const m = await sharp(src('references', f)).metadata();
  manifest.references[k] = { url: `/assets/references/${f}`, width: m.width, height: m.height };
}
fs.copyFileSync(src('branding/gazu-logo-original.png'), pub('assets/branding/logo/gazu-logo-original.png'));

// 4) Favicons e ícones PNG a partir do SVG vetorial
const mark = fs.readFileSync(pub('assets/branding/logo/gazu-mark.svg'));
await sharp(mark, { density: 600 }).resize(180, 180).png().toFile(pub('apple-touch-icon.png'));
await sharp(mark, { density: 600 }).resize(512, 512).png().toFile(pub('assets/branding/logo/gazu-icon-512.png'));
await sharp(mark, { density: 300 }).resize(32, 32).png().toFile(pub('favicon-32.png'));
const logoSvg = fs.readFileSync(pub('assets/branding/logo/gazu-logo.svg'), 'utf8').replace('fill="currentColor"', 'fill="#111111"');
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#F7F6F3"/></svg>`))
  .composite([{ input: await sharp(Buffer.from(logoSvg), { density: 300 }).resize({ width: 560 }).png().toBuffer(), gravity: 'center' }])
  .png().toFile(pub('assets/branding/og-image.png'));

fs.writeFileSync(path.join(root, 'db/seed/images.json'), JSON.stringify(manifest, null, 2));

// 5) Inventário em Markdown
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const rows = inventory
  .sort((a, b) => a.status.localeCompare(b.status) || a.file.localeCompare(b.file))
  .map((r) => `| ${r.file} | ${r.format?.toUpperCase?.() ?? ''} | ${r.width}×${r.height} | ${kb(r.size)} | ${r.status} | ${r.category} | ${r.color} | ${r.product} | ${r.note} |`);
const md = `# Inventário de imagens — GAZU

Gerado automaticamente por \`scripts/process-images.mjs\` em ${new Date().toISOString().slice(0, 10)}.
Originais preservados em \`assets-source/\` (nunca sobrescritos). Versões web em \`public/assets/\`.

- Fotos recebidas em \`roupas.rar\`: ${files.length}
- Produtos cadastrados (demonstração): ${catalog.products.length}
- Duplicatas exatas: ${catalog.duplicates.length}
- Fora do catálogo: ${catalog.excluded.length}
- Editoriais: ${catalog.editorial.length}

Observações gerais:
- Todas as fotos de produto são JPG sem transparência (fundo fotográfico); são exibidas inteiras, sem distorção.
- As cores listadas foram descritas pela aparência da foto e **precisam ser confirmadas** pelo cliente.
- Diversas fotos exibem marcas de terceiros (logotipos esportivos, automobilísticos, de luxo e de times). Os nomes dos produtos foram mantidos descritivos e sem marcas. **Confirmar direitos de uso das imagens e autenticidade/licenciamento dos produtos antes da publicação.**
- Os modelos do hero têm resolução baixa (300–624 px de largura). Recomenda-se fornecer fotos em alta resolução.

| Arquivo | Tipo | Dimensões | Tamanho | Status | Categoria | Cor (a confirmar) | Produto (slug) | Observação |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
fs.writeFileSync(path.join(root, 'docs/INVENTARIO-IMAGENS.md'), md);
console.log(`OK: ${Object.keys(manifest.products).length} produtos, ${Object.keys(manifest.hero).length} modelos, inventário com ${inventory.length} linhas.`);
