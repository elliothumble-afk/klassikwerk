// send-po — Supabase Edge Function (Deno)
//
// Sends a purchase-order PDF to the supplier via Resend, logs
// sent_at + sent_to on the purchase_orders row, and flips status to
// 'sent'. Expects { po_id, override_to? } — override_to lets ops test
// the flow against their own inbox without touching the supplier row.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = (Deno.env.get('HH_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_ADDRESS = Deno.env.get('RESEND_FROM') ?? 'orders@humblehouse.dev'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { po_id, override_to } = await req.json()
    if (!po_id) throw new Error('po_id is required')

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const poRes = await admin
      .from('purchase_orders')
      .select('id, number, status, pdf_url, build_id, supplier_id, currency, subtotal_cents')
      .eq('id', po_id).single()
    if (poRes.error) throw poRes.error
    const po = poRes.data as any
    if (!po.pdf_url) throw new Error('PO has no pdf_url — generate the PDF first')

    const supRes = await admin.from('suppliers')
      .select('name, email, cc_email, currency').eq('id', po.supplier_id).single()
    if (supRes.error) throw supRes.error
    const supplier = supRes.data as any

    const buildRes = await admin.from('builds')
      .select('slot_year, slot_number, builder_id').eq('id', po.build_id).single()
    if (buildRes.error) throw buildRes.error
    const build = buildRes.data as any

    const builderRes = await admin.from('builders')
      .select('name, operator:operators(name)').eq('id', build.builder_id).single()
    if (builderRes.error) throw builderRes.error
    const builder = builderRes.data as any
    const operatorName = builder?.operator?.name ?? 'Humble House'

    const buildNumber = build.slot_year && build.slot_number
      ? `${build.slot_year}-${String(build.slot_number).padStart(3, '0')}`
      : build.id?.slice(0, 8)

    const to = override_to ?? supplier.email
    if (!to) throw new Error('Supplier has no email on file and no override_to given')
    const cc = supplier.cc_email ? [supplier.cc_email] : undefined

    const subject = `${operatorName} — Purchase Order ${po.number}`
    const html = `
      <div style="font-family:Helvetica,Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
        <h1 style="font-weight:400;font-size:20px">${operatorName} — Purchase Order ${po.number}</h1>
        <p>Hi ${supplier.name},</p>
        <p>Please find attached our purchase order for build ${buildNumber}. Please confirm availability and lead time at your earliest convenience.</p>
        <p>Total: ${po.currency} ${(po.subtotal_cents / 100).toFixed(2)}</p>
        <p>Thank you,<br/>${operatorName}</p>
      </div>
    `

    if (!RESEND_KEY) {
      // Dev: mark sent locally so the UI still flows.
      await admin.from('purchase_orders').update({
        status: 'sent', sent_at: new Date().toISOString(), sent_to: to,
      }).eq('id', po.id)
      return new Response(JSON.stringify({ ok: true, demo: true, to }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch PDF bytes to attach — Resend expects base64 content.
    const pdfRes = await fetch(po.pdf_url)
    if (!pdfRes.ok) throw new Error(`PDF fetch failed: ${pdfRes.status}`)
    const buf = new Uint8Array(await pdfRes.arrayBuffer())
    let b64 = ''
    const chunk = 0x8000
    for (let i = 0; i < buf.length; i += chunk) {
      b64 += String.fromCharCode(...buf.subarray(i, i + chunk))
    }
    const content = btoa(b64)

    const payload: Record<string, unknown> = {
      from: FROM_ADDRESS,
      to: [to],
      subject,
      html,
      attachments: [{
        filename: `PO-${po.number}.pdf`,
        content,
      }],
    }
    if (cc) payload.cc = cc

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const resp = await r.json()
    if (!r.ok) throw new Error(resp?.message ?? 'Resend error')

    await admin.from('purchase_orders').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_to: to,
    }).eq('id', po.id)

    return new Response(JSON.stringify({ ok: true, resend_id: resp?.id, to }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
