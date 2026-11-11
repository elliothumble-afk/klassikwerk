// builder-webhook — Supabase Edge Function (Deno)
//
// Inbound webhook endpoint for builder platforms (Connect, etc.).
// Verifies HMAC-sha256 against the per-builder webhook_secret, stores
// every delivery in builder_webhook_events (idempotent on event_id),
// then dispatches per event_type to a per-event handler. Also exposes
// POST /builder-webhook/backfill (ops only) which calls the builder's
// backfill_url and processes the returned event array.
//
// Event contract (see README):
//   POST /builder-webhook
//   Headers:
//     X-Builder-Id: <uuid>               (which builder is calling)
//     X-Builder-Signature: sha256=<hex>  (hmac of raw body with the
//                                         builder's webhook_secret)
//   Body: { event_id, event_type, payload }
//
// Event types:
//   quote.upserted       → upsert quotes (builder_id, external_id)
//   contract.upserted    → upsert contracts (builder_id, external_id)
//   payment.received     → append quote_payments
//   commission.upserted  → upsert commissions (builder_id, external_id)
//   build.milestone      → append quote_milestones
//
// HH owns commissions.paid: a later commission.upserted with status
// 'void' on a row we already marked 'paid' sets conflict=true and
// keeps 'paid'. All other statuses overwrite.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = (Deno.env.get('HH_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type EventType = 'quote.upserted' | 'contract.upserted' | 'payment.received'
  | 'commission.upserted' | 'build.milestone'

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  'quote.upserted', 'contract.upserted', 'payment.received',
  'commission.upserted', 'build.milestone',
])

interface Envelope { event_id: string; event_type: EventType; payload: any }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Route: /builder-webhook/backfill
  const url = new URL(req.url)
  if (url.pathname.endsWith('/backfill') && req.method === 'POST') {
    try {
      const { builder_id } = await req.json()
      if (!builder_id) throw new Error('builder_id is required')
      // Secrets + backfill_url live on builder_secrets (operator-only
      // RLS). Service role bypasses, so one join via builder_secrets
      // is enough. We still confirm the builders row exists so an
      // unknown id doesn't look like a missing-secret error.
      const bCheck = await admin.from('builders').select('id').eq('id', builder_id).single()
      if (bCheck.error) throw bCheck.error
      const sRes = await admin.from('builder_secrets')
        .select('webhook_secret, backfill_url')
        .eq('builder_id', builder_id).maybeSingle()
      const b = {
        id: builder_id as string,
        webhook_secret: (sRes.data as { webhook_secret?: string | null } | null)?.webhook_secret ?? null,
        backfill_url:   (sRes.data as { backfill_url?: string | null }   | null)?.backfill_url   ?? null,
      }
      if (!b.backfill_url) throw new Error('builder has no backfill_url')
      if (!b.webhook_secret) throw new Error('builder has no webhook_secret')
      // Outbound backfill uses the same signature scheme as inbound:
      // sha256(HMAC(webhook_secret, raw_request_body)). The body is a
      // small JSON envelope so Connect can filter by `since` once the
      // field is populated. Keeping it a POST + JSON body (not a GET)
      // means the shared verifier covers both directions.
      const outboundBody = JSON.stringify({ builder_id: b.id, since: null })
      const fetchRes = await fetch(b.backfill_url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Builder-Id': b.id,
          'X-Builder-Signature': `sha256=${await hmacSha256Hex(b.webhook_secret, outboundBody)}`,
        },
        body: outboundBody,
      })
      if (!fetchRes.ok) throw new Error(`backfill fetch ${fetchRes.status}`)
      const data = await fetchRes.json() as { events: Envelope[] }
      let processed = 0, skipped = 0, failed = 0
      const failures: Array<{ event_id: string; event_type: string; error: string }> = []
      // Tolerant backfill: one failing event must not stop the rest.
      // processEvent already stamps the error onto the stored
      // builder_webhook_events row; we also return a summary so the
      // UI can show counts without digging into the table.
      for (const env of data.events ?? []) {
        try {
          const r = await processEvent(admin, b.id, env)
          if (r === 'processed') processed += 1
          else if (r === 'duplicate') skipped += 1
        } catch (e) {
          failed += 1
          failures.push({
            event_id: env?.event_id ?? '(missing)',
            event_type: env?.event_type ?? '(missing)',
            error: (e as Error).message,
          })
        }
      }
      return new Response(JSON.stringify({ ok: true, processed, skipped, failed, failures }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  // Main webhook POST.
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  try {
    const builderId = req.headers.get('X-Builder-Id') ?? ''
    const sigHeader = req.headers.get('X-Builder-Signature') ?? ''
    if (!builderId || !sigHeader.startsWith('sha256=')) {
      return new Response('missing signature headers', { status: 401 })
    }
    const body = await req.text()
    // Inbound signature verification. webhook_secret is on
    // builder_secrets (operator-only RLS). Service role bypasses.
    const sRes = await admin.from('builder_secrets')
      .select('webhook_secret').eq('builder_id', builderId).maybeSingle()
    const secret = (sRes.data as { webhook_secret?: string | null } | null)?.webhook_secret ?? null
    if (!secret) {
      return new Response('unknown builder', { status: 401 })
    }
    const expected = await hmacSha256Hex(secret, body)
    const provided = sigHeader.slice('sha256='.length)
    if (!timingSafeEqual(expected, provided)) {
      return new Response('bad signature', { status: 401 })
    }
    const env = JSON.parse(body) as Envelope
    if (!env.event_id || !env.event_type) {
      return new Response(JSON.stringify({ error: 'event_id and event_type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    // Reject unknown event types up front per the contract — 400, no
    // DB side effects, Connect SHOULD NOT retry.
    if (!KNOWN_EVENT_TYPES.has(env.event_type)) {
      return new Response(JSON.stringify({ error: `unknown event_type: ${env.event_type}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const result = await processEvent(admin, builderId, env)
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function processEvent(admin: any, builderId: string, env: Envelope): Promise<'processed' | 'duplicate' | 'error'> {
  // Insert the event record first (idempotency guard).
  const ins = await admin.from('builder_webhook_events').insert({
    builder_id: builderId, event_id: env.event_id, event_type: env.event_type,
    payload: env.payload,
  })
  if (ins.error) {
    // Unique violation on (builder_id, event_id) → duplicate.
    if (ins.error.code === '23505') return 'duplicate'
    throw ins.error
  }
  try {
    switch (env.event_type) {
      case 'quote.upserted':      await handleQuoteUpserted(admin, builderId, env.payload); break
      case 'contract.upserted':   await handleContractUpserted(admin, builderId, env.payload); break
      case 'payment.received':    await handlePaymentReceived(admin, builderId, env.payload); break
      case 'commission.upserted': await handleCommissionUpserted(admin, builderId, env.payload); break
      case 'build.milestone':     await handleBuildMilestone(admin, builderId, env.payload); break
      default: throw new Error(`unknown event_type: ${env.event_type}`)
    }
    await admin.from('builder_webhook_events').update({ processed_at: new Date().toISOString() })
      .eq('builder_id', builderId).eq('event_id', env.event_id)
    return 'processed'
  } catch (e) {
    await admin.from('builder_webhook_events').update({ error: (e as Error).message })
      .eq('builder_id', builderId).eq('event_id', env.event_id)
    throw e
  }
}

// ─── Event handlers ─────────────────────────────────────────────────

async function resolveCustomer(admin: any, email: string | null, full_name: string | null): Promise<string | null> {
  if (!email && !full_name) return null
  if (email) {
    const r = await admin.from('customers').select('id').eq('email', email).maybeSingle()
    if (r.data?.id) return r.data.id
  }
  const ins = await admin.from('customers')
    .insert({ email, full_name }).select('id').single()
  if (ins.error) throw ins.error
  return ins.data.id
}

async function resolveLead(admin: any, builderId: string, customerId: string | null): Promise<string | null> {
  if (!customerId) return null
  const r = await admin.from('leads').select('id')
    .eq('builder_id', builderId).eq('customer_id', customerId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (r.data?.id) return r.data.id
  const ins = await admin.from('leads').insert({
    builder_id: builderId, customer_id: customerId, source: 'builder', stage: 'quoted',
  }).select('id').single()
  if (ins.error) throw ins.error
  return ins.data.id
}

async function resolveRep(admin: any, email: string | null): Promise<string | null> {
  if (!email) return null
  // Accept any staff profile (ops rep or operator). In single-operator
  // setups an operator doubles as the sales rep; in bigger teams ops
  // reps exist alongside operators and both can appear on commissions.
  const r = await admin.from('profiles').select('id, user_id, role')
    .not('user_id', 'is', null).in('role', ['ops', 'operator']).limit(100)
  const rows = (r.data ?? []) as Array<{ id: string; user_id: string }>
  if (rows.length === 0) return null
  for (const row of rows) {
    const u = await admin.auth.admin.getUserById(row.user_id)
    if (u.data?.user?.email?.toLowerCase() === email.toLowerCase()) return row.id
  }
  return null
}

async function handleQuoteUpserted(admin: any, builderId: string, p: any) {
  if (!p.external_id) throw new Error('quote.upserted missing external_id')
  const customerId = await resolveCustomer(admin,
    p.customer_email ?? p.customer?.email ?? null,
    p.customer_name ?? p.customer?.full_name ?? null)
  const leadId = await resolveLead(admin, builderId, customerId)
  const repId = await resolveRep(admin, p.rep_email ?? null)
  const incomingPlatformName = typeof p.platform_name === 'string' ? p.platform_name.trim() : null
  const platformId = await resolvePlatform(admin, builderId, incomingPlatformName)
  // Externally-managed builders (e.g. ECD) don't keep tiers in HH —
  // the Connect-side quote owns the pricing stack. tier_id stays null
  // and the DB schema allows it.
  const bMeta = await admin.from('builders')
    .select('managed_externally').eq('id', builderId).single()
  const managedExternally = Boolean((bMeta.data as { managed_externally?: boolean } | null)?.managed_externally)
  const tierId = managedExternally ? null : await resolveTier(admin, builderId)
  if (!leadId) throw new Error('quote.upserted could not resolve lead')
  if (!managedExternally && !tierId) throw new Error('quote.upserted could not resolve tier')
  // Identity for source=builder quotes is (builder_id, external_id).
  // The Connect-side `version` is per-Connect-lead and is nearly
  // always 1 when the Connect quote has no parent lead — so two
  // Connect quotes for the same customer both arrive as v1 and used
  // to collide on quotes_lead_id_version_key. Fix: keep Connect's
  // version in builder_version for display + grouping, and mint our
  // own HH-side version as `max(version where lead_id=…) + 1`.
  const hhLink = p.hh_quote_id ?? null
  const builderVersion = p.version ?? 1
  const existing = await admin.from('quotes')
    .select('id, version').eq('builder_id', builderId).eq('external_id', p.external_id).maybeSingle()

  const row: Record<string, unknown> = {
    source: 'builder',
    builder_id: builderId,
    lead_id: leadId,
    // No fallback: platform_id stays null when the name doesn't map
    // to catalog_platforms.name or an entry in .aliases. The raw
    // name is stored on external_platform_name for the UI to render.
    platform_id: platformId,
    external_platform_name: platformId ? null : (incomingPlatformName || null),
    tier_id: tierId,
    external_id: p.external_id,
    external_url: p.external_url ?? null,
    builder_version: builderVersion,
    status: p.status ?? 'draft',
    price_cents: Number(p.price_cents ?? 0),
    tax_cents: Number(p.tax_cents ?? 0),
    total_cents: Number(p.total_cents ?? (p.price_cents ?? 0) + (p.tax_cents ?? 0)),
    pdf_url: p.pdf_url ?? null,
    sent_at: p.sent_at ?? null,
    approved_at: p.approved_at ?? null,
    sales_rep_profile_id: repId,
  }
  if (hhLink) row.notes = `linked:${hhLink}`

  if (existing.data?.id) {
    // Keep HH's own version on update — we only ever mint it on insert.
    const upd = await admin.from('quotes').update(row).eq('id', existing.data.id)
    if (upd.error) throw new Error(`quote update failed: ${upd.error.message}`)
  } else {
    // Mint next HH version for this lead. Race window is small
    // because the webhook processes events one at a time per Deno
    // isolate, and the (lead_id, version) UNIQUE will catch a
    // genuine conflict — in which case we retry once with +1.
    const nextVersion = await nextHhVersion(admin, leadId)
    row.version = nextVersion
    const first = await admin.from('quotes').insert(row)
    if (first.error && first.error.code === '23505') {
      row.version = await nextHhVersion(admin, leadId)
      const retry = await admin.from('quotes').insert(row)
      if (retry.error) throw new Error(`quote insert failed (after retry): ${retry.error.message}`)
    } else if (first.error) {
      throw new Error(`quote insert failed: ${first.error.message}`)
    }
  }
}

async function nextHhVersion(admin: any, leadId: string): Promise<number> {
  const r = await admin.from('quotes').select('version')
    .eq('lead_id', leadId).order('version', { ascending: false }).limit(1).maybeSingle()
  const current = (r.data as { version?: number } | null)?.version ?? 0
  return current + 1
}

// Match catalog_platforms.name case-insensitively, or any entry in
// its `aliases` text[]. Returns null when nothing matches — the
// caller stores the raw name on quotes.external_platform_name.
async function resolvePlatform(admin: any, builderId: string, name: string | null): Promise<string | null> {
  const n = (name ?? '').trim()
  if (!n) return null
  const r = await admin.rpc('resolve_platform_by_alias', {
    p_builder_id: builderId, p_name: n,
  })
  if (r.error) throw r.error
  return (r.data as string | null) ?? null
}

async function resolveTier(admin: any, builderId: string): Promise<string | null> {
  const r = await admin.from('catalog_tiers').select('id')
    .eq('builder_id', builderId).limit(1).single()
  return r.data?.id ?? null
}

async function handleContractUpserted(admin: any, builderId: string, p: any) {
  if (!p.external_id) throw new Error('contract.upserted missing external_id')
  // Link to a native quote if a linked_quote_external_id matches.
  let quoteId: string | null = null
  if (p.linked_quote_external_id) {
    const q = await admin.from('quotes').select('id')
      .eq('builder_id', builderId).eq('external_id', p.linked_quote_external_id).maybeSingle()
    quoteId = q.data?.id ?? null
  }
  const row = {
    builder_id: builderId,
    external_id: p.external_id,
    quote_id: quoteId,
    linked_quote_external_id: p.linked_quote_external_id ?? null,
    status: p.status ?? 'generated',
    signed_at: p.signed_at ?? null,
    document_url: p.document_url ?? null,
    payment_schedule: p.payment_schedule ?? [],
    updated_at: new Date().toISOString(),
  }
  const existing = await admin.from('contracts').select('id')
    .eq('builder_id', builderId).eq('external_id', p.external_id).maybeSingle()
  if (existing.data?.id) {
    await admin.from('contracts').update(row).eq('id', existing.data.id)
  } else {
    await admin.from('contracts').insert(row)
  }
}

async function handlePaymentReceived(admin: any, builderId: string, p: any) {
  if (!p.quote_external_id) throw new Error('payment.received missing quote_external_id')
  // external_id (Connect's milestone id) is the idempotency key. Connect
  // retries reuse the same event_id at the envelope level, but at the
  // record level we also need per-payment identity so a re-sent event
  // never appends a duplicate row.
  if (!p.external_id) throw new Error('payment.received missing external_id')
  const q = await admin.from('quotes').select('id')
    .eq('builder_id', builderId).eq('external_id', p.quote_external_id).maybeSingle()
  if (!q.data?.id) throw new Error('payment.received quote not found')
  const existing = await admin.from('quote_payments').select('id')
    .eq('quote_id', q.data.id).eq('external_id', p.external_id).maybeSingle()
  if (existing.data?.id) return
  await admin.from('quote_payments').insert({
    quote_id: q.data.id,
    amount_cents: Number(p.amount_cents ?? 0),
    received_at: p.received_at ?? new Date().toISOString(),
    stage: p.stage ?? null,
    reference: p.reference ?? null,
    external_id: p.external_id,
  })
}

async function handleCommissionUpserted(admin: any, builderId: string, p: any) {
  if (!p.external_id) throw new Error('commission.upserted missing external_id')
  const repId = await resolveRep(admin, p.rep_email ?? null)
  // Link to a builder-quote if linked_quote_external_id matches.
  let quoteId: string | null = null
  if (p.quote_external_id) {
    const q = await admin.from('quotes').select('id')
      .eq('builder_id', builderId).eq('external_id', p.quote_external_id).maybeSingle()
    quoteId = q.data?.id ?? null
  }
  const existing = await admin.from('commissions').select('id, status')
    .eq('builder_id', builderId).eq('external_id', p.external_id).maybeSingle()
  const incomingStatus = p.status ?? 'pending'
  const base = {
    builder_id: builderId,
    profile_id: repId,
    quote_id: quoteId,
    external_id: p.external_id,
    source: 'builder',
    description: p.description ?? null,
    amount_cents: Number(p.amount_cents ?? 0),
    earned_at: p.earned_at ?? null,
    updated_at: new Date().toISOString(),
  }
  if (existing.data?.id) {
    // HH owns 'paid'. If we already marked paid and Connect sends a
    // non-paid status, keep paid + raise conflict=true for review.
    if (existing.data.status === 'paid' && incomingStatus !== 'paid') {
      await admin.from('commissions').update({ ...base, conflict: true })
        .eq('id', existing.data.id)
    } else {
      await admin.from('commissions').update({ ...base, status: incomingStatus })
        .eq('id', existing.data.id)
    }
  } else {
    await admin.from('commissions').insert({ ...base, status: incomingStatus })
  }
}

async function handleBuildMilestone(admin: any, builderId: string, p: any) {
  if (!p.quote_external_id) throw new Error('build.milestone missing quote_external_id')
  if (!p.name) throw new Error('build.milestone missing name')
  // external_id (Connect's stage id) is the idempotency key. Same
  // reasoning as payment.received.
  if (!p.external_id) throw new Error('build.milestone missing external_id')
  const q = await admin.from('quotes').select('id')
    .eq('builder_id', builderId).eq('external_id', p.quote_external_id).maybeSingle()
  if (!q.data?.id) throw new Error('build.milestone quote not found')
  const existing = await admin.from('quote_milestones').select('id')
    .eq('quote_id', q.data.id).eq('external_id', p.external_id).maybeSingle()
  if (existing.data?.id) return
  await admin.from('quote_milestones').insert({
    quote_id: q.data.id,
    name: p.name,
    reached_at: p.reached_at ?? new Date().toISOString(),
    external_id: p.external_id,
  })
}
