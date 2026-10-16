// Tipos compartilhados entre servidor e cliente (contratos da API).

export type Audience = 'masculino' | 'feminino' | 'unissex' | 'menino' | 'menina';

export interface ImageDTO {
  url: string;
  srcset: string | null;
  width: number | null;
  height: number | null;
  alt: string;
  position: string;
  colorName: string | null;
}

export interface ColorDTO {
  name: string;
  hex: string | null;
}

export interface ProductCardDTO {
  id: number;
  slug: string;
  name: string;
  type: string;
  audience: Audience;
  priceCents: number;
  promoPriceCents: number | null;
  image: ImageDTO | null;
  colors: ColorDTO[];
  available: boolean;
  isDemo: boolean;
  createdAt: string;
}

export interface VariantDTO {
  id: number;
  sku: string;
  colorName: string;
  colorHex: string | null;
  size: string;
  sizeOrder: number;
  priceCents: number;
  promoPriceCents: number | null;
  stock: number;
}

export interface BreadcrumbDTO {
  name: string;
  href: string;
}

export interface ProductDetailDTO extends ProductCardDTO {
  description: string;
  details: string | null;
  images: ImageDTO[];
  variants: VariantDTO[];
  breadcrumbs: BreadcrumbDTO[];
  categorySlugs: string[];
  colorConfirmed: boolean;
  related: ProductCardDTO[];
}

export interface CategoryDTO {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  parentId: number | null;
  position: number;
  isActive: boolean;
  productCount?: number;
  children?: CategoryDTO[];
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
  hex?: string | null;
}

export interface CatalogQuery {
  category?: string;
  q?: string;
  audience?: string[];
  size?: string[];
  color?: string[];
  type?: string[];
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'newest';
  page?: number;
  perPage?: number;
}

export interface CatalogResultDTO {
  items: ProductCardDTO[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  facets: {
    audience: FacetValue[];
    size: FacetValue[];
    color: FacetValue[];
    type: FacetValue[];
    price: { min: number; max: number };
  };
  category: (CategoryDTO & { breadcrumbs: BreadcrumbDTO[]; subcategories: CategoryDTO[] }) | null;
}

export interface CartItemInput {
  variantId: number;
  quantity: number;
}

export type CartIssue = 'out_of_stock' | 'insufficient_stock' | 'unavailable';

export interface CartLineDTO {
  variantId: number;
  productId: number;
  productSlug: string;
  name: string;
  colorName: string;
  size: string;
  image: ImageDTO | null;
  unitPriceCents: number;
  originalPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  stock: number;
  issue: CartIssue | null;
  isDemo: boolean;
  variants: { id: number; colorName: string; size: string; stock: number }[];
}

export interface CouponResultDTO {
  code: string;
  description: string;
  discountCents: number;
  valid: boolean;
  message: string | null;
}

export interface ShippingOptionDTO {
  id: string;
  label: string;
  priceCents: number;
  minDays: number;
  maxDays: number;
  isDemo: boolean;
  note: string | null;
}

export interface CartQuoteDTO {
  lines: CartLineDTO[];
  itemCount: number;
  subtotalCents: number;
  coupon: CouponResultDTO | null;
  discountCents: number;
  shipping: ShippingOptionDTO | null;
  shippingCents: number;
  totalCents: number;
  hasIssues: boolean;
}

export interface AddressDTO {
  id: number;
  label: string;
  recipient: string;
  cep: string;
  street: string;
  number: string;
  complement: string | null;
  district: string;
  city: string;
  state: string;
  isDefault: boolean;
}

export type OrderStatus = 'pending_payment' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'refunded' | 'partially_refunded';

export interface PaymentDTO {
  id: number;
  provider: 'mercadopago' | 'demo';
  method: 'pix' | 'credit_card' | 'debit_card' | 'demo';
  status: PaymentStatus;
  statusDetail: string | null;
  amountCents: number;
  pixQrCode: string | null;
  pixQrBase64: string | null;
  pixTicketUrl: string | null;
  cardLastFour: string | null;
  installments: number | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface OrderItemDTO {
  sku: string;
  productName: string;
  productSlug: string;
  colorName: string;
  size: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderEventDTO {
  type: string;
  message: string;
  actor: string;
  createdAt: string;
}

export interface OrderDTO {
  id: number;
  number: string;
  status: OrderStatus;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  couponCode: string | null;
  shippingLabel: string;
  shippingDaysText: string | null;
  shippingIsDemo: boolean;
  address: { recipient: string; cep: string; street: string; number: string; complement: string | null; district: string; city: string; state: string };
  trackingCode: string | null;
  trackingUrl: string | null;
  isDemo: boolean;
  expiresAt: string | null;
  createdAt: string;
  items: OrderItemDTO[];
  payments: PaymentDTO[];
  events: OrderEventDTO[];
  customer?: { id: string; email: string; name: string };
}

export interface MeDTO {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
  emailVerified: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
}

export interface PublicConfigDTO {
  demoMode: boolean;
  /** Versão HTML autônoma: aviso exibido nas páginas e conta de demonstração do painel. */
  standalone?: { notice: string; demoLogin: { email: string; password: string } };
  googleAuth: boolean;
  payments: {
    provider: 'mercadopago' | 'demo' | 'none';
    pix: boolean;
    creditCard: boolean;
    demo: boolean;
    mpPublicKey: string | null;
    maxInstallments: number;
  };
  shipping: { provider: 'manual' | 'demo'; configured: boolean };
  settings: {
    announcements: string[];
    heroTagline: string[];
    heroCollectionLabel: string[];
    showAccessoriesOnHome: boolean;
    contact: { email: string; phone: string; whatsapp: string; serviceHours: string };
    company: { legalName: string; cnpj: string; address: string };
    social: { instagram: string; tiktok: string; facebook: string };
  };
  categories: CategoryDTO[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
