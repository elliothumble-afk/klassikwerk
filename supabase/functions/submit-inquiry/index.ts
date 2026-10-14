// submit-inquiry — Supabase Edge Function (Deno)
//
// Public form submission: upserts customer by email, creates a `leads`
// row at stage `inquiry` tied to a builder, emails Humble House (via
// Resend) a short alert. No JWT required.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
const HH_INBOX = Deno.env.get('HH_INBOX_EMAIL') ?? 'elliot.humble@gmail.com'
const FROM_ADDRESS = Deno.env.get('RESEND_FROM') ?? 'leads@humblehouse.dev'

interface Payload {
  builder_id: string
  builder_slug: string
  name: string
  email: string
  phone: string
  platform_id: string | null
  message: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const p = await req.json() as Payload
    if (!p.builder_id) throw new Error('builder_id is required')
    if (!p.email) throw new Error('email is required')
    if (!p.name) throw new Error('name is required')

    const email = p.email.trim().toLowerCase()
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    const builderRes = await admin.from('builders').select('name').eq('id', p.builder_id).single()
    if (builderRes.error) throw builderRes.error

    const existing = await admin
      .from('customers')
      .select('id, full_name')
      .eq('email', email)
      .maybeSingle()
    if (existing.error) throw existing.error

    let customerId: string
    if (existing.data) {
      customerId = (existing.data as any).id
      if (!(existing.data as any).full_name && p.name) {
        await admin.from('customers').update({ full_name: p.name }).eq('id', customerId)
      }
    } else {
      const ins = await admin.from('customers').insert({
        email,
        full_name: p.name,
        source: 'web',
      }).select('id').single()
      if (ins.error) throw ins.error
      customerId = (ins.data as any).id
    }

    const leadIns = await admin.from('leads').insert({
      builder_id: p.builder_id,
      customer_id: customerId,
      source: 'site',
      stage: 'inquiry',
      platform_interest_id: p.platform_id,
      phone: p.phone || null,
      message: p.message || null,
    }).select('id').single()
    if (leadIns.error) throw leadIns.error
    const leadId = (leadIns.data as any).id

    // Fire-and-forget email to HH. Fail gracefully if RESEND_API_KEY is unset.
    if (RESEND_KEY) {
      const builderName = (builderRes.data as any).name as string
      const html = `
        <h3>New inquiry: ${builderName}</h3>
        <p><strong>${p.name}</strong> &lt;${email}&gt;${p.phone ? ` · ${p.phone}` : ''}</p>
        ${p.platform_id ? `<p>Platform of interest: ${p.platform_id}</p>` : ''}
        ${p.message ? `<p>${p.message.replace(/</g, '&lt;')}</p>` : ''}
        <p style="font-size:12px;color:#888">Lead id: ${leadId}</p>
      `
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_ADDRESS,
            to: [HH_INBOX],
            reply_to: email,
            subject: `New ${builderName} inquiry — ${p.name}`,
            html,
          }),
        })
      } catch (_) { /* swallow — the lead is already saved */ }
    }

    return new Response(JSON.stringify({ lead_id: leadId, ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
