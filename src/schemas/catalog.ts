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
  base_price_cents: z.coerce.number().int().min(0).nullable(),
  lead_time_weeks: z.coerce.number().int().min(1).nullable(),
  description: z.string().nullable().or(z.literal('')).transform(v => v || null),
  quote_only: z.boolean(),
  sort: z.coerce.number().int().min(0),
})

export const catalogOptionSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  code: z.string().nullable().or(z.literal('')).transform(v => v || null),
  price_cents: z.coerce.number().int().min(0),
  included_in_tier_ids: z.array(z.string().uuid()),
  sort: z.coerce.number().int().min(0),
  active: z.boolean(),
})

export type PlatformForm = z.infer<typeof platformSchema>
export type TierForm = z.infer<typeof tierSchema>
export type CatalogOptionForm = z.infer<typeof catalogOptionSchema>
