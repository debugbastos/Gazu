// Gera o kit de identidade da GAZU a partir dos vetores oficiais do logotipo
// (public/assets/branding/logo/gazu-wordmark.svg e gazu-mark.svg, vetorizados da proposta original).
//
//   node scripts/assets/build-brand-kit.mjs
//
// Saídas:
//   public/assets/branding/logo/*      variações do logotipo e do monograma (SVG + PNG)
//   public/assets/branding/social/*    avatar e capa para redes sociais (PNG)
//   public/assets/branding/print/*     materiais de embalagem/impressão em milímetros (SVG) + kit em PDF
//   public/*.png, public/site.webmanifest  favicons e ícones do aplicativo
//
// Nenhum dado comercial é inventado: campos variáveis (preço, SKU, pedido) ficam em branco para preenchimento.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BR = path.join(ROOT, 'public/assets/branding');
const LOGO = path.join(BR, 'logo');
const PRINT = path.join(BR, 'print');
const SOCIAL = path.join(BR, 'social');
for (const d of [LOGO, PRINT, SOCIAL]) fs.mkdirSync(d, { recursive: true });

const C = { black: '#111111', graphite: '#242424', white: '#FFFFFF', offwhite: '#F7F6F3', stone: '#E8E7E3', stone2: '#DCDBD7', muted: '#6B6B6B', line: '#D6D5D0' };
const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";
const DISPLAY = "'Inter Display', Inter, 'Helvetica Neue', Arial, sans-serif";

const pathsOf = (file) => [...fs.readFileSync(file, 'utf8').matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
const WORD = { d: pathsOf(path.join(LOGO, 'gazu-wordmark.svg'))[0], w: 679.25, h: 124.25 };
const MARK = { d: pathsOf(path.join(LOGO, 'gazu-mark.svg'))[0], w: 146.25, h: 124 };
if (!WORD.d || !MARK.d) throw new Error('Vetores do logotipo não encontrados.');

/** Logotipo posicionado: centro (cx, cy) e largura em unidades do desenho. */
const word = (cx, cy, width, fill) => { const s = width / WORD.w; return `<path fill="${fill}" fill-rule="evenodd" transform="translate(${(cx - width / 2).toFixed(3)} ${(cy - (WORD.h * s) / 2).toFixed(3)}) scale(${s.toFixed(5)})" d="${WORD.d}"/>`; };
const mark = (cx, cy, width, fill) => { const s = width / MARK.w; return `<path fill="${fill}" fill-rule="evenodd" transform="translate(${(cx - width / 2).toFixed(3)} ${(cy - (MARK.h * s) / 2).toFixed(3)}) scale(${s.toFixed(5)})" d="${MARK.d}"/>`; };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, { size, weight = 400, fill = C.black, anchor = 'start', tracking = 0, family = FONT, caps = false } = {}) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${tracking}">${esc(caps ? s.toUpperCase() : s)}</text>`;
const svgMm = (w, h, body, title) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
${body}
</svg>
`;
const write = (file, content) => { fs.writeFileSync(file, content); return file; };
const written = [];

// -------------------------------------------------------------------------------------------
// 1. Logotipo e monograma
// -------------------------------------------------------------------------------------------
const pad = 0.18; // área de proteção: 18% da altura do logotipo em cada lado (≈ meia altura da letra "A")
const logoSvg = (fill, bg) => {
  const p = WORD.h * pad * 2;
  const w = WORD.w + p * 2; const h = WORD.h + p * 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" role="img" aria-label="GAZU">${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''}${word(w / 2, h / 2, WORD.w, fill)}</svg>
`;
};
written.push(write(path.join(LOGO, 'gazu-logo-preto.svg'), logoSvg(C.black)));
written.push(write(path.join(LOGO, 'gazu-logo-branco.svg'), logoSvg(C.white)));
written.push(write(path.join(LOGO, 'gazu-logo-preto-sobre-offwhite.svg'), logoSvg(C.black, C.offwhite)));
written.push(write(path.join(LOGO, 'gazu-logo-branco-sobre-preto.svg'), logoSvg(C.white, C.black)));
const markSvg = (fill, bg, size = 240, scale = 0.56) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="GAZU">${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}${mark(size / 2, size / 2, size * scale, fill)}</svg>
`;
written.push(write(path.join(LOGO, 'gazu-monograma-preto.svg'), markSvg(C.black)));
written.push(write(path.join(LOGO, 'gazu-monograma-branco.svg'), markSvg(C.white)));
const pngs = [
  ['gazu-logo-preto.svg', 'gazu-logo-preto-2000.png', 2000],
  ['gazu-logo-branco.svg', 'gazu-logo-branco-2000.png', 2000],
  ['gazu-logo-preto-sobre-offwhite.svg', 'gazu-logo-preto-sobre-offwhite-2000.png', 2000],
  ['gazu-logo-branco-sobre-preto.svg', 'gazu-logo-branco-sobre-preto-2000.png', 2000],
];
// Logotipo para e-mail (sem área de proteção; exibido com 132 px de largura, arquivo 2× para telas densas).
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WORD.w} ${WORD.h}"><rect width="100%" height="100%" fill="${C.white}"/>${word(WORD.w / 2, WORD.h / 2, WORD.w, C.black)}</svg>`), { density: 300 }).resize({ width: 264 }).png().toFile(path.join(LOGO, 'gazu-logo-email.png'));
written.push(path.join(LOGO, 'gazu-logo-email.png'));
for (const [src, out, w] of pngs) { await sharp(Buffer.from(fs.readFileSync(path.join(LOGO, src))), { density: 600 }).resize({ width: w }).png().toFile(path.join(LOGO, out)); written.push(path.join(LOGO, out)); }

// -------------------------------------------------------------------------------------------
// 2. Favicons e ícones do aplicativo
// -------------------------------------------------------------------------------------------
const iconSvg = (size, scale, bg = C.black, fg = C.offwhite, radius = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>${mark(size / 2, size / 2, size * scale, fg)}</svg>`;
// Favicon vetorial: claro por padrão e escuro quando o navegador está em modo escuro.
const fav = 64;
written.push(write(path.join(ROOT, 'public/favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fav} ${fav}"><style>rect{fill:${C.black}}path{fill:${C.offwhite}}@media (prefers-color-scheme:dark){rect{fill:${C.offwhite}}path{fill:${C.black}}}</style><rect width="${fav}" height="${fav}" rx="12"/>${mark(fav / 2, fav / 2, fav * 0.62, C.offwhite).replace(/ fill="[^"]+"/, '')}</svg>\n`));
const icons = [
  ['favicon-16.png', 16, 0.7, 2], ['favicon-32.png', 32, 0.66, 5], ['favicon-48.png', 48, 0.64, 8],
  ['apple-touch-icon.png', 180, 0.56, 0], ['icon-192.png', 192, 0.56, 0], ['icon-512.png', 512, 0.56, 0], ['icon-maskable-512.png', 512, 0.42, 0],
];
for (const [name, size, scale, r] of icons) {
  await sharp(Buffer.from(iconSvg(size * 4, scale, C.black, C.offwhite, r * 4)), { density: 288 }).resize(size, size).png().toFile(path.join(ROOT, 'public', name));
  written.push(path.join(ROOT, 'public', name));
}
written.push(write(path.join(ROOT, 'public/site.webmanifest'), JSON.stringify({
  name: 'GAZU', short_name: 'GAZU', lang: 'pt-BR', start_url: '/', display: 'standalone', background_color: C.offwhite, theme_color: C.black,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n'));

// -------------------------------------------------------------------------------------------
// 3. Redes sociais (avatar 1080 e capa 1500×500)
// -------------------------------------------------------------------------------------------
await sharp(Buffer.from(iconSvg(1080, 0.42, C.black, C.offwhite))).png().toFile(path.join(SOCIAL, 'gazu-avatar-preto-1080.png'));
await sharp(Buffer.from(iconSvg(1080, 0.42, C.offwhite, C.black))).png().toFile(path.join(SOCIAL, 'gazu-avatar-claro-1080.png'));
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 500"><rect width="1500" height="500" fill="${C.stone}"/>${word(750, 250, 520, C.black)}</svg>`)).png().toFile(path.join(SOCIAL, 'gazu-capa-1500x500.png'));
written.push(path.join(SOCIAL, 'gazu-avatar-preto-1080.png'), path.join(SOCIAL, 'gazu-avatar-claro-1080.png'), path.join(SOCIAL, 'gazu-capa-1500x500.png'));

// -------------------------------------------------------------------------------------------
// 4. Materiais impressos (unidades em milímetros; sangria de 2 mm marcada no PDF)
// -------------------------------------------------------------------------------------------
const TAGLINE = 'Moda que se move com você.';
const line = (x1, y1, x2, y2, stroke = C.line, w = 0.25) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"/>`;
const field = (x, y, w, label, size = 2.2) => `${text(x, y, label, { size, fill: C.muted, tracking: 0.25, caps: true, weight: 500 })}${line(x, y + 4.2, x + w, y + 4.2, C.black, 0.2)}`;
const box = (x, y, label, size = 2.6) => `<rect x="${x}" y="${y - 2.6}" width="3" height="3" fill="none" stroke="${C.black}" stroke-width="0.25"/>${text(x + 4.6, y, label, { size })}`;

const print = {};

// 4.1 Tag de roupa 50 × 90 mm (frente e verso), furo de 4 mm
print['tag-frente'] = svgMm(50, 90, `<rect width="50" height="90" fill="${C.black}"/><circle cx="25" cy="8" r="2" fill="none" stroke="${C.stone2}" stroke-width="0.2"/>
${word(25, 45, 34, C.offwhite)}
${text(25, 80, TAGLINE, { size: 2.3, fill: C.stone2, anchor: 'middle', tracking: 0.1 })}`, 'Tag GAZU — frente');
print['tag-verso'] = svgMm(50, 90, `<rect width="50" height="90" fill="${C.offwhite}"/><circle cx="25" cy="8" r="2" fill="none" stroke="${C.line}" stroke-width="0.2"/>
${mark(25, 20, 9, C.black)}
${field(6, 34, 38, 'Produto')}${field(6, 46, 17, 'Tamanho')}${field(27, 46, 17, 'Cor')}${field(6, 58, 38, 'Referência (SKU)')}${field(6, 70, 38, 'Preço')}
${text(25, 84, 'Composição e cuidados na etiqueta interna.', { size: 1.9, fill: C.muted, anchor: 'middle' })}`, 'Tag GAZU — verso');

// 4.2 Cartão de agradecimento A6 (105 × 148 mm)
print['cartao-agradecimento-frente'] = svgMm(105, 148, `<rect width="105" height="148" fill="${C.stone}"/>${word(52.5, 66, 62, C.black)}
${text(52.5, 84, 'OBRIGADO', { size: 3.4, weight: 600, anchor: 'middle', tracking: 1.2 })}`, 'Cartão de agradecimento — frente');
print['cartao-agradecimento-verso'] = svgMm(105, 148, `<rect width="105" height="148" fill="${C.offwhite}"/>
${mark(52.5, 22, 12, C.black)}
${text(14, 44, 'Que bom ter você com a gente.', { size: 5.2, weight: 600, family: DISPLAY })}
${['Cada peça foi conferida e embalada com cuidado', 'para chegar até você do jeito certo.'].map((l, i) => text(14, 56 + i * 6, l, { size: 3.4 })).join('')}
${text(14, 80, 'Precisa de ajuda?', { size: 2.6, weight: 600, caps: true, tracking: 0.4 })}
${['Acompanhe o pedido em Minha conta › Pedidos', 'ou fale com a Central de Atendimento no site.'].map((l, i) => text(14, 88 + i * 5.2, l, { size: 3.1 })).join('')}
${text(14, 108, 'Trocas e devoluções', { size: 2.6, weight: 600, caps: true, tracking: 0.4 })}
${['Solicite pela sua conta. Compras online podem ser', 'devolvidas em até 7 dias após o recebimento', '(art. 49 do Código de Defesa do Consumidor).'].map((l, i) => text(14, 116 + i * 5.2, l, { size: 3.1 })).join('')}
${text(52.5, 142, TAGLINE, { size: 2.6, fill: C.muted, anchor: 'middle' })}`, 'Cartão de agradecimento — verso');

// 4.3 Adesivo de lacre Ø 50 mm (escuro e claro)
print['adesivo-lacre-preto'] = svgMm(50, 50, `<circle cx="25" cy="25" r="25" fill="${C.black}"/>${mark(25, 25, 19, C.offwhite)}<circle cx="25" cy="25" r="22" fill="none" stroke="${C.graphite}" stroke-width="0.35"/>`, 'Adesivo de lacre — preto');
print['adesivo-lacre-claro'] = svgMm(50, 50, `<circle cx="25" cy="25" r="25" fill="${C.offwhite}"/>${mark(25, 25, 19, C.black)}<circle cx="25" cy="25" r="22" fill="none" stroke="${C.line}" stroke-width="0.35"/>`, 'Adesivo de lacre — claro');

// 4.4 Cartão de cuidados A6
const careTips = [
  ['Siga a etiqueta interna', 'Ela traz a composição e as instruções específicas de cada peça e prevalece sobre estas dicas.'],
  ['Lave do avesso', 'Preserva cores e estampas. Separe peças escuras das claras nas primeiras lavagens.'],
  ['Prefira água fria', 'Ajuda a evitar encolhimento e desbotamento.'],
  ['Seque à sombra', 'Sol direto desbota tecidos. Evite secadora, salvo indicação da etiqueta.'],
  ['Malhas e tricôs: dobrados', 'Pendurar pode deformar ombros e alongar a peça.'],
  ['Tênis', 'Limpe com escova macia e sabão neutro. Não coloque na máquina.'],
];
const wrap = (s, n) => { const out = []; let cur = ''; for (const w of s.split(' ')) { if ((cur + ' ' + w).trim().length > n) { out.push(cur.trim()); cur = w; } else cur += ' ' + w; } if (cur.trim()) out.push(cur.trim()); return out; };
let cy = 39;
print['cuidados'] = svgMm(105, 148, `<rect width="105" height="148" fill="${C.offwhite}"/>
${word(52.5, 16, 30, C.black)}
${text(12, 32, 'Cuidados gerais com suas peças', { size: 4.4, weight: 600, family: DISPLAY })}
${careTips.map(([t, d]) => { const lines = wrap(d, 60); const block = `${text(12, cy, t, { size: 2.7, weight: 600, caps: true, tracking: 0.35 })}${lines.map((l, i) => text(12, cy + 5 + i * 4.4, l, { size: 3 })).join('')}`; cy += 7 + lines.length * 4.4 + 2.6; return block; }).join('')}
${text(52.5, 142, 'Dúvidas? Central de Atendimento no site.', { size: 2.6, fill: C.muted, anchor: 'middle' })}`, 'Cartão de cuidados');

// 4.5 Formulário de troca e devolução A5 (148 × 210 mm)
const rowsY = [116, 124, 132, 140];
print['troca-devolucao'] = svgMm(148, 210, `<rect width="148" height="210" fill="${C.white}"/>
${word(30, 18, 36, C.black)}
${text(136, 20, 'FORMULÁRIO DE TROCA E DEVOLUÇÃO', { size: 2.6, weight: 600, anchor: 'end', tracking: 0.5 })}
${line(12, 28, 136, 28, C.black, 0.3)}
${text(12, 37, 'Antes de enviar', { size: 3, weight: 600 })}
${['1. Abra a solicitação em Minha conta › Pedidos › Solicitar troca ou devolução', '    (ou pela Central de Atendimento, se comprou sem cadastro).', '2. Aguarde a aprovação e as instruções de envio por e-mail.', '3. Coloque este formulário preenchido no pacote, com a peça sem uso e com etiquetas.'].map((l, i) => text(12, 44 + i * 5, l, { size: 2.9 })).join('')}
${field(12, 70, 58, 'Número do pedido')}${field(78, 70, 58, 'Número da solicitação')}
${field(12, 82, 124, 'Nome completo')}
${field(12, 94, 76, 'E-mail')}${field(96, 94, 40, 'Telefone')}
${text(12, 106, 'ITENS', { size: 2.2, fill: C.muted, tracking: 0.25, weight: 500 })}
${['Produto', 'Cor', 'Tam.', 'Qtd.'].map((h, i) => text([12, 82, 106, 124][i], 112, h, { size: 2.4, weight: 600 })).join('')}
${rowsY.map((y) => line(12, y + 4, 136, y + 4, C.line, 0.25)).join('')}
${text(12, 152, 'TIPO DE SOLICITAÇÃO', { size: 2.2, fill: C.muted, tracking: 0.25, weight: 500 })}
${box(12, 159, 'Troca de tamanho/cor')}${box(58, 159, 'Devolução (desistência — 7 dias)')}${box(12, 165.5, 'Produto com defeito')}${box(58, 165.5, 'Outro')}
${field(12, 173, 124, 'Se troca: tamanho/cor desejados')}
${field(12, 184, 124, 'Motivo (opcional)')}
${field(12, 195, 70, 'Assinatura')}${field(90, 195, 46, 'Data')}
${text(74, 206, 'O reembolso é feito pelo mesmo meio de pagamento, após o recebimento e a conferência da peça.', { size: 2.2, fill: C.muted, anchor: 'middle' })}`, 'Formulário de troca e devolução');

// 4.6 Arte da tampa da caixa (300 × 220 mm — ajustar à faca do fornecedor)
print['caixa-tampa'] = svgMm(300, 220, `<rect width="300" height="220" fill="${C.black}"/>${word(150, 104, 120, C.offwhite)}
${text(150, 132, TAGLINE.toUpperCase(), { size: 4, fill: C.stone2, anchor: 'middle', tracking: 1.6 })}`, 'Tampa da caixa');

// 4.7 Papel de seda / papel de embrulho (módulo 200 × 200 mm, repetível)
let tiles = '';
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) tiles += mark(25 + x * 50 + (y % 2 ? 25 : 0), 25 + y * 50, 9, C.stone2);
// Linhas deslocadas: a metade cortada na borda direita reaparece na esquerda, para o módulo repetir sem emenda.
for (const y of [1, 3]) tiles += mark(0, 25 + y * 50, 9, C.stone2);
print['papel-seda-padrao'] = svgMm(200, 200, `<rect width="200" height="200" fill="${C.offwhite}"/>${tiles}`, 'Papel de seda — padrão repetível');

// 4.8 Etiqueta da embalagem de envio 100 × 150 mm (complementa a etiqueta da transportadora; não a substitui)
print['etiqueta-remetente'] = svgMm(100, 150, `<rect width="100" height="150" fill="${C.white}"/>
${word(50, 18, 40, C.black)}${line(8, 30, 92, 30, C.black, 0.3)}
${text(8, 40, 'REMETENTE', { size: 2.4, fill: C.muted, tracking: 0.3, weight: 500 })}
${field(8, 48, 84, 'Nome / razão social')}${field(8, 60, 84, 'Endereço')}${field(8, 72, 54, 'Cidade / UF')}${field(66, 72, 26, 'CEP')}
${text(8, 92, 'PEDIDO', { size: 2.4, fill: C.muted, tracking: 0.3, weight: 500 })}
${field(8, 100, 84, 'Número do pedido')}
${text(50, 132, 'Use a etiqueta oficial da transportadora para o destinatário.', { size: 2.3, fill: C.muted, anchor: 'middle' })}
${text(50, 140, 'Manuseie com cuidado.', { size: 2.6, weight: 600, anchor: 'middle', caps: true, tracking: 0.5 })}`, 'Etiqueta de remetente');

for (const [name, svg] of Object.entries(print)) written.push(write(path.join(PRINT, `${name}.svg`), svg));

// -------------------------------------------------------------------------------------------
// 5. Kit de impressão em PDF (uma página por peça, no tamanho real, com fontes embutidas)
// -------------------------------------------------------------------------------------------
const sizeOf = (svg) => { const m = /width="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg); return { w: Number(m[1]), h: Number(m[2]) }; };
const fontFace = (fam, file, weight) => `@font-face{font-family:'${fam}';font-weight:${weight};src:url(data:font/woff;base64,${fs.readFileSync(path.join(BR, 'fonts', file)).toString('base64')}) format('woff');}`;
const fonts = [fontFace('Inter', 'Inter-Regular.woff', 400), fontFace('Inter', 'Inter-Medium.woff', 500), fontFace('Inter', 'Inter-SemiBold.woff', 600), fontFace('Inter Display', 'InterDisplay-SemiBold.woff', 600), fontFace('Inter Display', 'InterDisplay-Bold.woff', 700)].join('');
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const parts = [];
  for (const [name, svg] of Object.entries(print)) {
    const { w, h } = sizeOf(svg);
    const pdfPath = path.join(PRINT, `.tmp-${name}.pdf`);
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${fonts}@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0}svg{display:block;width:${w}mm;height:${h}mm}</style></head><body>${svg.replace(/^<\?xml[^>]*>\s*/, '')}</body></html>`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: pdfPath, width: `${w}mm`, height: `${h}mm`, printBackground: true, pageRanges: '1' });
    parts.push([name, pdfPath]);
  }
  // Uma página-índice + cada peça como PDF próprio (gráficas pedem um arquivo por item).
  for (const [name, p] of parts) { fs.renameSync(p, path.join(PRINT, `${name}.pdf`)); written.push(path.join(PRINT, `${name}.pdf`)); }
  // Prancha de prova (A4) com todas as peças em escala, para revisão.
  const sheet = Object.entries(print).map(([name, svg]) => { const { w, h } = sizeOf(svg); const k = Math.min(1, 80 / w, 110 / h); return `<figure><div style="width:${(w * k).toFixed(1)}mm;height:${(h * k).toFixed(1)}mm">${svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%" height="100%"')}</div><figcaption>${name}.svg — ${w} × ${h} mm${k < 1 ? ` (escala ${Math.round(k * 100)}%)` : ''}</figcaption></figure>`; }).join('');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${fonts}@page{size:A4;margin:12mm}body{font-family:Inter,sans-serif;margin:0;color:#111}h1{font-size:14pt;letter-spacing:.08em;text-transform:uppercase}p{font-size:9pt;color:#555}main{display:flex;flex-wrap:wrap;gap:8mm}figure{margin:0;break-inside:avoid}figure div{outline:0.2mm solid #ccc}figcaption{font-size:7pt;color:#555;margin-top:2mm}</style></head><body><h1>GAZU — prova dos materiais impressos</h1><p>Prova de revisão. Para produção, envie à gráfica os arquivos individuais (PDF ou SVG) no tamanho real e confirme faca, sangria e papel com o fornecedor. Converta textos em curvas se a gráfica não tiver a fonte Inter (licença OFL, incluída em /assets/branding/fonts).</p><main>${sheet}</main></body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: path.join(PRINT, 'gazu-prova-materiais.pdf'), format: 'A4', printBackground: true });
  written.push(path.join(PRINT, 'gazu-prova-materiais.pdf'));
  await browser.close();
} catch (e) {
  console.warn('PDF não gerado (Playwright/Chromium indisponível):', e.message);
}

console.log(written.map((f) => path.relative(ROOT, f)).join('\n'));
