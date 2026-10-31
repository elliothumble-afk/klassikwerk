import { z } from 'zod'

export const platformSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, hyphens only'),
  name: z.string().min(1),
  chassis: z.string().min(1),
  years: z.string().min(1),
  hero_image_url: z.string().url().nullable().or(z.literal('')).transform(v => v || null),
  sort: z.coerce.number().int().min(0),
  active: z.boolean(),
})

export const tierSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  // Form holds dollars; save layer converts to cents
  base_price: z.coerce.number().min(0).nullable(),
  lead_time_weeks: z.coerce.number().int().min(1).nullable(),
  description: z.string().nullable().or(z.literal('')).transform(v => v || null),
  quote_only: z.boolean(),
  active: z.boolean(),
  sort: z.coerce.number().int().min(0),
})

export const catalogOptionSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  code: z.string().nullable().or(z.literal('')).transform(v => v || null),
  // Form holds dollars; save layer converts to cents
  price: z.coerce.number().min(0),
  included_in_tier_ids: z.array(z.string().uuid()),
  sort: z.coerce.number().int().min(0),
  active: z.boolean(),
  sold_as_set: z.boolean(),
  // Nullable (manual options can be left uncategorised). When an ops
  // user edits, we also mark category_locked so a later sync won't
  // reassign.
  category_id: z.string().uuid().nullable().or(z.literal('')).transform(v => v || null),
  origin_id: z.string().uuid().nullable().or(z.literal('')).transform(v => v || null),
  // Operator cost per unit. Blank → cost = sell for margin purposes.
  cost: z.coerce.number().min(0).nullable().or(z.literal('')).transform(v => v === '' || v == null ? null : Number(v)),
  // Lookbook PDF copy. Sync populates from Shopify body_html; ops can
  // override and the override wins on resync.
  description: z.string().nullable().or(z.literal('')).transform(v => v || null),
  // Chosen hero image for the Lookbook option page. Null = fall back to
  // the first catalog_option_images row by sort, then swatch.
  lead_image_url: z.string().url().nullable().or(z.literal('')).transform(v => v || null),
})

export type PlatformForm = z.infer<typeof platformSchema>
export type TierForm = z.infer<typeof tierSchema>
export type CatalogOptionForm = z.infer<typeof catalogOptionSchema>
