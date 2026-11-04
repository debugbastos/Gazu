import { z } from 'zod';
import { getDb, nowIso } from '../db.ts';
import type { HomeSectionKey } from '../../shared/types.ts';

// Configurações administráveis da loja. Campos vazios = ainda não fornecidos pelo cliente
// (o site não inventa CNPJ, endereço, telefone, redes sociais, custos ou taxas).

export const HOME_SECTION_KEYS = ['categories', 'editorial', 'trust', 'featured', 'new', 'collections', 'lookbook', 'journal', 'clothing', 'sneakers', 'accessories', 'newsletter'] as const satisfies readonly HomeSectionKey[];

export const HOME_SECTION_LABEL: Record<HomeSectionKey, string> = {
  categories: 'Categorias visuais', editorial: 'Banner editorial', trust: 'Confiança e suporte', featured: 'Produtos selecionados (O melhor da GAZU)',
  new: 'Novidades', collections: 'Coleções em destaque', lookbook: 'Lookbook comprável', journal: 'Editorial GAZU (Journal)',
  clothing: 'Seleção de roupas', sneakers: 'Seleção de tênis', accessories: 'Acessórios', newsletter: 'Newsletter',
};

export const storeSettingsSchema = z.object({
  /** Mantido por compatibilidade: as mensagens agora ficam na tabela `announcements` (com validade). */
  announcements: z.array(z.string().trim().min(1).max(120)).max(5).default([]),
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
  home: z.object({
    sections: z.array(z.object({ key: z.enum(HOME_SECTION_KEYS), enabled: z.boolean() })).max(HOME_SECTION_KEYS.length),
  }),
  operations: z.object({
    /** Custo de embalagem por pedido informado pelo responsável (null = não informado). */
    packagingCostCents: z.number().int().min(0).max(100_000).nullable(),
    lowStockThreshold: z.number().int().min(0).max(100),
    newArrivalsDays: z.number().int().min(1).max(365),
    abandonedCartHours: z.number().int().min(1).max(168),
    /** Prazo de troca definido pela loja (dias após a entrega). null = sem prazo automático: cada pedido é avaliado. */
    exchangeDays: z.number().int().min(1).max(365).nullable(),
  }),
  whatsapp: z.object({
    /** Exibe o botão "Falar no WhatsApp" (link wa.me). Não é uma automação de atendimento. */
    showButton: z.boolean(),
    defaultMessage: z.string().trim().max(200),
  }),
  newsletter: z.object({ enabled: z.boolean(), title: z.string().trim().max(80), text: z.string().trim().max(240) }),
  reviews: z.object({ enabled: z.boolean(), requireModeration: z.boolean() }),
  /** Remetente das etiquetas (Melhor Envio). Preenchido pelo responsável da loja; nada é inventado. */
  shippingSender: z.object({
    name: z.string().trim().max(120), phone: z.string().trim().max(30), email: z.string().trim().max(120), document: z.string().trim().max(20),
    street: z.string().trim().max(160), number: z.string().trim().max(20), complement: z.string().trim().max(80), district: z.string().trim().max(80),
    city: z.string().trim().max(80), state: z.string().trim().max(2), cep: z.string().trim().max(9),
  }),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const defaultSettings: StoreSettings = {
  announcements: [],
  heroTagline: ['Moda que', 'se move', 'com você.'],
  heroCollectionLabel: ['Nova', 'coleção', String(new Date().getFullYear())],
  showAccessoriesOnHome: true,
  contact: { email: '', phone: '', whatsapp: '', serviceHours: '' },
  company: { legalName: '', cnpj: '', address: '' },
  social: { instagram: '', tiktok: '', facebook: '' },
  home: {
    sections: (['categories', 'editorial', 'trust', 'featured', 'new', 'collections', 'lookbook', 'journal', 'clothing', 'sneakers', 'accessories', 'newsletter'] as const)
      .map((key) => ({ key, enabled: true })),
  },
  operations: { packagingCostCents: null, lowStockThreshold: 2, newArrivalsDays: 30, abandonedCartHours: 24, exchangeDays: null },
  whatsapp: { showButton: true, defaultMessage: 'Olá! Vim pelo site da GAZU e gostaria de ajuda.' },
  newsletter: { enabled: true, title: 'Receba as novidades da GAZU', text: 'Lançamentos, coleções e conteúdos do Journal. Você pode cancelar quando quiser.' },
  reviews: { enabled: true, requireModeration: true },
  shippingSender: { name: '', phone: '', email: '', document: '', street: '', number: '', complement: '', district: '', city: '', state: '', cep: '' },
};

/** Junta as seções salvas com as conhecidas (novas seções aparecem no fim, habilitadas). */
function normalizeSections(saved: StoreSettings['home']['sections']): StoreSettings['home']['sections'] {
  const seen = new Set<string>();
  const out = saved.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)));
  for (const key of HOME_SECTION_KEYS) if (!seen.has(key)) out.push({ key, enabled: true });
  return out;
}

export function getSettings(): StoreSettings {
  const row = getDb().get<{ value: string }>("SELECT value FROM settings WHERE key = 'store'");
  if (!row) return defaultSettings;
  const raw = JSON.parse(row.value) as Partial<StoreSettings>;
  const merged = {
    ...defaultSettings, ...raw,
    home: { ...defaultSettings.home, ...(raw.home ?? {}) },
    operations: { ...defaultSettings.operations, ...(raw.operations ?? {}) },
    whatsapp: { ...defaultSettings.whatsapp, ...(raw.whatsapp ?? {}) },
    newsletter: { ...defaultSettings.newsletter, ...(raw.newsletter ?? {}) },
    reviews: { ...defaultSettings.reviews, ...(raw.reviews ?? {}) },
    shippingSender: { ...defaultSettings.shippingSender, ...(raw.shippingSender ?? {}) },
  };
  const parsed = storeSettingsSchema.safeParse(merged);
  const s = parsed.success ? parsed.data : defaultSettings;
  return { ...s, home: { sections: normalizeSections(s.home.sections) } };
}

export function saveSettings(s: StoreSettings): void {
  getDb().run(
    `INSERT INTO settings (key, value, updated_at) VALUES ('store', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    JSON.stringify(s),
    nowIso(),
  );
}
