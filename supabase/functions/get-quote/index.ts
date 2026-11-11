// get-quote — Supabase Edge Function (Deno)
//
// Public: look up a quote by its random token (no login). Returns the
// quote with its options, builder brand, platform, tier, terms so the
// /q/:token page can render a branded read-only view. Also logs a
// `viewed` event the first time per quote per hour.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = (Deno.env.get('HH_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { token } = await req.json()
    if (!token) throw new Error('token is required')

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const qRes = await admin
      .from('quotes')
      .select(`
        id, version, price_cents, tax_cents, total_cents, status, notes, pdf_url, token,
        platform_id, created_at, approved_at,
        lead:leads(customer:customers(full_name, email)),
        builder:builders(id, name, legal_name, slug),
        platform:catalog_platforms(name, chassis, years),
        tier:catalog_tiers(name, base_price_cents, description)
      `)
      .eq('token', token)
      .maybeSingle()
    if (qRes.error) throw qRes.error
    if (!qRes.data) throw new Error('Quote not found')
    const quote = qRes.data as any

    // quote_options snapshot columns (parts_sell_cents / labour_cents /
    // materials_cents / price_cents_at_selection) are what the quote
    // was priced on at save time. The /q page renders FROM these, not
    // from the live catalog columns — otherwise a mid-quote catalog
    // sync drifts the line totals away from the subtotal.
    const [brandRes, termsRes, qoRes, platsRes] = await Promise.all([
      admin.from('builder_brand').select('wordmark_text, logo_url, tagline, color_accent, color_bg, color_text, font_display, font_body').eq('builder_id', quote.builder.id).maybeSingle(),
      admin.from('builder_terms').select('*').eq('builder_id', quote.builder.id).maybeSingle(),
      admin.from('quote_options').select(`
        option_id, price_cents_at_selection, quantity, finish_note,
        parts_sell_cents, labour_cents, materials_cents,
        catalog_options(name, code, kit_sku, group_id, sold_as_set),
        quote_option_finishes(finish_set_id, catalog_finish_sets(sort), catalog_finishes(name))
      `).eq('quote_id', quote.id),
      // Full platform-name list for the builder so the client can
      // strip vehicle decorations from option names the same way the
      // lookbook does (e.g. "Large Rear Roof Wing for Land Rover
      // Defender (2020 Onwards)" → "Large Rear Roof Wing").
      admin.from('catalog_platforms').select('name').eq('builder_id', quote.builder.id),
    ])
    if (qoRes.error) throw qoRes.error
    if (platsRes.error) throw platsRes.error

    // Filter stored quote_options by platform restriction so a renamed
    // or re-platformed catalog doesn't leak irrelevant rows into /q.
    const qoRows = (qoRes.data as any[]) ?? []
    const optionIds = qoRows.map(r => r.option_id)
    let visibleQuoteOptions = qoRows
    if (optionIds.length > 0) {
      const platsRes = await admin
        .from('catalog_option_platforms')
        .select('option_id, platform_id')
        .in('option_id', optionIds)
      if (platsRes.error) throw platsRes.error
      const restricted = new Map<string, Set<string>>()
      for (const r of platsRes.data ?? []) {
        if (!restricted.has(r.option_id)) restricted.set(r.option_id, new Set())
        restricted.get(r.option_id)!.add(r.platform_id)
      }
      visibleQuoteOptions = qoRows.filter(r => {
        const s = restricted.get(r.option_id)
        return !s || s.size === 0 || s.has(quote.platform_id)
      })
    }

    // Log a viewed event (best-effort; dedupe per hour)
    try {
      const hourAgo = new Date(Date.now() - 3600_000).toISOString()
      const recent = await admin
        .from('quote_events')
        .select('id')
        .eq('quote_id', quote.id)
        .eq('kind', 'viewed')
        .gte('created_at', hourAgo)
        .limit(1)
      if (!(recent.data?.length)) {
        await admin.from('quote_events').insert({ quote_id: quote.id, kind: 'viewed' })
      }
    } catch (_) { /* ignore */ }

    const builderPlatformNames = ((platsRes.data ?? []) as Array<{ name: string }>)
      .map(r => r.name).filter(Boolean)

    return new Response(JSON.stringify({
      quote,
      brand: brandRes.data,
      terms: termsRes.data,
      quote_options: visibleQuoteOptions,
      builder_platform_names: builderPlatformNames,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
