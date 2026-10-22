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

function titleCase(slug: string): string {
  return slug.split('-').map(w => w[0] ? w[0].toUpperCase() + w.slice(1) : w).join(' ')
}
function yearsFromSlug(slug: string): string {
  const m = /(\d{4})-(?:(\d{4})|present)/.exec(slug)
  if (!m) return ''
  return `${m[1]}–${m[2] ?? 'present'}`
}

function classifyCollectionSlug(slug: string): { platform: string; category: ShopifyCategory } | null {
  for (const cat of SHOPIFY_CATEGORIES) {
    const re = new RegExp(`^(.*?)-${cat}(?:-|$)`)
    const m = re.exec(slug)
    if (m && m[1]) return { platform: m[1], category: cat }
  }
  return null
}

async function syncShopify(admin: ReturnType<typeof createClient>, builder: any) {
  const baseUrl = (builder.catalog_source_url || '').replace(/\/$/, '')
  if (!baseUrl) throw new Error('builder.catalog_source_url is not set')

  // ─── Discover platforms + collection URLs from /pages/models-range ─
  const pageRes = await fetch(`${baseUrl}/pages/models-range`, { headers: { 'User-Agent': UA } })
  if (!pageRes.ok) throw new Error(`models-range HTTP ${pageRes.status}`)
  const html = await pageRes.text()
  const linkMatches = html.matchAll(/href="\/collections\/([a-z0-9][a-z0-9-]*)"/g)
  const discovered = new Set<string>()
  for (const m of linkMatches) discovered.add(m[1])

  const platformsMap = new Map<string, Partial<Record<ShopifyCategory, string>>>()
  for (const slug of discovered) {
    const hit = classifyCollectionSlug(slug)
    if (!hit) continue
    if (!platformsMap.has(hit.platform)) platformsMap.set(hit.platform, {})
    platformsMap.get(hit.platform)![hit.category] = slug
  }
  // A platform must have at least two of the three categories to count —
  // this filters out false positives like `lightweight-alloy-wheels`.
  const validPlatforms = Array.from(platformsMap.entries())
    .filter(([_, cats]) => Object.keys(cats).length >= 2)
    .sort((a, b) => a[0].localeCompare(b[0]))

  // ─── Pricing multipliers from builder_terms ─────────────────────────
  const termsRes = await admin.from('builder_terms')
    .select('fx_rate, kit_markup')
    .eq('builder_id', builder.id)
    .single()
  if (termsRes.error) throw termsRes.error
  const fx = Number((termsRes.data as any).fx_rate ?? 1)
  const markup = Number((termsRes.data as any).kit_markup ?? 1)

  // ─── Upsert the 3 shared option groups ──────────────────────────────
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

  // ─── Upsert platforms ───────────────────────────────────────────────
  const platformIdBySlug = new Map<string, string>()
  for (const [platformSlug, _cats] of validPlatforms) {
    const ins = await admin.from('catalog_platforms').upsert({
      builder_id: builder.id,
      slug: platformSlug,
      name: titleCase(platformSlug),
      chassis: platformSlug,
      years: yearsFromSlug(platformSlug) || '—',
      sort: 0,
      active: true,
      synced: true,
      external_id: `shopify:platform:${platformSlug}`,
    }, { onConflict: 'builder_id,external_id' }).select('id').single()
    if (ins.error) throw ins.error
    platformIdBySlug.set(platformSlug, (ins.data as any).id)
  }

  // ─── Walk collections ───────────────────────────────────────────────
  const perPlatform: Record<string, { options: number }> = {}
  const seenOptionExternalIds = new Set<string>()
  let totalUpserted = 0
  let totalVariantsSplit = 0

  for (const [platformSlug, cats] of validPlatforms) {
    perPlatform[platformSlug] = { options: 0 }
    const platformId = platformIdBySlug.get(platformSlug)!

    for (const cat of SHOPIFY_CATEGORIES) {
      const collectionSlug = cats[cat]
      if (!collectionSlug) continue
      const groupId = groupIdByCat.get(cat)!

      let page = 1
      // Hard cap to protect runtime
      while (page <= 10) {
        const url = `${baseUrl}/collections/${collectionSlug}/products.json?limit=250&page=${page}`
        const r = await fetch(url, { headers: { 'User-Agent': UA } })
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
            const externalId = `shopify:option:${platformSlug}:${product.handle}${suffix}`
            const slug = `${platformSlug}-${product.handle}${suffix}`.slice(0, 200)
            const name = isMulti ? `${product.title} — ${variant.title}` : product.title
            const priceGbp = Number(variant.price ?? 0)
            const priceCents = Math.round(priceGbp * fx * markup * 100)
            const image = (product.images ?? [])[0]?.src ?? null

            const ins = await admin.from('catalog_options').upsert({
              builder_id: builder.id,
              group_id: groupId,
              slug,
              name,
              code: variant.sku ?? null,
              kit_sku: variant.sku ?? null,
              price_cents: priceCents,
              included_in_tier_ids: [],
              swatch_image_url: image,
              sort: 0,
              active: Boolean(variant.available),
              synced: true,
              external_id: externalId,
            }, { onConflict: 'builder_id,external_id' }).select('id').single()
            if (ins.error) throw ins.error
            const optionId = (ins.data as any).id as string
            seenOptionExternalIds.add(externalId)

            // Each option is restricted to one platform
            await admin.from('catalog_option_platforms').delete().eq('option_id', optionId)
            await admin.from('catalog_option_platforms').insert({
              option_id: optionId,
              platform_id: platformId,
            })
            perPlatform[platformSlug].options += 1
            totalUpserted += 1
          }
        }
        if (products.length < 250) break
        page += 1
      }
    }
  }

  // ─── Deactivate options missing from this run ───────────────────────
  const seenArr = Array.from(seenOptionExternalIds)
  const missing = await admin.from('catalog_options')
    .update({ active: false })
    .eq('builder_id', builder.id)
    .eq('synced', true)
    .eq('active', true)
    .not('external_id', 'in', `(${seenArr.map(id => `"${id}"`).join(',') || '""'})`)
    .select('id')

  return {
    source: 'shopify',
    discovered_slugs: discovered.size,
    platforms: validPlatforms.length,
    option_groups: SHOPIFY_CATEGORIES.length,
    options: {
      upserted: totalUpserted,
      deactivated: missing.data?.length ?? 0,
      variants_split: totalVariantsSplit,
    },
    per_platform: perPlatform,
    fx_rate: fx,
    kit_markup: markup,
  }
}
