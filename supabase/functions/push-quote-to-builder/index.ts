// push-quote-to-builder — Supabase Edge Function (Deno)
//
// POSTs an approved quote's spec to the builder's lead_intake_url so
// their CRM can pick it up. Logs every attempt (success or error) to
// builder_push_log; a Retry button on the quote page can re-invoke
// this function.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  try {
    const { quote_id } = await req.json()
    if (!quote_id) throw new Error('quote_id is required')

    const qRes = await admin
      .from('quotes')
      .select(`
        id, version, price_cents, pdf_url, notes, token, status,
        lead:leads(id, zoho_lead_id, customer:customers(full_name, email, zoho_contact_id)),
        builder:builders(id, slug, lead_intake_url, catalog_source_token)
      `)
      .eq('id', quote_id)
      .single()
    if (qRes.error) throw qRes.error
    const quote = qRes.data as any
    const builder = quote.builder
    if (!builder?.lead_intake_url) {
      await admin.from('builder_push_log').insert({
        builder_id: builder?.id ?? null,
        quote_id: quote.id,
        kind: 'quote_approved',
        payload: {},
        status: 'error',
        error: 'Builder has no lead_intake_url — skipping push.',
      })
      return new Response(JSON.stringify({ ok: false, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const [platformRes, tierRes, qoRes] = await Promise.all([
      admin.from('catalog_platforms').select('slug, external_id, name').eq('id', (await admin.from('quotes').select('platform_id').eq('id', quote.id).single()).data!.platform_id).single(),
      admin.from('catalog_tiers').select('slug, external_id, name').eq('id', (await admin.from('quotes').select('tier_id').eq('id', quote.id).single()).data!.tier_id).single(),
      admin.from('quote_options').select('option_id, price_cents_at_selection, quantity, finish_note, catalog_options(slug, external_id, name, sold_as_set), quote_option_finishes(finish_set_id, catalog_finish_sets(name, sort), catalog_finishes(name))').eq('quote_id', quote.id),
    ])
    if (platformRes.error) throw platformRes.error
    if (tierRes.error) throw tierRes.error
    if (qoRes.error) throw qoRes.error

    const payload = {
      source: 'humble-house',
      hh_quote_id: quote.id,
      hh_quote_version: quote.version,
      quote_token: quote.token,
      pdf_url: quote.pdf_url,
      status: quote.status,
      price_cents: quote.price_cents,
      notes: quote.notes,
      customer: quote.lead?.customer ?? null,
      zoho_lead_id: quote.lead?.zoho_lead_id ?? null,
      platform: {
        slug: (platformRes.data as any).slug,
        external_id: (platformRes.data as any).external_id,
        name: (platformRes.data as any).name,
      },
      tier: {
        slug: (tierRes.data as any).slug,
        external_id: (tierRes.data as any).external_id,
        name: (tierRes.data as any).name,
      },
      options: (qoRes.data ?? []).map((o: any) => {
        // Kit SKUs are already a set — one line, qty 1. Non-kit
        // wheels use the operator-selected qty (4 or 5).
        const soldAsSet = o.catalog_options?.sold_as_set ?? false
        const finishes = ((o.quote_option_finishes ?? []) as any[])
          .slice()
          .sort((a, b) => (a.catalog_finish_sets?.sort ?? 0) - (b.catalog_finish_sets?.sort ?? 0))
          .map(f => ({ set: f.catalog_finish_sets?.name ?? null, name: f.catalog_finishes?.name ?? null }))
          .filter(f => f.name)
        return {
          slug: o.catalog_options?.slug,
          external_id: o.catalog_options?.external_id,
          name: o.catalog_options?.name,
          price_cents_at_selection: o.price_cents_at_selection,
          qty: soldAsSet ? 1 : (o.quantity ?? 1),
          sold_as_set: soldAsSet,
          finishes,
          finish_note: o.finish_note ?? null,
        }
      }),
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (builder.catalog_source_token) {
      headers['Authorization'] = `Bearer ${builder.catalog_source_token}`
    }

    const r = await fetch(builder.lead_intake_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    const respText = await r.text()
    let respJson: unknown = null
    try { respJson = JSON.parse(respText) } catch { respJson = { raw: respText.slice(0, 2000) } }

    const status = r.ok ? 'success' : 'error'

    await admin.from('builder_push_log').insert({
      builder_id: builder.id,
      quote_id: quote.id,
      kind: 'quote_approved',
      payload,
      response: respJson as any,
      status,
      error: r.ok ? null : `builder responded ${r.status}`,
      http_status: r.status,
    })

    if (!r.ok) {
      return new Response(JSON.stringify({ error: `builder responded ${r.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = (e as Error).message
    try {
      await admin.from('builder_push_log').insert({
        builder_id: null,
        kind: 'quote_approved',
        payload: {},
        status: 'error',
        error: msg,
      } as any)
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
