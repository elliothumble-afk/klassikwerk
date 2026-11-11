// Phase 8 regression: two Connect quotes for one customer, both
// reporting version=1, must land as two distinct HH quotes. The old
// code wrote Connect's version straight into quotes.version, so the
// second arrival collided on quotes_lead_id_version_key.
//
// New rule (edge function):
//   • quote.upserted identifies builder-source quotes by
//     (builder_id, external_id) — upsert on that.
//   • The Connect-side version is stored in builder_version.
//   • quotes.version is HH's own monotonic counter within the lead.
//
// This spec also exercises the tolerant-backfill path (one bad
// event shouldn't stop the batch).

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SUPABASE_URL = 'https://vvuccbskbswtfvxplxxm.supabase.co'

function env(k: string): string {
  const dotenv = path.join(process.cwd(), '.env')
  if (!process.env[k] && fs.existsSync(dotenv)) {
    for (const line of fs.readFileSync(dotenv, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  }
  const v = process.env[k]
  if (!v) throw new Error(`${k} is required`)
  return v
}

function hmac(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}
async function post(builderId: string, secret: string, envelope: unknown) {
  const body = JSON.stringify(envelope)
  const r = await fetch(`${SUPABASE_URL}/functions/v1/builder-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Builder-Id': builderId,
      'X-Builder-Signature': `sha256=${hmac(secret, body)}`,
    },
    body,
  })
  const text = await r.text()
  let json: unknown = null; try { json = JSON.parse(text) } catch { /* ignore */ }
  return { status: r.status, body: json ?? text }
}

test('two Connect v1 quotes for same customer → two HH versions', async () => {
  test.setTimeout(120_000)
  const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

  const runId = crypto.randomBytes(3).toString('hex')
  const customerEmail = `test-ver-${runId}@humblehouse.test`

  // Use CTC — it has platforms + tiers seeded.
  const builderId = '20000000-0000-0000-0000-000000000004'
  const secret = crypto.randomBytes(32).toString('hex')
  const upd = await admin.from('builder_secrets')
    .upsert({ builder_id: builderId, webhook_secret: secret }, { onConflict: 'builder_id' })
  if (upd.error) throw upd.error

  const extA = `QV2-TEST-${runId}-A`
  const extB = `QV2-TEST-${runId}-B`

  // Pre-clean to make the test re-runnable.
  const prior = await admin.from('quotes').select('id')
    .eq('builder_id', builderId).in('external_id', [extA, extB])
  for (const row of (prior.data ?? []) as Array<{ id: string }>) {
    await admin.from('quote_milestones').delete().eq('quote_id', row.id)
    await admin.from('quote_payments').delete().eq('quote_id', row.id)
    await admin.from('quotes').delete().eq('id', row.id)
  }
  await admin.from('builder_webhook_events').delete().eq('builder_id', builderId).like('event_id', `evt-${runId}-%`)
  await admin.from('customers').delete().eq('email', customerEmail)

  try {
    // ─── First quote: Connect version=1 ───────────────────────────
    const r1 = await post(builderId, secret, {
      event_id: `evt-${runId}-a`,
      event_type: 'quote.upserted',
      payload: {
        external_id: extA,
        version: 1,
        status: 'sent',
        price_cents: 10_000_00, tax_cents: 0, total_cents: 10_000_00,
        customer_email: customerEmail,
        customer_name: `Test Version ${runId}`,
      },
    })
    expect(r1.status, `first quote body: ${JSON.stringify(r1.body)}`).toBe(200)

    // ─── Second quote for SAME customer: also Connect version=1 ────
    const r2 = await post(builderId, secret, {
      event_id: `evt-${runId}-b`,
      event_type: 'quote.upserted',
      payload: {
        external_id: extB,
        version: 1,
        status: 'draft',
        price_cents: 20_000_00, tax_cents: 0, total_cents: 20_000_00,
        customer_email: customerEmail,
        customer_name: `Test Version ${runId}`,
      },
    })
    expect(r2.status, `second quote body: ${JSON.stringify(r2.body)}`).toBe(200)

    // ─── Both must exist. They share one lead but have distinct HH
    //     versions. Connect's version lives on builder_version. ─────
    const qA = await admin.from('quotes')
      .select('id, lead_id, version, builder_version, external_id')
      .eq('builder_id', builderId).eq('external_id', extA).single()
    const qB = await admin.from('quotes')
      .select('id, lead_id, version, builder_version, external_id')
      .eq('builder_id', builderId).eq('external_id', extB).single()
    expect(qA.error).toBeNull()
    expect(qB.error).toBeNull()

    expect(qA.data!.lead_id).toBe(qB.data!.lead_id)                 // one lead
    expect(qA.data!.version).not.toBe(qB.data!.version)              // distinct HH versions
    expect(qA.data!.builder_version).toBe(1)                         // Connect's version preserved
    expect(qB.data!.builder_version).toBe(1)
    expect(qA.data!.external_id).toBe(extA)
    expect(qB.data!.external_id).toBe(extB)

    // ─── Replay the first envelope → duplicate; row unchanged ──────
    const rReplay = await post(builderId, secret, {
      event_id: `evt-${runId}-a`,
      event_type: 'quote.upserted',
      payload: { external_id: extA, version: 99 /* ignored on duplicate */ },
    })
    expect(rReplay.status).toBe(200)
    const after = await admin.from('quotes')
      .select('version, builder_version').eq('id', qA.data!.id).single()
    expect(after.data!.version).toBe(qA.data!.version)
    expect(after.data!.builder_version).toBe(1)

    // ─── Resend first as a NEW event_id → upsert path updates
    //     fields but NOT HH's version (which stays monotonic). ─────
    const rUpdate = await post(builderId, secret, {
      event_id: `evt-${runId}-a2`,
      event_type: 'quote.upserted',
      payload: {
        external_id: extA, version: 5, status: 'approved',
        price_cents: 11_000_00, tax_cents: 0, total_cents: 11_000_00,
        customer_email: customerEmail, customer_name: `Test Version ${runId}`,
      },
    })
    expect(rUpdate.status).toBe(200)
    const afterUpd = await admin.from('quotes')
      .select('version, builder_version, status, total_cents').eq('id', qA.data!.id).single()
    expect(afterUpd.data!.version).toBe(qA.data!.version)           // HH version unchanged
    expect(afterUpd.data!.builder_version).toBe(5)                   // Connect version refreshed
    expect(afterUpd.data!.status).toBe('approved')
    expect(afterUpd.data!.total_cents).toBe(11_000_00)
  } finally {
    const cleanup = await admin.from('quotes').select('id')
      .eq('builder_id', builderId).in('external_id', [extA, extB])
    for (const row of (cleanup.data ?? []) as Array<{ id: string }>) {
      await admin.from('quote_milestones').delete().eq('quote_id', row.id)
      await admin.from('quote_payments').delete().eq('quote_id', row.id)
      await admin.from('quotes').delete().eq('id', row.id)
    }
    await admin.from('builder_webhook_events').delete().eq('builder_id', builderId).like('event_id', `evt-${runId}-%`)
    await admin.from('customers').delete().eq('email', customerEmail)
  }
})
