// Daily FX refresh. Called by pg_cron (see README). For every builder
// with builder_terms.fx_auto = true and a Shopify catalog in GBP, we
// fetch GBP→USD from Frankfurter (free, no API key), update fx_rate
// and fx_last_updated_at, and reprice via the existing RPC. Builders
// with fx_auto = false are skipped — their fx_rate is pinned.
//
// Frankfurter: https://api.frankfurter.dev/v1/latest?from=GBP&to=USD

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, key)

  try {
    // Fetch the latest GBP→USD rate.
    const r = await fetch('https://api.frankfurter.dev/v1/latest?from=GBP&to=USD')
    if (!r.ok) throw new Error(`frankfurter ${r.status}`)
    const body = await r.json() as { date: string; rates: { USD?: number } }
    const rate = body.rates?.USD
    const asOf = body.date
    if (!rate || typeof rate !== 'number') throw new Error('no USD rate in response')

    // Target: cost_based builders with fx_auto = true. (simple-mode
    // builders don't use fx_rate for anything the customer sees.)
    const { data: targets, error: tErr } = await admin
      .from('builder_terms')
      .select('builder_id, fx_rate')
      .eq('fx_auto', true)
    if (tErr) throw tErr

    const updated: { builder_id: string; from: number | null; to: number }[] = []
    for (const t of (targets ?? []) as { builder_id: string; fx_rate: number }[]) {
      const upd = await admin
        .from('builder_terms')
        .update({ fx_rate: rate, fx_last_updated_at: new Date().toISOString() })
        .eq('builder_id', t.builder_id)
        .eq('fx_auto', true)  // re-check under write to avoid races
      if (upd.error) throw upd.error
      // Reprice so synced catalog_options.price_cents reflects the
      // new rate without waiting for the nightly sync.
      const rp = await admin.rpc('reprice_builder', { target_builder: t.builder_id })
      if (rp.error) throw rp.error
      updated.push({ builder_id: t.builder_id, from: t.fx_rate, to: rate })
    }

    return new Response(
      JSON.stringify({ ok: true, rate, as_of: asOf, updated: updated.length, updates: updated }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
