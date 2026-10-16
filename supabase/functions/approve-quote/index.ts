// approve-quote — Supabase Edge Function (Deno)
//
// Public endpoint called from /q/:token. Flips the quote to approved,
// writes quote_events.approved, moves lead to approved (actually: brief
// says "on approve `contract_sent` is the next manual step" — so we stay
// at `quoted` with the quote marked approved; a human triggers the
// "Create contract" step from ops).

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { token } = await req.json()
    if (!token) throw new Error('token is required')

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const qRes = await admin.from('quotes').select('id, lead_id, status').eq('token', token).maybeSingle()
    if (qRes.error) throw qRes.error
    if (!qRes.data) throw new Error('Quote not found')
    const quote = qRes.data as any

    if (quote.status === 'approved') {
      return new Response(JSON.stringify({ ok: true, already: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const now = new Date().toISOString()
    await admin.from('quotes').update({ status: 'approved', approved_at: now }).eq('id', quote.id)
    await admin.from('quote_events').insert({ quote_id: quote.id, kind: 'approved', note: 'Approved via /q token link' })
    await admin.from('leads').update({ stage: 'quoted' }).eq('id', quote.lead_id)

    // Fire-and-forget Zoho push
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/zoho-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ kind: 'quote_approved', quote_id: quote.id }),
      })
    } catch (_) { /* ignore */ }

    // Fire-and-forget builder push for synced builders with a lead_intake_url
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/push-quote-to-builder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ quote_id: quote.id }),
      })
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
