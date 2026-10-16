import { z } from 'zod';
import { getDb, nowIso } from '../db.ts';

// Configurações administráveis da loja. Campos vazios = ainda não fornecidos pelo cliente
// (o site não inventa CNPJ, endereço, telefone ou redes sociais).
export const storeSettingsSchema = z.object({
  announcements: z.array(z.string().trim().min(1).max(120)).max(5),
  heroTagline: z.array(z.string().trim().max(30)).min(1).max(4),
  heroCollectionLabel: z.array(z.string().trim().max(30)).min(1).max(4),
  showAccessoriesOnHome: z.boolean(),
  contact: z.object({
    email: z.string().trim().max(120),
    phone: z.string().trim().max(40),
    whatsapp: z.string().trim().max(40),
    serviceHours: z.string().trim().max(120),
  }),
  company: z.object({
    legalName: z.string().trim().max(160),
    cnpj: z.string().trim().max(20),
    address: z.string().trim().max(240),
  }),
  social: z.object({
    instagram: z.string().trim().max(200),
    tiktok: z.string().trim().max(200),
    facebook: z.string().trim().max(200),
  }),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const defaultSettings: StoreSettings = {
  announcements: ['Nova coleção GAZU — conheça as novidades'],
  heroTagline: ['Moda que', 'se move', 'com você.'],
  heroCollectionLabel: ['Nova', 'coleção', String(new Date().getFullYear())],
  showAccessoriesOnHome: true,
  contact: { email: '', phone: '', whatsapp: '', serviceHours: '' },
  company: { legalName: '', cnpj: '', address: '' },
  social: { instagram: '', tiktok: '', facebook: '' },
};

export function getSettings(): StoreSettings {
  const row = getDb().get<{ value: string }>("SELECT value FROM settings WHERE key = 'store'");
  if (!row) return defaultSettings;
  const parsed = storeSettingsSchema.safeParse({ ...defaultSettings, ...JSON.parse(row.value) });
  return parsed.success ? parsed.data : defaultSettings;
}

export function saveSettings(s: StoreSettings): void {
  getDb().run(
    `INSERT INTO settings (key, value, updated_at) VALUES ('store', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    JSON.stringify(s),
    nowIso(),
  );
}
