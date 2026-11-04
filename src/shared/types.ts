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
  /** Segunda foto (exibida ao passar o mouse), quando existir. */
  hoverImage?: ImageDTO | null;
  /** Primeira foto de cada cor (troca a imagem ao escolher a cor no cartão). */
  colorImages?: Record<string, ImageDTO>;
  isNew?: boolean;
  lowStock?: boolean;
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
  brand?: string | null;
  composition?: string | null;
  careInstructions?: string | null;
  fitNotes?: string | null;
  sizeGuide?: SizeGuideDTO | null;
  reviews?: ReviewSummaryDTO;
  looks?: LookbookCardDTO[];
  faq?: FaqItemDTO[];
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
  newOnly?: boolean;
  collection?: string;
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
    collections?: FacetValue[];
    newCount?: number;
  };
  /** Busca: quando não há resultados para o termo digitado, mostra os de um termo corrigido. */
  correctedQuery?: string | null;
  suggestions?: string[];
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
export type PaymentStatus = 'pending' | 'in_process' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded';

export interface PaymentDTO {
  id: number;
  provider: 'mercadopago' | 'demo';
  method: 'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'demo';
  status: PaymentStatus;
  statusDetail: string | null;
  amountCents: number;
  refundedCents?: number;
  feeCents?: number | null;
  boletoUrl?: string | null;
  boletoBarcode?: string | null;
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
  id?: number;
  unitCostCents?: number | null;
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
  customer?: { id: string; email: string; name: string; isGuest?: boolean };
  shipments?: ShipmentDTO[];
  refunds?: RefundDTO[];
  returns?: { id: number; number: string; type: string; status: string; createdAt: string }[];
  /** Somente no painel. */
  notes?: { id: number; body: string; author: string; createdAt: string }[];
  attribution?: { campaign: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null };
  /** O cliente pode solicitar troca/devolução (pedido entregue). */
  canRequestReturn?: boolean;
  canReview?: boolean;
  guest?: boolean;
}

export type ShipmentStatus = 'pending' | 'preparing' | 'label_purchased' | 'shipped' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'delivery_failed' | 'returned' | 'cancelled';
export interface ShipmentDTO {
  id: number; status: ShipmentStatus; provider: 'manual' | 'melhorenvio'; carrier: string | null; service: string | null; trackingCode: string | null; trackingUrl: string | null;
  labelUrl?: string | null; costCents?: number | null; shippedAt: string | null; deliveredAt: string | null; createdAt: string;
  events: { status: string; description: string; location: string | null; occurredAt: string; source: string }[];
}
export interface RefundDTO { id: number; amountCents: number; status: 'requested' | 'approved' | 'rejected' | 'failed'; reason: string; createdAt: string; confirmedAt: string | null }

export interface MeDTO {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
  emailVerified: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  staffRole?: string | null;
  permissions?: string[];
}

export interface PublicConfigDTO {
  demoMode: boolean;
  /** Versão HTML autônoma: aviso exibido nas páginas e acesso ao painel de demonstração (sem senha: não há dados reais). */
  standalone?: { notice: string; demoAdmin: boolean };
  googleAuth: boolean;
  guestCheckout: boolean;
  payments: {
    provider: 'mercadopago' | 'demo' | 'none';
    pix: boolean;
    creditCard: boolean;
    boleto: boolean;
    demo: boolean;
    mpPublicKey: string | null;
    maxInstallments: number;
    boletoDays: number;
    pixMinutes: number;
  };
  shipping: { provider: 'manual' | 'demo' | 'melhorenvio'; configured: boolean };
  announcements: AnnouncementDTO[];
  settings: {
    announcements: string[];
    heroTagline: string[];
    heroCollectionLabel: string[];
    showAccessoriesOnHome: boolean;
    contact: { email: string; phone: string; whatsapp: string; serviceHours: string };
    company: { legalName: string; cnpj: string; address: string };
    social: { instagram: string; tiktok: string; facebook: string };
    home?: { sections: { key: HomeSectionKey; enabled: boolean }[] };
    whatsapp?: { showButton: boolean; defaultMessage: string };
    newsletter?: { enabled: boolean; title: string; text: string };
    reviews?: { enabled: boolean };
    policies?: { exchangeDays: number | null; withdrawalDays: number; defectDays: number; newArrivalsDays: number };
  };
  categories: CategoryDTO[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------------------------
// Conteúdo editorial e descoberta (coleções, Archive, lookbooks, Journal, páginas, FAQ, banners)
// ---------------------------------------------------------------------------------------------

export interface AnnouncementDTO { id: number; message: string; linkUrl: string | null }

export interface BannerDTO {
  id: number; placement: 'home_editorial' | 'home_secondary' | 'catalog_top'; eyebrow: string | null; title: string; subtitle: string | null;
  imageUrl: string | null; imageAlt: string | null; linkUrl: string; ctaLabel: string;
}

export interface CollectionCardDTO {
  id: number; slug: string; name: string; description: string; season: string | null; coverUrl: string | null; coverAlt: string | null;
  status: 'draft' | 'active' | 'archived'; productCount: number; isDemo: boolean; archivedAt: string | null;
}
export interface CollectionDetailDTO extends CollectionCardDTO { products: ProductCardDTO[]; lookbooks: LookbookCardDTO[] }

export interface QuickVariantDTO { id: number; colorName: string; colorHex: string | null; size: string; stock: number; priceCents: number; promoPriceCents: number | null }
export interface QuickProductDTO extends ProductCardDTO { variants: QuickVariantDTO[] }

export interface LookbookCardDTO { id: number; slug: string; title: string; description: string; coverUrl: string | null; productCount: number; isDemo: boolean; publishedAt: string | null }
export interface LookbookHotspotDTO { id: number; productId: number; x: number | null; y: number | null; label: string | null }
export interface LookbookImageDTO { id: number; url: string; alt: string; width: number | null; height: number | null; hotspots: LookbookHotspotDTO[] }
export interface LookbookDetailDTO extends LookbookCardDTO { images: LookbookImageDTO[]; products: QuickProductDTO[]; collection: { slug: string; name: string } | null }

export interface ArticleCardDTO { id: number; slug: string; title: string; excerpt: string; coverUrl: string | null; coverAlt: string | null; category: string; author: string; publishedAt: string | null; isDemo: boolean }
export interface ArticleDetailDTO extends ArticleCardDTO { html: string; products: ProductCardDTO[]; seoTitle: string | null; seoDescription: string | null }

export interface PageDTO { slug: string; title: string; html: string; updatedAt: string }
export interface FaqItemDTO { id: number; category: string; question: string; html: string }

export interface SizeGuideDTO { id: number; name: string; head: string[]; rows: string[][]; note: string | null; isDemo: boolean }

export interface ReviewDTO { id: number; authorName: string; rating: number; title: string; body: string; createdAt: string; verified: boolean }
export interface ReviewSummaryDTO { count: number; average: number | null; distribution: Record<1 | 2 | 3 | 4 | 5, number> }

export type HomeSectionKey = 'categories' | 'editorial' | 'trust' | 'featured' | 'new' | 'collections' | 'lookbook' | 'clothing' | 'sneakers' | 'accessories' | 'journal' | 'newsletter';

export interface HomeContentDTO {
  sections: { key: HomeSectionKey; enabled: boolean }[];
  banners: BannerDTO[];
  collections: CollectionCardDTO[];
  lookbook: LookbookDetailDTO | null;
  articles: ArticleCardDTO[];
}

// ---- Trocas e devoluções ----
export type ReturnType = 'withdrawal' | 'exchange' | 'defect' | 'other';
export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'awaiting_item' | 'received' | 'refunded' | 'exchanged' | 'closed';
export interface ReturnDTO {
  id: number; number: string; orderNumber: string; type: ReturnType; reason: string; status: ReturnStatus; resolution: string | null; refundAmountCents: number | null;
  createdAt: string; updatedAt: string;
  items: { orderItemId: number; quantity: number; productName: string; colorName: string; size: string; sku: string; restocked: boolean }[];
  events: { status: string; message: string; actor: string; internal: boolean; createdAt: string }[];
  customerEmail?: string | null; customerName?: string | null;
}

// ---- Atendimento ----
export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
export type TicketCategory = 'produto' | 'pedido' | 'pagamento' | 'entrega' | 'troca' | 'reembolso' | 'defeito' | 'contato' | 'outro';
export interface TicketMessageDTO { id: number; authorType: 'customer' | 'staff' | 'system'; authorName: string | null; body: string; internal: boolean; channel: string; createdAt: string }
export interface TicketDTO {
  id: number; number: string; subject: string; category: TicketCategory; status: TicketStatus; priority: 'low' | 'normal' | 'high' | 'urgent'; channel: string;
  name: string; email: string; phone: string | null; orderNumber: string | null; productName: string | null; assignee: { id: string; name: string } | null;
  createdAt: string; updatedAt: string; closedAt: string | null; lastCustomerMessageAt: string | null; messages: TicketMessageDTO[];
}

// ---- Avaliações (painel) ----
export interface AdminReviewDTO { id: number; productId: number; productName: string; productSlug: string; authorName: string; email: string | null; rating: number; title: string; body: string; status: 'pending' | 'approved' | 'rejected'; orderNumber: string | null; createdAt: string; moderatedAt: string | null }

// ---- Financeiro ----
export interface FinanceSummaryDTO {
  period: { from: string; to: string };
  orders: { paidCount: number; cancelledCount: number; refundedCount: number };
  grossSalesCents: number;          // soma dos subtotais (produtos) de pedidos pagos no período
  discountsCents: number;
  shippingChargedCents: number;
  paidRevenueCents: number;         // total efetivamente pago (aprovado pelo provedor)
  refundsCents: number;             // estornos confirmados no período
  netRevenueCents: number;          // paidRevenue − refunds
  providerFeesCents: number | null; // taxas informadas pelo provedor (null = sem dado)
  productCostCents: number | null;  // custo dos produtos vendidos (null = há itens sem custo cadastrado)
  shippingCostCents: number | null;
  packagingCostCents: number | null;
  expensesCents: number;
  estimatedProfitCents: number | null;
  averageTicketCents: number | null;
  marginPercent: number | null;
  missing: string[];                // dados ausentes que impedem cálculos completos
  byDay: { day: string; paidRevenueCents: number; orders: number }[];
  byMethod: { method: string; paidRevenueCents: number; orders: number }[];
  expensesByCategory: { category: string; amountCents: number }[];
}

// ---- Analytics ----
export interface AnalyticsReportDTO {
  period: { from: string; to: string };
  consentedSessions: number;
  funnel: { step: string; sessions: number }[];
  topProducts: { productId: number; name: string; views: number; addToCart: number; purchases: number }[];
  topSearches: { term: string; count: number; avgResults: number }[];
  zeroResultSearches: { term: string; count: number }[];
  sources: { source: string; sessions: number; orders: number; revenueCents: number }[];
  purchases: { orders: number; revenueCents: number; note: string };
}
