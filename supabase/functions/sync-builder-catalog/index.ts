// sync-builder-catalog — Supabase Edge Function (Deno)
//
// Pulls a builder's catalog + brand + terms + contract template from
// their Connect feed URL (or an inline payload for the dev "Sync from
// fixture" button) and upserts in dependency order. Anything previously
// synced but missing from the feed is deactivated. Each run writes a
// sync_runs row.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { z } from 'https://esm.sh/zod@3.24.1'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ──────────────────────────────────────────────────────────────────
// Feed schema (zod)
// ──────────────────────────────────────────────────────────────────

const brandSchema = z.object({
  external_id: z.string(),
  wordmark_text: z.string().nullable().optional(),
  logo_url: z.string().url().nullable().optional(),
  tagline: z.string().nullable().optional(),
  color_accent: z.string(),
  color_bg: z.string(),
  color_text: z.string(),
  font_display: z.string(),
  font_body: z.string(),
  hero_copy: z.string().nullable().optional(),
  process_copy: z.array(z.object({ label: z.string(), copy: z.string() })).default([]),
  enquire_url: z.string().optional(),
  custom_domain: z.string().nullable().optional(),
})

const termsSchema = z.object({
  external_id: z.string(),
  reservation_cents: z.number().int().nonnegative(),
  payment_schedule: z.array(z.object({
    label: z.string(),
    percent: z.number(),
    trigger: z.string(),
  })).default([]),
  warranty_text: z.string().nullable().optional(),
  governing_law: z.string().nullable().optional(),
  lead_time_copy: z.string().nullable().optional(),
  currency: z.string().default('usd'),
  quote_validity_days: z.number().int().positive().default(30),
  quote_intro_copy: z.string().nullable().optional(),
  brochure_url: z.string().nullable().optional(),
  payment_mode: z.enum(['none', 'stripe']).default('none'),
  option_mode: z.enum(['included_only', 'priced']).default('priced'),
})

const contractSchema = z.object({
  external_id: z.string(),
  title: z.string(),
  body_markdown: z.string(),
})

const platformSchema = z.object({
  external_id: z.string(),
  slug: z.string(),
  name: z.string(),
  chassis: z.string(),
  years: z.string(),
  hero_image_url: z.string().url().nullable().optional(),
  sort: z.number().int().default(0),
  active: z.boolean().default(true),
})

const tierSchema = z.object({
  external_id: z.string(),
  slug: z.string(),
  name: z.string(),
  base_price_cents: z.number().int().nullable().optional(),
  lead_time_weeks: z.number().int().nullable().optional(),
  quote_only: z.boolean().default(false),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
  description: z.string().nullable().optional(),
})

const groupSchema = z.object({
  external_id: z.string(),
  slug: z.string(),
  name: z.string(),
  selection: z.enum(['single', 'multi']),
  required: z.boolean().default(false),
  sort: z.number().int().default(0),
  platform_external_id: z.string().nullable().optional(),
})

const optionSchema = z.object({
  external_id: z.string(),
  group_external_id: z.string(),
  slug: z.string(),
  name: z.string(),
  code: z.string().nullable().optional(),
  price_cents: z.number().int().default(0),
  included_in_tier_external_ids: z.array(z.string()).default([]),
  swatch_image_url: z.string().url().nullable().optional(),
  sort: z.number().int().default(0),
  active: z.boolean().default(true),
  platform_external_ids: z.array(z.string()).default([]),
})

const feedSchema = z.object({
  builder: z.object({
    slug: z.string(),
    name: z.string(),
    legal_name: z.string().nullable().optional(),
  }),
  brand: brandSchema,
  terms: termsSchema,
  contract_template: contractSchema,
  platforms: z.array(platformSchema),
  tiers: z.array(tierSchema),
  option_groups: z.array(groupSchema),
  options: z.array(optionSchema),
})

type Feed = z.infer<typeof feedSchema>

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

interface Counts {
  platforms: { upserted: number; deactivated: number }
  tiers: { upserted: number; deactivated: number }
  option_groups: { upserted: number; deactivated: number }
  options: { upserted: number; deactivated: number }
  contract_template: { new_version: boolean }
}

async function loadFixture(name: string): Promise<unknown> {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fixture ${name} missing`)
  return await res.json()
}

async function hashString(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  let builderId: string | null = null
  let runId: string | null = null

  try {
    const body = await req.json()
    builderId = body?.builder_id
    const useFixture = body?.use_fixture as string | undefined
    const inlinePayload = body?.payload

    if (!builderId) throw new Error('builder_id is required')

    const builderRes = await admin.from('builders').select('*').eq('id', builderId).single()
    if (builderRes.error) throw builderRes.error
    const builder = builderRes.data as any

    if (builder.catalog_source !== 'connect' && builder.catalog_source !== 'shopify') {
      throw new Error(`Builder ${builder.slug} is ${builder.catalog_source}, not a synced source.`)
    }

    // Open a sync_runs row in `running` state so the UI shows live state.
    const runIns = await admin.from('sync_runs').insert({
      builder_id: builderId,
      status: 'running',
    }).select('id').single()
    if (runIns.error) throw runIns.error
    runId = (runIns.data as any).id

    // ────────────────────────────────────────────────────────────
    // Shopify branch — no feed JSON; walks /pages/models-range +
    // /collections/<slug>/products.json. Brand / terms / contract
    // stay manual (not touched by this sync).
    // ────────────────────────────────────────────────────────────
    if (builder.catalog_source === 'shopify') {
      const shopifyCounts = await syncShopify(admin, builder)
      const nowIso = new Date().toISOString()
      await admin.from('sync_runs').update({
        status: 'success',
        finished_at: nowIso,
        counts: shopifyCounts,
      }).eq('id', runId!)
      await admin.from('builders').update({
        last_synced_at: nowIso,
        last_sync_status: 'success',
        last_sync_error: null,
      }).eq('id', builderId)
      return new Response(JSON.stringify({ ok: true, counts: shopifyCounts, run_id: runId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ────────────────────────────────────────────────────────────
    // Load the feed
    // ────────────────────────────────────────────────────────────
    let raw: unknown
    if (inlinePayload) {
      raw = inlinePayload
    } else if (useFixture) {
      raw = await loadFixture(useFixture)
    } else {
      if (!builder.catalog_source_url) throw new Error('builder.catalog_source_url is not set')
      const headers: Record<string, string> = { 'Accept': 'application/json' }
      if (builder.catalog_source_token) {
        headers['Authorization'] = `Bearer ${builder.catalog_source_token}`
      }
      const r = await fetch(builder.catalog_source_url, { headers })
      if (!r.ok) throw new Error(`feed responded ${r.status}: ${(await r.text()).slice(0, 400)}`)
      raw = await r.json()
    }

    const parsed = feedSchema.safeParse(raw)
    if (!parsed.success) throw new Error('feed schema validation: ' + parsed.error.message.slice(0, 500))
    const feed: Feed = parsed.data

    const counts: Counts = {
      platforms:     { upserted: 0, deactivated: 0 },
      tiers:         { upserted: 0, deactivated: 0 },
      option_groups: { upserted: 0, deactivated: 0 },
      options:       { upserted: 0, deactivated: 0 },
      contract_template: { new_version: false },
    }

    // ────────────────────────────────────────────────────────────
    // Brand
    // ────────────────────────────────────────────────────────────
    {
      const payload = {
        builder_id: builderId,
        logo_url: feed.brand.logo_url ?? null,
        wordmark_text: feed.brand.wordmark_text ?? feed.builder.name,
        color_accent: feed.brand.color_accent,
        color_bg: feed.brand.color_bg,
        color_text: feed.brand.color_text,
        font_display: feed.brand.font_display,
        font_body: feed.brand.font_body,
        tagline: feed.brand.tagline ?? null,
        hero_copy: feed.brand.hero_copy ?? null,
        process_copy: feed.brand.process_copy,
        custom_domain: feed.brand.custom_domain ?? null,
        enquire_url: feed.brand.enquire_url ?? 'https://humblehouseauto.com',
        synced: true,
        external_id: feed.brand.external_id,
      }
      const { error } = await admin.from('builder_brand').upsert(payload, { onConflict: 'builder_id' })
      if (error) throw error
    }

    // ────────────────────────────────────────────────────────────
    // Terms
    // ────────────────────────────────────────────────────────────
    {
      const payload = {
        builder_id: builderId,
        reservation_cents: feed.terms.reservation_cents,
        payment_schedule: feed.terms.payment_schedule,
        warranty_text: feed.terms.warranty_text ?? null,
        governing_law: feed.terms.governing_law ?? null,
        lead_time_copy: feed.terms.lead_time_copy ?? null,
        currency: feed.terms.currency,
        quote_validity_days: feed.terms.quote_validity_days,
        quote_intro_copy: feed.terms.quote_intro_copy ?? null,
        brochure_url: feed.terms.brochure_url ?? null,
        payment_mode: feed.terms.payment_mode,
        option_mode: feed.terms.option_mode,
        synced: true,
        external_id: feed.terms.external_id,
      }
      const { error } = await admin.from('builder_terms').upsert(payload, { onConflict: 'builder_id' })
      if (error) throw error
    }

    // ────────────────────────────────────────────────────────────
    // Contract template: new version only if body hash changes.
    // ────────────────────────────────────────────────────────────
    {
      const current = await admin
        .from('contract_templates')
        .select('id, version, body_markdown, title')
        .eq('builder_id', builderId)
        .eq('is_current', true)
        .maybeSingle()

      const incomingHash = await hashString(feed.contract_template.body_markdown + '|' + feed.contract_template.title)
      const currentHash = current.data
        ? await hashString((current.data as any).body_markdown + '|' + (current.data as any).title)
        : null

      if (!current.data || incomingHash !== currentHash) {
        if (current.data) {
          await admin.from('contract_templates').update({ is_current: false }).eq('id', (current.data as any).id)
        }
        const nextVersion = (current.data?.version ?? 0) + 1
        const ins = await admin.from('contract_templates').insert({
          builder_id: builderId,
          version: nextVersion,
          title: feed.contract_template.title,
          body_markdown: feed.contract_template.body_markdown,
          merge_fields: [
            'builder_name', 'builder_legal_name', 'customer_full_name', 'customer_address',
            'vehicle_platform', 'vehicle_vin', 'vehicle_year', 'configuration_table',
            'price_total', 'payment_schedule_table', 'warranty_text', 'governing_law',
          ],
          is_current: true,
          synced: true,
          external_id: feed.contract_template.external_id,
        })
        if (ins.error) throw ins.error
        counts.contract_template.new_version = true
      }
    }

    // ────────────────────────────────────────────────────────────
    // Platforms
    // ────────────────────────────────────────────────────────────
    const platformIdByExternal = new Map<string, string>()
    {
      const incomingExternalIds = feed.platforms.map(p => p.external_id)
      for (const p of feed.platforms) {
        const ins = await admin.from('catalog_platforms').upsert({
          builder_id: builderId,
          slug: p.slug,
          name: p.name,
          chassis: p.chassis,
          years: p.years,
          hero_image_url: p.hero_image_url ?? null,
          sort: p.sort,
          active: p.active,
          synced: true,
          external_id: p.external_id,
        }, { onConflict: 'builder_id,external_id' }).select('id, external_id').single()
        if (ins.error) throw ins.error
        platformIdByExternal.set(p.external_id, (ins.data as any).id)
        counts.platforms.upserted += 1
      }
      // Deactivate missing
      const missing = await admin.from('catalog_platforms')
        .update({ active: false })
        .eq('builder_id', builderId)
        .eq('synced', true)
        .eq('active', true)
        .not('external_id', 'in', `(${incomingExternalIds.map(id => `"${id}"`).join(',') || '""'})`)
        .select('id')
      counts.platforms.deactivated = (missing.data?.length ?? 0)
    }

    // ────────────────────────────────────────────────────────────
    // Tiers
    // ────────────────────────────────────────────────────────────
    const tierIdByExternal = new Map<string, string>()
    {
      const incomingExternalIds = feed.tiers.map(t => t.external_id)
      for (const t of feed.tiers) {
        const ins = await admin.from('catalog_tiers').upsert({
          builder_id: builderId,
          slug: t.slug,
          name: t.name,
          base_price_cents: t.base_price_cents ?? null,
          lead_time_weeks: t.lead_time_weeks ?? null,
          description: t.description ?? null,
          quote_only: t.quote_only,
          active: t.active,
          sort: t.sort,
          synced: true,
          external_id: t.external_id,
        }, { onConflict: 'builder_id,external_id' }).select('id, external_id').single()
        if (ins.error) throw ins.error
        tierIdByExternal.set(t.external_id, (ins.data as any).id)
        counts.tiers.upserted += 1
      }
      const missing = await admin.from('catalog_tiers')
        .update({ active: false })
        .eq('builder_id', builderId)
        .eq('synced', true)
        .eq('active', true)
        .not('external_id', 'in', `(${incomingExternalIds.map(id => `"${id}"`).join(',') || '""'})`)
        .select('id')
      counts.tiers.deactivated = (missing.data?.length ?? 0)
    }

    // ────────────────────────────────────────────────────────────
    // Option groups
    // ────────────────────────────────────────────────────────────
    const groupIdByExternal = new Map<string, string>()
    {
      const incomingExternalIds = feed.option_groups.map(g => g.external_id)
      for (const g of feed.option_groups) {
        const platformId = g.platform_external_id
          ? (platformIdByExternal.get(g.platform_external_id) ?? null)
          : null
        const ins = await admin.from('catalog_option_groups').upsert({
          builder_id: builderId,
          slug: g.slug,
          name: g.name,
          selection: g.selection,
          required: g.required,
          sort: g.sort,
          platform_id: platformId,
          synced: true,
          external_id: g.external_id,
        }, { onConflict: 'builder_id,external_id' }).select('id, external_id').single()
        if (ins.error) throw ins.error
        groupIdByExternal.set(g.external_id, (ins.data as any).id)
        counts.option_groups.upserted += 1
      }
      await admin.from('catalog_option_groups')
        .delete()
        .eq('builder_id', builderId)
        .eq('synced', true)
        .not('external_id', 'in', `(${incomingExternalIds.map(id => `"${id}"`).join(',') || '""'})`)
      // Groups don't have an `active` flag; absent groups are deleted. Only safe
      // because synced=true rows are owned by the sync.
    }

    // ────────────────────────────────────────────────────────────
    // Options + option-platforms
    // ────────────────────────────────────────────────────────────
    {
      const incomingExternalIds = feed.options.map(o => o.external_id)
      for (const o of feed.options) {
        const groupId = groupIdByExternal.get(o.group_external_id)
        if (!groupId) continue
        const includedTierIds = o.included_in_tier_external_ids
          .map(xid => tierIdByExternal.get(xid))
          .filter((v): v is string => Boolean(v))

        const ins = await admin.from('catalog_options').upsert({
          builder_id: builderId,
          group_id: groupId,
          slug: o.slug,
          name: o.name,
          code: o.code ?? null,
          price_cents: o.price_cents,
          included_in_tier_ids: includedTierIds,
          swatch_image_url: o.swatch_image_url ?? null,
          sort: o.sort,
          active: o.active,
          synced: true,
          external_id: o.external_id,
        }, { onConflict: 'builder_id,external_id' }).select('id, external_id').single()
        if (ins.error) throw ins.error
        const optionId = (ins.data as any).id as string

        // Replace option-platform join rows for this option
        await admin.from('catalog_option_platforms').delete().eq('option_id', optionId)
        if (o.platform_external_ids.length > 0) {
          const rows = o.platform_external_ids
            .map(xid => platformIdByExternal.get(xid))
            .filter((v): v is string => Boolean(v))
            .map(pid => ({ option_id: optionId, platform_id: pid }))
          if (rows.length > 0) {
            const pins = await admin.from('catalog_option_platforms').insert(rows)
            if (pins.error) throw pins.error
          }
        }
        counts.options.upserted += 1
      }
      const missing = await admin.from('catalog_options')
        .update({ active: false })
        .eq('builder_id', builderId)
        .eq('synced', true)
        .eq('active', true)
        .not('external_id', 'in', `(${incomingExternalIds.map(id => `"${id}"`).join(',') || '""'})`)
        .select('id')
      counts.options.deactivated = (missing.data?.length ?? 0)
    }

    // ────────────────────────────────────────────────────────────
    // Finish — mark run, activate builder on first successful sync.
    // ────────────────────────────────────────────────────────────
    const nowIso = new Date().toISOString()
    await admin.from('sync_runs').update({
      status: 'success',
      finished_at: nowIso,
      counts,
    }).eq('id', runId!)

    await admin.from('builders').update({
      last_synced_at: nowIso,
      last_sync_status: 'success',
      last_sync_error: null,
      ...(builder.active ? {} : { active: true }),
    }).eq('id', builderId)

    return new Response(JSON.stringify({ ok: true, counts, run_id: runId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const err = (e as Error).message
    try {
      if (runId) {
        await admin.from('sync_runs').update({
          status: 'error',
          finished_at: new Date().toISOString(),
          error: err,
        }).eq('id', runId)
      }
      if (builderId) {
        await admin.from('builders').update({
          last_sync_status: 'error',
          last_sync_error: err,
        }).eq('id', builderId)
      }
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: err }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ──────────────────────────────────────────────────────────────────
// Shopify sync
//
// Discovery lives in /pages/models-range. Each vehicle sits in a
//   <div class="product-item_container model-item">
// block with
//   <h4 class="shop-title">…</h4>  (model name)
//   <h5>DESIGNED TO FIT YEAR …</h5>  (year range)
//   <a class="con-btn" href="/collections/…">EXTERIOR PARTS</a>  (×N)
// We group collections into platforms by the h4 heading and into
// exterior / interior / alloy-wheels groups by the anchor text,
// not by slug. Many of Chelsea's hrefs are Shopify URL aliases that
// 301 to a different canonical collection; the canonical handle is
// read from <link rel="canonical"> and products.json is fetched on
// *that* handle so we don't hit the empty alias.
// ──────────────────────────────────────────────────────────────────

interface ShopifyProductVariant {
  id: number
  title: string
  sku: string | null
  price: string
  available: boolean
}
interface ShopifyProductImage { src: string }
interface ShopifyProduct {
  handle: string
  title: string
  variants: ShopifyProductVariant[]
  images: ShopifyProductImage[]
}

const SHOPIFY_CATEGORIES = ['exterior', 'interior', 'alloy-wheels'] as const
type ShopifyCategory = typeof SHOPIFY_CATEGORIES[number]
const UA = 'Mozilla/5.0 (compatible; HumbleHouseSync/1.0)'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Fetch with throttling + exponential backoff on 429. */
async function shopifyFetch(url: string, maxRetries = 5): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
    if (r.status !== 429) return r
    // Shopify may send Retry-After; otherwise exponential backoff 1,2,4,8,16s.
    const retryAfter = Number(r.headers.get('Retry-After')) || Math.pow(2, attempt)
    await sleep(retryAfter * 1000)
  }
  return fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** "DESIGNED TO FIT YEAR 2020 ONWARDS" → "2020-onwards"; empty if none. */
function yearSlug(text: string): string {
  if (!text) return ''
  const stripped = text.replace(/designed\s+to\s+fit\s+year/i, '').trim()
  return slugify(stripped)
}

/** "DESIGNED TO FIT YEAR 2020 ONWARDS" → "2020–present"; ""s untouched. */
function yearsDisplay(text: string): string {
  if (!text) return '—'
  const t = text.replace(/designed\s+to\s+fit\s+year/i, '').trim()
  // Normalize ONWARDS/PRESENT to "present"
  return t.replace(/\s+ONWARDS/i, '–present').replace(/\s+PRESENT/i, '–present').replace(/\s*-\s*/g, '–')
}

/** Canonical casing for vehicle makes. Only the make is rewritten;
 *  the rest of the heading (model name, trim text) is left as-is so
 *  tokens like "JL" or "G350/400" aren't lower-cased. */
const MAKE_CANONICAL: ReadonlyArray<[RegExp, string]> = [
  [/^MERCEDES-BENZ\b/i,  'Mercedes-Benz'],
  [/^MERCEDES\b/i,       'Mercedes'],
  [/^LAND\s+ROVER\b/i,   'Land Rover'],
  [/^RANGE\s+ROVER\b/i,  'Range Rover'],
  [/^INEOS\b/i,          'Ineos'],
  [/^JEEP\b/i,           'Jeep'],
  [/^TOYOTA\b/i,         'Toyota'],
  [/^FORD\b/i,           'Ford'],
  [/^BMW\b/i,            'BMW'],
]

function normalizeMake(name: string): string {
  for (const [re, canonical] of MAKE_CANONICAL) {
    if (re.test(name)) return name.replace(re, canonical)
  }
  return name
}

function anchorTextToCategory(text: string): ShopifyCategory | null {
  const up = text.toUpperCase()
  if (up.includes('EXTERIOR')) return 'exterior'
  if (up.includes('INTERIOR')) return 'interior'
  if (up.includes('ALLOY') || up.includes('WHEEL')) return 'alloy-wheels'
  return null
}

interface DiscoveredVehicle {
  name: string
  years: string          // display
  slug: string           // slugified name + years for stable platform id
  hrefs: Partial<Record<ShopifyCategory, string>>
}

function discoverVehiclesFromModels(html: string): DiscoveredVehicle[] {
  // Split on the vehicle block marker. The first chunk is the page header; drop it.
  const parts = html.split(/<div\s+class="product-item_container\s+model-item"/i).slice(1)
  const out: DiscoveredVehicle[] = []
  for (const part of parts) {
    // The block technically extends until the next product-item_container, but
    // because we already split, each `part` begins at one vehicle and ends
    // where the splitter cut it. The content of interest (heading + buttons)
    // sits at the top of the part.
    const h4 = /<h4[^>]*class="shop-title"[^>]*>([\s\S]*?)<\/h4>/i.exec(part)
    if (!h4) continue
    const rawName = stripTags(h4[1])
    const name = normalizeMake(rawName)
    if (!name) continue
    const h5 = /<h5[^>]*>([\s\S]*?)<\/h5>/i.exec(part)
    const yearsRaw = h5 ? stripTags(h5[1]) : ''

    const hrefs: Partial<Record<ShopifyCategory, string>> = {}
    const anchorRe = /<a[^>]*class="con-btn"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let m: RegExpExecArray | null
    while ((m = anchorRe.exec(part)) !== null) {
      const href = m[1]
      if (!href.startsWith('/collections/')) continue
      const label = stripTags(m[2])
      const cat = anchorTextToCategory(label)
      if (!cat) continue
      if (!hrefs[cat]) hrefs[cat] = href
    }

    if (Object.keys(hrefs).length === 0) continue
    const slug = slugify(`${name}-${yearSlug(yearsRaw)}`)
    out.push({ name, years: yearsDisplay(yearsRaw), slug, hrefs })
  }
  return out
}

async function resolveCanonicalCollection(baseUrl: string, href: string): Promise<string | null> {
  const url = href.startsWith('http') ? href : `${baseUrl}${href}`
  const r = await shopifyFetch(url)
  if (!r.ok) return null
  const html = await r.text()
  const canonMatch = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)
  const canonicalUrl = canonMatch ? canonMatch[1] : r.url
  const match = /\/collections\/([a-z0-9][a-z0-9-]*)/i.exec(canonicalUrl)
  return match ? match[1] : null
}

async function syncShopify(admin: ReturnType<typeof createClient>, builder: any) {
  // Rows upserted during this run are stamped with updated_at >
  // syncStartedAt; anything synced+active that wasn't touched is stale.
  const syncStartedAt = new Date().toISOString()

  const baseUrl = (builder.catalog_source_url || '').replace(/\/$/, '')
  if (!baseUrl) throw new Error('builder.catalog_source_url is not set')

  // ─── Models range → vehicle structure ──────────────────────────────
  const pageRes = await shopifyFetch(`${baseUrl}/pages/models-range`)
  if (!pageRes.ok) throw new Error(`models-range HTTP ${pageRes.status}`)
  const html = await pageRes.text()
  const vehicles = discoverVehiclesFromModels(html)

  // ─── Pricing multipliers from builder_terms ────────────────────────
  const termsRes = await admin.from('builder_terms')
    .select('fx_rate, kit_markup')
    .eq('builder_id', builder.id)
    .single()
  if (termsRes.error) throw termsRes.error
  const fx = Number((termsRes.data as any).fx_rate ?? 1)
  const markup = Number((termsRes.data as any).kit_markup ?? 1)

  // ─── Upsert three shared option groups ─────────────────────────────
  const groupMeta: Record<ShopifyCategory, { slug: string; name: string; sort: number }> = {
    exterior: { slug: 'shopify-exterior', name: 'Exterior', sort: 10 },
    interior: { slug: 'shopify-interior', name: 'Interior', sort: 20 },
    'alloy-wheels': { slug: 'shopify-alloy-wheels', name: 'Alloy wheels', sort: 30 },
  }
  const groupIdByCat = new Map<ShopifyCategory, string>()
  for (const cat of SHOPIFY_CATEGORIES) {
    const meta = groupMeta[cat]
    const ins = await admin.from('catalog_option_groups').upsert({
      builder_id: builder.id,
      slug: meta.slug,
      name: meta.name,
      selection: 'multi',
      required: false,
      platform_id: null,
      sort: meta.sort,
      active: true,
      synced: true,
      external_id: `shopify:group:${cat}`,
    }, { onConflict: 'builder_id,external_id' }).select('id').single()
    if (ins.error) throw ins.error
    groupIdByCat.set(cat, (ins.data as any).id)
  }

  // ─── Resolve canonicals + build platform set ───────────────────────
  interface ResolvedVehicle {
    vehicle: DiscoveredVehicle
    canonicals: Partial<Record<ShopifyCategory, string>>
  }
  const resolved: ResolvedVehicle[] = []
  for (const v of vehicles) {
    const canonicals: Partial<Record<ShopifyCategory, string>> = {}
    for (const cat of SHOPIFY_CATEGORIES) {
      const href = v.hrefs[cat]
      if (!href) continue
      const canonical = await resolveCanonicalCollection(baseUrl, href)
      if (canonical) canonicals[cat] = canonical
    }
    if (Object.keys(canonicals).length > 0) resolved.push({ vehicle: v, canonicals })
  }

  // ─── Upsert platforms ──────────────────────────────────────────────
  const platformIdByVehicle = new Map<string, string>()  // v.slug → id
  const seenPlatformExternalIds = new Set<string>()
  for (const { vehicle } of resolved) {
    const externalId = `shopify:platform:${vehicle.slug}`
    const ins = await admin.from('catalog_platforms').upsert({
      builder_id: builder.id,
      slug: vehicle.slug,
      name: vehicle.name,
      chassis: vehicle.slug,
      years: vehicle.years,
      sort: 0,
      active: true,
      synced: true,
      external_id: externalId,
    }, { onConflict: 'builder_id,external_id' }).select('id').single()
    if (ins.error) throw ins.error
    platformIdByVehicle.set(vehicle.slug, (ins.data as any).id)
    seenPlatformExternalIds.add(externalId)
  }

  // ─── Walk every (vehicle, category) collection and dedupe products ─
  //
  // A single product (one SKU / one Shopify handle) frequently sits in
  // several vehicle collections — e.g. a wheel fits all three Defenders.
  // We keep ONE catalog_options row per Shopify product and link it to
  // every platform it belongs to via catalog_option_platforms. Group
  // priority is alloy-wheels > interior > exterior so a wheel that
  // appears in both an exterior and an alloy-wheels collection ends up
  // under Alloy wheels.
  const CATEGORY_PRIORITY: Record<ShopifyCategory, number> = {
    exterior: 0,
    interior: 1,
    'alloy-wheels': 2,
  }
  interface CollectedOption {
    external_id: string
    slug: string
    name: string
    code: string | null
    kit_sku: string | null
    price_cents: number
    swatch_image_url: string | null
    active: boolean
    group_id: string
    group_priority: number
    platform_ids: Set<string>
  }
  const byExternalId = new Map<string, CollectedOption>()
  const perPlatform: Record<string, { options: number }> = {}
  let totalVariantsSplit = 0

  for (const { vehicle, canonicals } of resolved) {
    perPlatform[vehicle.slug] = { options: 0 }
    const platformId = platformIdByVehicle.get(vehicle.slug)!

    for (const cat of SHOPIFY_CATEGORIES) {
      const canonicalSlug = canonicals[cat]
      if (!canonicalSlug) continue
      const groupId = groupIdByCat.get(cat)!

      let page = 1
      while (page <= 10) {
        const url = `${baseUrl}/collections/${canonicalSlug}/products.json?limit=250&page=${page}`
        await sleep(100)
        const r = await shopifyFetch(url)
        if (!r.ok) {
          if (r.status === 404) break
          throw new Error(`${url} HTTP ${r.status}`)
        }
        const body = await r.json() as { products: ShopifyProduct[] }
        const products = body.products ?? []
        if (products.length === 0) break

        for (const product of products) {
          const variants = product.variants ?? []
          if (variants.length === 0) continue
          const isMulti = variants.length > 1
          if (isMulti) totalVariantsSplit += variants.length

          for (const variant of variants) {
            const suffix = isMulti ? `-${variant.id}` : ''
            // external_id does NOT include the vehicle — one row per
            // (product.handle, variant.id), shared across platforms.
            const externalId = `shopify:option:${product.handle}${suffix}`
            const slug = slugify(`shopify-${product.handle}${suffix}`)
            const name = isMulti ? `${product.title} — ${variant.title}` : product.title
            const priceGbp = Number(variant.price ?? 0)
            const priceCents = Math.round(priceGbp * fx * markup * 100)
            const image = (product.images ?? [])[0]?.src ?? null
            const sku = variant.sku && variant.sku.trim() ? variant.sku.trim() : null
            // Shopify "360° Tour" interior listings have no SKU and a
            // zero price — syncing them active would spam the editor
            // with "Set a price" warnings. Honour available + priced + skued.
            const active = Boolean(variant.available) && priceCents > 0 && Boolean(sku)
            const priority = CATEGORY_PRIORITY[cat]

            const existing = byExternalId.get(externalId)
            if (!existing || priority > existing.group_priority) {
              byExternalId.set(externalId, {
                external_id: externalId,
                slug,
                name,
                code: sku,
                kit_sku: sku,
                price_cents: priceCents,
                swatch_image_url: image,
                active,
                group_id: groupId,
                group_priority: priority,
                platform_ids: new Set<string>(existing?.platform_ids ?? []),
              })
            }
            byExternalId.get(externalId)!.platform_ids.add(platformId)
            perPlatform[vehicle.slug].options += 1
          }
        }
        if (products.length < 250) break
        page += 1
      }
    }
  }

  // ─── Disambiguate shared titles ────────────────────────────────────
  // Some Shopify stores publish several products with identical `title`
  // but different handles (e.g. the same wheel style in 20"/22"/23", or
  // duplicate listings with a trailing "-1"). For each title-collision
  // group, strip the longest common prefix/suffix across the handles
  // and append whatever's left to each name so operators can tell them
  // apart in the configurator.
  function commonPrefix(parts: string[][]): number {
    if (parts.length === 0) return 0
    let p = 0
    while (p < parts[0].length && parts.every(a => a[p] === parts[0][p])) p++
    return p
  }
  function commonSuffix(parts: string[][], prefixLen: number): number {
    if (parts.length === 0) return 0
    let s = 0
    while (true) {
      const positions = parts.map(a => a.length - 1 - s)
      if (positions.some(pos => pos < prefixLen)) break
      const char = parts[0][positions[0]]
      if (!parts.every((a, i) => a[positions[i]] === char)) break
      s++
    }
    return s
  }
  const groupsByName = new Map<string, string[]>()
  for (const [extId, o] of byExternalId) {
    const arr = groupsByName.get(o.name) ?? []
    arr.push(extId)
    groupsByName.set(o.name, arr)
  }
  for (const [_name, extIds] of groupsByName) {
    if (extIds.length <= 1) continue
    const handles = extIds.map(e => e.replace(/^shopify:option:/, '').replace(/-\d+$/, ''))
    const partsList = handles.map(h => h.split('-'))
    const pre = commonPrefix(partsList)
    const suf = commonSuffix(partsList, pre)
    for (let i = 0; i < extIds.length; i++) {
      const middle = partsList[i].slice(pre, partsList[i].length - suf)
      let hint: string
      if (middle.length === 0) {
        // Handles are prefix/suffix identical — must differ by a numeric
        // tail stripped above (e.g. "-max" vs "-max-1"). Use the tail.
        const rawTail = extIds[i].match(/-(\d+)$/)?.[1]
        hint = rawTail ? `copy ${rawTail}` : `variant ${i + 1}`
      } else {
        // Title-case the differing tokens for readability.
        hint = middle.map(t => {
          const asNum = /^\d+$/.test(t) ? `${t}"` : null
          if (asNum) return asNum
          return t[0] ? t[0].toUpperCase() + t.slice(1) : t
        }).join(' ')
      }
      const existing = byExternalId.get(extIds[i])!
      existing.name = `${existing.name} (${hint})`
    }
  }

  // ─── Bulk upsert the deduped options (chunked for URL limits) ──────
  const allRows = Array.from(byExternalId.values()).map(o => ({
    builder_id: builder.id,
    group_id: o.group_id,
    slug: o.slug,
    name: o.name,
    code: o.code,
    kit_sku: o.kit_sku,
    price_cents: o.price_cents,
    included_in_tier_ids: [],
    swatch_image_url: o.swatch_image_url,
    sort: 0,
    active: o.active,
    synced: true,
    external_id: o.external_id,
  }))
  const upsertedIdByExternal = new Map<string, string>()
  const CHUNK = 100
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK)
    const ins = await admin.from('catalog_options')
      .upsert(chunk, { onConflict: 'builder_id,external_id' })
      .select('id, external_id')
    if (ins.error) throw ins.error
    for (const row of ins.data as unknown as { id: string; external_id: string }[]) {
      upsertedIdByExternal.set(row.external_id, row.id)
    }
  }

  // ─── Rebuild catalog_option_platforms links for the upserted set ───
  const allOptionIds = Array.from(upsertedIdByExternal.values())
  for (let i = 0; i < allOptionIds.length; i += CHUNK) {
    const chunk = allOptionIds.slice(i, i + CHUNK)
    const del = await admin.from('catalog_option_platforms').delete().in('option_id', chunk)
    if (del.error) throw del.error
  }
  const allLinks: { option_id: string; platform_id: string }[] = []
  for (const o of byExternalId.values()) {
    const optionId = upsertedIdByExternal.get(o.external_id)
    if (!optionId) continue
    for (const pid of o.platform_ids) allLinks.push({ option_id: optionId, platform_id: pid })
  }
  for (let i = 0; i < allLinks.length; i += CHUNK) {
    const chunk = allLinks.slice(i, i + CHUNK)
    const ins = await admin.from('catalog_option_platforms').insert(chunk)
    if (ins.error) throw ins.error
  }

  const totalUpserted = allRows.length

  // ─── Deactivate stale rows via updated_at (survives URL-length limits) ─
  // Anything synced + still-active that wasn't touched this run is stale.
  const platformsMissing = await admin.from('catalog_platforms')
    .update({ active: false })
    .eq('builder_id', builder.id)
    .eq('synced', true)
    .eq('active', true)
    .lt('updated_at', syncStartedAt)
    .select('id')

  const optionsMissing = await admin.from('catalog_options')
    .update({ active: false })
    .eq('builder_id', builder.id)
    .eq('synced', true)
    .eq('active', true)
    .lt('updated_at', syncStartedAt)
    .select('id')

  // Per-platform report: count UNIQUE options linked to each vehicle,
  // not raw hits across collections.
  const platformIdToVehicleLabel = new Map<string, string>()
  for (const { vehicle } of resolved) {
    platformIdToVehicleLabel.set(
      platformIdByVehicle.get(vehicle.slug)!,
      `${vehicle.name} (${vehicle.years})`
    )
  }
  const perPlatformNamed: Record<string, number> = {}
  for (const label of platformIdToVehicleLabel.values()) perPlatformNamed[label] = 0
  for (const o of byExternalId.values()) {
    if (!o.active) continue
    for (const pid of o.platform_ids) {
      const label = platformIdToVehicleLabel.get(pid)
      if (label) perPlatformNamed[label] += 1
    }
  }

  const inactiveZeroOrNoSku = allRows.filter(r => !r.active).length

  return {
    source: 'shopify',
    vehicles_discovered: vehicles.length,
    vehicles_with_canonical: resolved.length,
    platforms: resolved.length,
    option_groups: SHOPIFY_CATEGORIES.length,
    options: {
      unique_products: byExternalId.size,
      upserted: totalUpserted,
      deactivated: optionsMissing.data?.length ?? 0,
      inactive_zero_price_or_no_sku: inactiveZeroOrNoSku,
      variants_split: totalVariantsSplit,
    },
    platforms_deactivated: platformsMissing.data?.length ?? 0,
    per_platform: perPlatformNamed,
    fx_rate: fx,
    kit_markup: markup,
  }
}
