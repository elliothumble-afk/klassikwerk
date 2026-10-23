export interface BrandLike {
  wordmark_text: string | null
  logo_url: string | null
  tagline: string | null
  color_accent: string
  color_bg: string
  color_text: string
  font_display: string
  font_body: string
  process_copy: { label: string; copy: string }[]
}

export interface TermsLike {
  reservation_cents: number
  payment_schedule: { label: string; percent: number; trigger: string }[]
  warranty_text: string | null
  governing_law: string | null
  lead_time_copy: string | null
  currency: string
  quote_validity_days: number
  quote_intro_copy: string | null
  brochure_url: string | null
}

export interface OperatorContact {
  name?: string
  person?: string
  email?: string
  phone?: string
  website?: string
  address?: string
}

export interface BuilderLike {
  name: string
  legal_name: string | null
  slug: string
}

export interface PlatformLike {
  name: string
  chassis: string
  years: string
  hero_image_url: string | null
}

export interface TierLike {
  name: string
  base_price_cents: number | null
}

export interface OptionLineForPdf {
  group_name: string
  group_sort: number
  name: string
  code: string | null
  swatch_image_url: string | null
  /** Unit price. For cost_based builders the extended line price is
   *  parts_sell × quantity + install_price (labour isn't multiplied).
   *  Otherwise it's price_cents_at_selection × quantity, except when
   *  sold_as_set is true — then quantity stays 1. */
  price_cents_at_selection: number
  quantity: number
  sold_as_set: boolean
  included: boolean
  /** Cost-based pricing split. If present, line = parts × qty + install;
   *  otherwise fall back to legacy price_cents × qty behaviour. */
  parts_sell_cents: number | null
  install_price_cents: number | null
}

export interface PdfPricingMode {
  mode: 'simple' | 'cost_based'
}

export interface CustomerLike {
  full_name: string | null
  email: string | null
}

export interface QuotePdfInput {
  quote_id: string
  version: number
  price_cents: number
  created_at: string
  builder: BuilderLike
  brand: BrandLike
  terms: TermsLike
  operator_contact: OperatorContact
  platform: PlatformLike
  tier: TierLike
  options: OptionLineForPdf[]
  customer: CustomerLike | null
  customer_phone: string | null
  pricing_mode: 'simple' | 'cost_based'
}

export interface ContractPdfInput {
  build_id: string
  title: string
  version: number
  body_markdown: string
  merge_fields: Record<string, string>
  price_cents: number
  reservation_cents: number
  payment_schedule: { label: string; percent: number; trigger: string }[]
  currency: string
  builder: BuilderLike
  brand: BrandLike
  operator_contact: OperatorContact
}

/** Sentinel string that replaces {{payment_schedule_table}} so the
 *  contract renderer can swap in the structured schedule component. */
export const PAYMENT_SCHEDULE_SENTINEL = '__KW_PAYMENT_SCHEDULE__'

export function money(cents: number | null | undefined, currency = 'usd'): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100)
}
