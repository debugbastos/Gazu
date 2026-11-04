import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { ROOT } from '../config.ts';
import { HttpError } from '../http.ts';

// Upload de imagens validado: tipo real pela assinatura do arquivo (não pela extensão),
// tamanho máximo, dimensões plausíveis e reprocessamento para WebP (remove metadados/EXIF).

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const MAGIC: [string, number[]][] = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]],
];

export interface ProcessedImage {
  url: string;
  srcset: string;
  width: number;
  height: number;
  type: string;
}

export function detectImageType(buf: Buffer | undefined): string {
  if (!buf || buf.length < 100) throw new HttpError(400, 'Envie um arquivo de imagem.', 'no_file');
  if (buf.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Imagem acima de 8 MB.', 'too_large');
  const kind = MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b));
  if (!kind) throw new HttpError(415, 'Formato não suportado. Use JPG, PNG ou WebP.', 'bad_type');
  // WebP: "RIFF....WEBP"
  if (kind[0] === 'image/webp' && buf.subarray(8, 12).toString('ascii') !== 'WEBP') throw new HttpError(415, 'Formato não suportado. Use JPG, PNG ou WebP.', 'bad_type');
  return kind[0];
}

const safeSegment = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

/** Salva a imagem em public/uploads/<folder>/<subfolder>/ em larguras 480/960/1600 (sem ampliar). */
export async function processImageUpload(buf: Buffer | undefined, folder: string, subfolder: string): Promise<ProcessedImage> {
  const type = detectImageType(buf);
  let meta;
  try { meta = await sharp(buf!).metadata(); } catch { throw new HttpError(415, 'Arquivo de imagem inválido.', 'bad_image'); }
  if (!meta.width || !meta.height || meta.width > 8000 || meta.height > 8000) throw new HttpError(415, 'Dimensões de imagem inválidas.', 'bad_image');
  const rel = `${safeSegment(folder)}/${safeSegment(subfolder)}`;
  const dir = path.join(ROOT, 'public/uploads', rel);
  fs.mkdirSync(dir, { recursive: true });
  const base = crypto.randomBytes(6).toString('hex');
  const variants: { url: string; width: number; height: number }[] = [];
  for (const w of [480, 960, 1600]) {
    const width = Math.min(w, meta.width);
    if (variants.some((v) => v.width === width)) continue;
    const file = path.join(dir, `${base}-${width}.webp`);
    const info = await sharp(buf!).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 84 }).toFile(file);
    variants.push({ url: `/uploads/${rel}/${base}-${width}.webp`, width: info.width, height: info.height });
  }
  const main = variants[variants.length - 1]!;
  return { url: main.url, srcset: variants.map((v) => `${v.url} ${v.width}w`).join(', '), width: main.width, height: main.height, type };
}
