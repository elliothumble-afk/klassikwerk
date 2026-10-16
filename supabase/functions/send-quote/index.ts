// send-quote — Supabase Edge Function (Deno)
//
// Sends the quote PDF to the customer via Resend from a builder-branded
// template, logs quote_events.sent, moves the lead to `quoted`, and pushes
// to Zoho (fire-and-forget) if secrets are configured. Includes a tracked
// link to /q/:token with an Approve button.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_ADDRESS = Deno.env.get('RESEND_FROM') ?? 'quotes@humblehouse.dev'
const PUBLIC_SITE = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://klassikwerk.netlify.app'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { quote_id } = await req.json()
    if (!quote_id) throw new Error('quote_id is required')

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const qRes = await admin
      .from('quotes')
      .select('*, lead:leads(id, customer:customers(full_name, email)), builder:builders(name, legal_name, slug)')
      .eq('id', quote_id)
      .single()
    if (qRes.error) throw qRes.error
    const quote = qRes.data as any
    const customer = quote.lead?.customer
    const builder = quote.builder
    if (!customer?.email) throw new Error('Customer has no email')

    const brandRes = await admin.from('builder_brand').select('*').eq('builder_id', quote.builder_id).maybeSingle()
    const termsRes = await admin.from('builder_terms').select('brochure_url').eq('builder_id', quote.builder_id).maybeSingle()
    const brand = brandRes.data as any | null
    const brochureUrl = (termsRes.data as any)?.brochure_url ?? null

    const quoteLink = `${PUBLIC_SITE}/q/${quote.token}`
    const pdfLink = quote.pdf_url ?? quoteLink

    const html = `
      <div style="font-family:Helvetica,Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
        <h1 style="font-weight:400;font-size:22px;color:${brand?.color_accent ?? '#1C1C1A'}">
          ${brand?.wordmark_text ?? builder.name}
        </h1>
        <p>Hi ${customer.full_name ?? ''},</p>
        <p>Your ${builder.name} quote is ready. Review it at your convenience.</p>
        <p>
          <a href="${quoteLink}" style="display:inline-block;padding:10px 18px;background:${brand?.color_accent ?? '#1C1C1A'};color:#fff;text-decoration:none;border-radius:4px">Review quote</a>
        </p>
        <p style="font-size:13px;color:#666">
          Direct PDF: <a href="${pdfLink}">${pdfLink}</a>
          ${brochureUrl ? `<br/>Brochure: <a href="${brochureUrl}">${brochureUrl}</a>` : ''}
        </p>
        <p style="font-size:12px;color:#999">${builder.legal_name ?? builder.name}</p>
      </div>
    `

    if (!RESEND_KEY) {
      // Still mark as sent locally so the flow progresses in dev previews.
      await admin.from('quotes').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', quote.id)
      await admin.from('quote_events').insert({ quote_id: quote.id, kind: 'sent', note: 'RESEND_API_KEY not set — no email delivered' })
      await admin.from('leads').update({ stage: 'quoted' }).eq('id', quote.lead_id)
      return new Response(JSON.stringify({ ok: true, demo: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [customer.email],
        subject: `${builder.name} — Quote v${quote.version}`,
        html,
      }),
    })
    const resp = await r.json()
    if (!r.ok) throw new Error(resp?.message ?? 'Resend error')

    await admin.from('quotes').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', quote.id)
    await admin.from('quote_events').insert({ quote_id: quote.id, kind: 'sent', note: resp?.id ? `resend_id=${resp.id}` : null })
    await admin.from('leads').update({ stage: 'quoted' }).eq('id', quote.lead_id)

    // Fire-and-forget Zoho push
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/zoho-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ kind: 'quote_sent', quote_id }),
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
