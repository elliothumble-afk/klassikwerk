// zoho-push — Supabase Edge Function (Deno)
//
// Pushes a status/stage change back to Zoho CRM. Called by other edge
// functions (send-quote, approve-quote, ops stage changes). Logs every
// attempt to zoho_sync_log so /ops/settings/zoho can show failures with
// a clean error when Zoho secrets are absent.

// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from '../_shared/cors.ts'
import { apiHost, getAccessToken, logSync, makeAdmin, zohoConfigured } from '../_shared/zoho.ts'

interface Payload {
  kind: 'quote_sent' | 'quote_approved' | 'lead_stage_changed'
  quote_id?: string
  lead_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const admin = makeAdmin()
  let payload: Payload = { kind: 'lead_stage_changed' }
  try { payload = await req.json() as Payload } catch { /* use default */ }

  try {
    if (!zohoConfigured()) {
      await logSync(admin, {
        direction: 'outbound',
        object: payload.kind,
        payload,
        status: 'error',
        error: 'Zoho secrets are not configured (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN).',
      })
      return new Response(JSON.stringify({ ok: false, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Resolve lead + zoho_lead_id
    let zohoLeadId: string | null = null
    let noteContent = ''
    let newStatus: string | null = null

    if (payload.kind === 'quote_sent' || payload.kind === 'quote_approved') {
      if (!payload.quote_id) throw new Error('quote_id required')
      const q = await admin
        .from('quotes')
        .select('version, price_cents, lead:leads(zoho_lead_id)')
        .eq('id', payload.quote_id)
        .single()
      if (q.error) throw q.error
      zohoLeadId = (q.data as any).lead?.zoho_lead_id ?? null
      noteContent = payload.kind === 'quote_sent'
        ? `Quote v${(q.data as any).version} sent, $${((q.data as any).price_cents / 100).toLocaleString()}`
        : `Quote v${(q.data as any).version} approved, $${((q.data as any).price_cents / 100).toLocaleString()}`
      newStatus = payload.kind === 'quote_sent' ? 'Quoted' : 'Approved'
    } else if (payload.kind === 'lead_stage_changed') {
      if (!payload.lead_id) throw new Error('lead_id required')
      const l = await admin.from('leads').select('zoho_lead_id, stage').eq('id', payload.lead_id).single()
      if (l.error) throw l.error
      zohoLeadId = (l.data as any).zoho_lead_id ?? null
      newStatus = (l.data as any).stage
      noteContent = `Stage: ${newStatus}`
    }

    if (!zohoLeadId) {
      await logSync(admin, {
        direction: 'outbound',
        object: payload.kind,
        payload,
        status: 'error',
        error: 'Lead has no zoho_lead_id — nothing to push.',
      })
      return new Response(JSON.stringify({ ok: false, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = await getAccessToken(admin)
    const headers = {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    }

    // Update lead status (field name conventionally "Lead_Status")
    if (newStatus) {
      await fetch(`${apiHost()}/crm/v6/Leads/${zohoLeadId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ data: [{ Lead_Status: newStatus }] }),
      })
    }

    // Add a note
    await fetch(`${apiHost()}/crm/v6/Notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: [{
          Note_Title: `KlassikWerk ${payload.kind}`,
          Note_Content: noteContent,
          Parent_Id: zohoLeadId,
          se_module: 'Leads',
        }],
      }),
    })

    await logSync(admin, {
      direction: 'outbound',
      object: payload.kind,
      object_id: zohoLeadId,
      payload,
      status: 'success',
    })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    await logSync(admin, {
      direction: 'outbound',
      object: payload.kind,
      payload,
      status: 'error',
      error: (e as Error).message,
    })
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
