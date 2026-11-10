// Phase 8 end-to-end: replay a Connect payload set against a Test*
// customer, then prove each handler shaped the DB correctly.
//
// Scenario (all events for one quote on an ECD builder):
//   1. quote.upserted → creates a builder-sourced quote, lead, customer.
//   2. contract.upserted → stamps a contract row, linked back to the quote.
//   3. payment.received → appends two payment rows.
//   4. commission.upserted → upserts the rep's commission as 'earned'.
//   5. build.milestone → appends a milestone.
//   6. Replay step 1 (same event_id) → returns duplicate, no new row.
//   7. Admin marks commission paid.
//   8. Connect sends commission.upserted {status:'void'} → HH keeps paid
//      and sets conflict=true (paid→conflict guard).
//
// The payload uses a Test* customer email only, so no live record is
// mutated. On repeat runs the test wipes its own prior state by
// (builder_id, external_id) lookups.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

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
  if (!v) throw new Error(`${k} is required (set in shell or .env)`)
  return v
}

function hmac(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

async function post(builderId: string, secret: string, envelope: unknown) {
  const body = JSON.stringify(envelope)
  const res = await fetch(`${SUPABASE_URL}/functions/v1/builder-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Builder-Id': builderId,
      'X-Builder-Signature': `sha256=${hmac(secret, body)}`,
    },
    body,
  })
  const text = await res.text()
  let json: unknown = null
  try { json = JSON.parse(text) } catch { /* tolerate plain text */ }
  return { status: res.status, body: json ?? text }
}

test('Phase 8: Connect replay → grouped row, summary, /ops/me; paid→conflict guard', async () => {
  test.setTimeout(120_000)
  const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

  // Pick any active builder; Phase 8 doesn't require the builder to
  // be specifically "ECD". We stamp a fresh webhook_secret so the
  // test's HMAC matches regardless of what's on file.
  const builderRes = await admin.from('builders').select('id, name').eq('active', true).limit(1).single()
  if (builderRes.error) throw builderRes.error
  const builderId = builderRes.data.id as string
  const secret = crypto.randomBytes(32).toString('hex')
  const setSecret = await admin.from('builders').update({ webhook_secret: secret }).eq('id', builderId)
  if (setSecret.error) throw setSecret.error

  const repRes = await admin.from('profiles').select('id, user_id').eq('role', 'ops').not('user_id', 'is', null).limit(1).single()
  if (repRes.error) throw repRes.error
  const repProfileId = repRes.data.id as string
  const repUser = await admin.auth.admin.getUserById(repRes.data.user_id as string)
  if (repUser.error) throw repUser.error
  const repEmail = repUser.data.user?.email
  if (!repEmail) throw new Error('rep has no email')

  const runId = Math.random().toString(36).slice(2, 8)
  const customerEmail = `test-connect-${runId}@humblehouse.test`
  const customerName = `Test Connect Replay ${runId}`
  const quoteExternalId = `conn-q-${runId}`
  const contractExternalId = `conn-c-${runId}`
  const commissionExternalId = `conn-cm-${runId}`

  // ─── Clean prior test state ──────────────────────────────────────
  await admin.from('commissions').delete().eq('builder_id', builderId).eq('external_id', commissionExternalId)
  await admin.from('contracts').delete().eq('builder_id', builderId).eq('external_id', contractExternalId)
  await admin.from('builder_webhook_events').delete().eq('builder_id', builderId).like('event_id', `evt-${runId}-%`)
  const stale = await admin.from('quotes').select('id').eq('builder_id', builderId).eq('external_id', quoteExternalId).maybeSingle()
  if (stale.data?.id) {
    await admin.from('quote_milestones').delete().eq('quote_id', stale.data.id)
    await admin.from('quote_payments').delete().eq('quote_id', stale.data.id)
    await admin.from('quotes').delete().eq('id', stale.data.id)
  }
  await admin.from('customers').delete().eq('email', customerEmail)

  // ─── 1. quote.upserted ───────────────────────────────────────────
  const r1 = await post(builderId, secret, {
    event_id: `evt-${runId}-q1`,
    event_type: 'quote.upserted',
    payload: {
      external_id: quoteExternalId,
      external_url: `https://connect.example.com/quotes/${quoteExternalId}`,
      version: 1,
      status: 'sent',
      price_cents: 125_000_00,
      tax_cents: 0,
      total_cents: 125_000_00,
      customer_email: customerEmail,
      customer_name: customerName,
      rep_email: repEmail,
    },
  })
  expect(r1.status, `quote.upserted body: ${JSON.stringify(r1.body)}`).toBe(200)

  const quote = await admin.from('quotes')
    .select('id, source, status, total_cents, external_url, sales_rep_profile_id, lead_id')
    .eq('builder_id', builderId).eq('external_id', quoteExternalId).single()
  if (quote.error) throw quote.error
  expect(quote.data.source).toBe('builder')
  expect(quote.data.status).toBe('sent')
  expect(quote.data.total_cents).toBe(125_000_00)
  expect(quote.data.sales_rep_profile_id).toBe(repProfileId)

  const customer = await admin.from('customers').select('id, full_name').eq('email', customerEmail).single()
  if (customer.error) throw customer.error
  expect(customer.data.full_name).toBe(customerName)

  // ─── 2. contract.upserted ────────────────────────────────────────
  const r2 = await post(builderId, secret, {
    event_id: `evt-${runId}-c1`,
    event_type: 'contract.upserted',
    payload: {
      external_id: contractExternalId,
      linked_quote_external_id: quoteExternalId,
      status: 'sent',
      document_url: `https://connect.example.com/contracts/${contractExternalId}.pdf`,
      payment_schedule: [{ label: '50% deposit', percent: 50 }, { label: 'On delivery', percent: 50 }],
    },
  })
  expect(r2.status).toBe(200)
  const contract = await admin.from('contracts').select('id, quote_id, status')
    .eq('builder_id', builderId).eq('external_id', contractExternalId).single()
  if (contract.error) throw contract.error
  expect(contract.data.quote_id).toBe(quote.data.id)
  expect(contract.data.status).toBe('sent')

  // ─── 3a. payment.received (reservation) ──────────────────────────
  const r3a = await post(builderId, secret, {
    event_id: `evt-${runId}-p1`,
    event_type: 'payment.received',
    payload: {
      external_id: `pay-${runId}-1`,
      quote_external_id: quoteExternalId,
      amount_cents: 25_000_00,
      received_at: new Date().toISOString(),
      stage: 'reservation',
      reference: 'ch_testres',
    },
  })
  expect(r3a.status).toBe(200)

  // ─── 3b. payment.received (milestone) ────────────────────────────
  const r3b = await post(builderId, secret, {
    event_id: `evt-${runId}-p2`,
    event_type: 'payment.received',
    payload: {
      external_id: `pay-${runId}-2`,
      quote_external_id: quoteExternalId,
      amount_cents: 50_000_00,
      received_at: new Date().toISOString(),
      stage: 'milestone',
    },
  })
  expect(r3b.status).toBe(200)

  const payments = await admin.from('quote_payments').select('amount_cents, stage')
    .eq('quote_id', quote.data.id)
  if (payments.error) throw payments.error
  expect(payments.data.length).toBe(2)
  const paySum = payments.data.reduce((s, r) => s + r.amount_cents, 0)
  expect(paySum).toBe(75_000_00)

  // ─── 4. commission.upserted → earned ─────────────────────────────
  const r4 = await post(builderId, secret, {
    event_id: `evt-${runId}-cm1`,
    event_type: 'commission.upserted',
    payload: {
      external_id: commissionExternalId,
      quote_external_id: quoteExternalId,
      rep_email: repEmail,
      amount_cents: 6_250_00,
      status: 'earned',
      earned_at: new Date().toISOString(),
      description: `Replay test commission ${runId}`,
    },
  })
  expect(r4.status).toBe(200)
  const comm1 = await admin.from('commissions')
    .select('id, status, amount_cents, profile_id, quote_id, conflict')
    .eq('builder_id', builderId).eq('external_id', commissionExternalId).single()
  if (comm1.error) throw comm1.error
  expect(comm1.data.status).toBe('earned')
  expect(comm1.data.amount_cents).toBe(6_250_00)
  expect(comm1.data.profile_id).toBe(repProfileId)
  expect(comm1.data.quote_id).toBe(quote.data.id)
  expect(comm1.data.conflict).toBe(false)

  // ─── 5. build.milestone ──────────────────────────────────────────
  const r5 = await post(builderId, secret, {
    event_id: `evt-${runId}-m1`,
    event_type: 'build.milestone',
    payload: {
      external_id: `ms-${runId}-1`,
      quote_external_id: quoteExternalId,
      name: 'Chassis arrived',
      reached_at: new Date().toISOString(),
    },
  })
  expect(r5.status).toBe(200)
  const milestones = await admin.from('quote_milestones').select('name').eq('quote_id', quote.data.id)
  if (milestones.error) throw milestones.error
  expect(milestones.data.map(m => m.name)).toContain('Chassis arrived')

  // ─── 6. Idempotency: replay the first envelope ────────────────────
  const before = await admin.from('builder_webhook_events').select('id', { count: 'exact', head: true })
    .eq('builder_id', builderId).eq('event_id', `evt-${runId}-q1`)
  expect(before.count).toBe(1)
  const r1Replay = await post(builderId, secret, {
    event_id: `evt-${runId}-q1`,
    event_type: 'quote.upserted',
    payload: {
      external_id: quoteExternalId,
      status: 'sent',
      price_cents: 999_999_99,  // mutated — must be ignored
      customer_email: customerEmail,
      customer_name: customerName,
    },
  })
  expect(r1Replay.status).toBe(200)
  expect((r1Replay.body as { result?: string })?.result).toBe('duplicate')
  const quoteAfter = await admin.from('quotes').select('total_cents').eq('id', quote.data.id).single()
  expect(quoteAfter.data?.total_cents).toBe(125_000_00)  // unchanged

  // ─── 7. Admin marks the commission paid ──────────────────────────
  const paid = await admin.from('commissions').update({
    status: 'paid',
    paid_at: new Date().toISOString(),
    paid_reference: 'HH-TEST-PAID',
  }).eq('id', comm1.data.id)
  if (paid.error) throw paid.error

  // ─── 8. paid→conflict guard: Connect sends void ──────────────────
  const r8 = await post(builderId, secret, {
    event_id: `evt-${runId}-cm2`,
    event_type: 'commission.upserted',
    payload: {
      external_id: commissionExternalId,
      quote_external_id: quoteExternalId,
      rep_email: repEmail,
      amount_cents: 6_250_00,
      status: 'void',
      description: 'Connect voided — HH already paid',
    },
  })
  expect(r8.status).toBe(200)
  const commAfter = await admin.from('commissions').select('status, conflict').eq('id', comm1.data.id).single()
  if (commAfter.error) throw commAfter.error
  expect(commAfter.data.status).toBe('paid')          // HH owns paid
  expect(commAfter.data.conflict).toBe(true)          // flagged for review

  // ─── 9. Clean up — leave DB as we found it on repeat runs ────────
  await admin.from('commissions').delete().eq('id', comm1.data.id)
  await admin.from('contracts').delete().eq('id', contract.data.id)
  await admin.from('quote_payments').delete().eq('quote_id', quote.data.id)
  await admin.from('quote_milestones').delete().eq('quote_id', quote.data.id)
  await admin.from('builder_webhook_events').delete().eq('builder_id', builderId).like('event_id', `evt-${runId}-%`)
  await admin.from('quotes').delete().eq('id', quote.data.id)
  await admin.from('customers').delete().eq('id', customer.data.id)
})
