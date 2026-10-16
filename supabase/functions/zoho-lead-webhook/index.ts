// zoho-lead-webhook — Supabase Edge Function (Deno)
//
// Receives Zoho CRM Workflow Rule POSTs when a lead's status becomes
// Warm. Shared-secret verification (ZOHO_WEBHOOK_SECRET), either in a
// `?secret=` query param or `X-Zoho-Secret` header. Idempotent.

// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from '../_shared/cors.ts'
import { logSync, makeAdmin } from '../_shared/zoho.ts'

const WEBHOOK_SECRET = Deno.env.get('ZOHO_WEBHOOK_SECRET')

interface ZohoPayload {
  lead_id: string
  email?: string
  first_name?: string
  last_name?: string
  phone?: string
  company?: string
  lead_source?: string
  builder?: string          // picklist value — matches builders.zoho_product_id or builders.slug
  message?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const url = new URL(req.url)
  const providedSecret = url.searchParams.get('secret') ?? req.headers.get('x-zoho-secret')
  if (WEBHOOK_SECRET && providedSecret !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let payload: ZohoPayload
  try { payload = await req.json() as ZohoPayload } catch { payload = {} as ZohoPayload }

  const admin = makeAdmin()
  try {
    if (!payload.lead_id) throw new Error('lead_id missing from payload')
    const email = (payload.email ?? '').trim().toLowerCase()
    const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || null

    // Resolve builder
    let builderId: string | null = null
    if (payload.builder) {
      const byProduct = await admin.from('builders').select('id').eq('zoho_product_id', payload.builder).maybeSingle()
      if (byProduct.data) builderId = (byProduct.data as any).id
      if (!builderId) {
        const bySlug = await admin.from('builders').select('id').eq('slug', payload.builder).maybeSingle()
        if (bySlug.data) builderId = (bySlug.data as any).id
      }
    }
    if (!builderId) {
      // Fallback to the first active builder; flag via notes.
      const fallback = await admin.from('builders').select('id').eq('active', true).order('sort').limit(1).maybeSingle()
      builderId = (fallback.data as any)?.id ?? null
    }
    if (!builderId) throw new Error('no builder could be resolved')

    // Upsert customer
    let customerId: string | null = null
    if (email) {
      const existing = await admin.from('customers').select('id, full_name').eq('email', email).maybeSingle()
      if (existing.data) {
        customerId = (existing.data as any).id
        if (fullName && !(existing.data as any).full_name) {
          await admin.from('customers').update({ full_name: fullName, zoho_contact_id: payload.lead_id }).eq('id', customerId)
        } else {
          await admin.from('customers').update({ zoho_contact_id: payload.lead_id }).eq('id', customerId)
        }
      } else {
        const ins = await admin.from('customers').insert({
          email,
          full_name: fullName,
          source: 'web',
          zoho_contact_id: payload.lead_id,
        }).select('id').single()
        if (ins.error) throw ins.error
        customerId = (ins.data as any).id
      }
    }

    // Upsert lead by zoho_lead_id
    const existingLead = await admin.from('leads').select('id, stage').eq('zoho_lead_id', payload.lead_id).maybeSingle()
    let leadId: string
    if (existingLead.data) {
      leadId = (existingLead.data as any).id
      // Keep the existing lead's stage if it's already further along; else bump to warm
      const stage = (existingLead.data as any).stage as string
      const shouldBump = stage === 'inquiry'
      await admin.from('leads').update({
        builder_id: builderId,
        customer_id: customerId,
        source: 'zoho',
        phone: payload.phone ?? null,
        message: payload.message ?? null,
        ...(shouldBump ? { stage: 'warm' } : {}),
      }).eq('id', leadId)
    } else {
      const ins = await admin.from('leads').insert({
        builder_id: builderId,
        customer_id: customerId,
        source: 'zoho',
        stage: 'warm',
        zoho_lead_id: payload.lead_id,
        phone: payload.phone ?? null,
        message: payload.message ?? null,
      }).select('id').single()
      if (ins.error) throw ins.error
      leadId = (ins.data as any).id
    }

    await logSync(admin, {
      direction: 'inbound',
      object: 'lead',
      object_id: payload.lead_id,
      payload,
      status: 'success',
    })

    return new Response(JSON.stringify({ ok: true, lead_id: leadId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    try {
      await logSync(admin, {
        direction: 'inbound',
        object: 'lead',
        object_id: payload.lead_id ?? null,
        payload,
        status: 'error',
        error: (e as Error).message,
      })
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
