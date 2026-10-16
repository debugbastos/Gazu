import { z } from 'zod';
import { onlyDigits, UF } from '../shared/format.ts';

export const email = z.string().trim().toLowerCase().email('E-mail inválido.').max(160);
export const password = z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.').max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(120),
  email,
  password,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar os termos e a política de privacidade.' }) }),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const forgotSchema = z.object({ email });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().max(128).optional(), newPassword: password });

export const cartItemsSchema = z.array(z.object({ variantId: z.number().int().positive(), quantity: z.number().int().min(1).max(20) })).max(50);

export const quoteSchema = z.object({
  items: cartItemsSchema,
  couponCode: z.string().trim().max(40).optional().nullable(),
  cep: z.string().max(12).optional().nullable(),
  shippingOptionId: z.string().max(40).optional().nullable(),
});

export const cepSchema = z.string().transform(onlyDigits).refine((v) => /^\d{8}$/.test(v), 'CEP inválido.');

export const addressSchema = z.object({
  label: z.string().trim().max(40).default('Endereço'),
  recipient: z.string().trim().min(3, 'Informe o nome do destinatário.').max(120),
  cep: cepSchema,
  street: z.string().trim().min(2, 'Informe a rua.').max(160),
  number: z.string().trim().min(1, 'Informe o número.').max(20),
  complement: z.string().trim().max(80).optional().nullable(),
  district: z.string().trim().min(2, 'Informe o bairro.').max(80),
  city: z.string().trim().min(2, 'Informe a cidade.').max(80),
  state: z.string().trim().toUpperCase().refine((v) => (UF as readonly string[]).includes(v), 'UF inválida.'),
  isDefault: z.boolean().optional(),
});

export const checkoutSchema = z.object({
  items: cartItemsSchema.min(1, 'Seu carrinho está vazio.'),
  couponCode: z.string().trim().max(40).optional().nullable(),
  addressId: z.number().int().positive().optional(),
  address: addressSchema.optional(),
  saveAddress: z.boolean().optional(),
  shippingOptionId: z.string().min(1).max(40),
  expectedTotalCents: z.number().int().nonnegative().optional(),
});

export const cardPaymentSchema = z.object({
  token: z.string().min(10).max(200),
  installments: z.number().int().min(1).max(12),
  paymentMethodId: z.string().min(2).max(40),
  issuerId: z.string().max(20).optional().nullable(),
  identificationType: z.string().max(10).optional().nullable(),
  identificationNumber: z.string().max(20).optional().nullable(),
});

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().nullable(),
});

const money = z.number().int().min(1).max(100_000_00);
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.').max(120);
const isoDate = z.string().datetime({ offset: true }).optional().nullable();

export const adminProductSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug,
  description: z.string().trim().max(4000).default(''),
  details: z.string().trim().max(4000).optional().nullable(),
  audience: z.enum(['masculino', 'feminino', 'unissex', 'menino', 'menina']),
  productType: z.string().trim().min(2).max(60),
  priceCents: money,
  promoPriceCents: money.optional().nullable(),
  promoStartsAt: isoDate,
  promoEndsAt: isoDate,
  categoryIds: z.array(z.number().int().positive()).min(1, 'Selecione ao menos uma categoria.').max(10),
  primaryCategoryId: z.number().int().positive(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  isDemo: z.boolean(),
  colorConfirmed: z.boolean(),
  seoTitle: z.string().trim().max(70).optional().nullable(),
  seoDescription: z.string().trim().max(170).optional().nullable(),
}).refine((p) => !p.promoPriceCents || p.promoPriceCents < p.priceCents, { message: 'O preço promocional deve ser menor que o preço.', path: ['promoPriceCents'] })
  .refine((p) => p.categoryIds.includes(p.primaryCategoryId), { message: 'A categoria principal deve estar entre as categorias selecionadas.', path: ['primaryCategoryId'] });

export const adminVariantSchema = z.object({
  sku: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._-]+$/, 'SKU com caracteres inválidos.'),
  colorName: z.string().trim().min(1).max(60),
  colorHex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  size: z.string().trim().min(1).max(20),
  sizeOrder: z.number().int().min(0).max(999).default(0),
  priceCents: money.optional().nullable(),
  isActive: z.boolean().default(true),
  initialStock: z.number().int().min(0).max(100000).optional(),
});

export const stockAdjustSchema = z.object({ delta: z.number().int().min(-100000).max(100000).refine((v) => v !== 0, 'Informe um ajuste diferente de zero.'), reason: z.enum(['adjustment', 'restock']), note: z.string().trim().max(200).optional() });

export const adminCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug,
  description: z.string().trim().max(400).optional().nullable(),
  parentId: z.number().int().positive().optional().nullable(),
  position: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
  imageUrl: z.string().trim().max(300).optional().nullable(),
});

export const adminCouponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(40).regex(/^[A-Z0-9_-]+$/, 'Use letras, números, _ ou -.'),
  description: z.string().trim().max(200).default(''),
  discountType: z.enum(['percent', 'fixed']),
  value: z.number().int().positive(),
  minOrderCents: z.number().int().min(0).default(0),
  startsAt: isoDate,
  endsAt: isoDate,
  maxUses: z.number().int().positive().optional().nullable(),
  maxUsesPerUser: z.number().int().positive().optional().nullable(),
  isActive: z.boolean(),
  categoryIds: z.array(z.number().int().positive()).max(50).default([]),
  productIds: z.array(z.number().int().positive()).max(200).default([]),
}).refine((c) => c.discountType !== 'percent' || c.value <= 90, { message: 'Percentual máximo: 90%.', path: ['value'] })
  .refine((c) => !c.startsAt || !c.endsAt || c.startsAt < c.endsAt, { message: 'A data final deve ser posterior à inicial.', path: ['endsAt'] });

export const adminShippingRuleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  cepStart: cepSchema,
  cepEnd: cepSchema,
  priceCents: z.number().int().min(0).max(100_000_00),
  minDays: z.number().int().min(0).max(120),
  maxDays: z.number().int().min(0).max(120),
  freeAboveCents: z.number().int().positive().optional().nullable(),
  isActive: z.boolean(),
  position: z.number().int().min(0).max(999).default(0),
}).refine((r) => r.cepStart <= r.cepEnd, { message: 'CEP inicial deve ser menor ou igual ao final.', path: ['cepEnd'] })
  .refine((r) => r.minDays <= r.maxDays, { message: 'Prazo mínimo deve ser menor ou igual ao máximo.', path: ['maxDays'] });

export const adminOrderUpdateSchema = z.object({
  status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']).optional(),
  trackingCode: z.string().trim().max(60).optional().nullable(),
  trackingUrl: z.string().trim().url().max(300).optional().nullable().or(z.literal('')),
  note: z.string().trim().max(300).optional(),
});
