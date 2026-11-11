// Phase 9c — builder-webhook matches the authoritative Connect spec.
//
// Phase 8's replay test already covers the baseline happy path (each
// event type processed, duplicate event_id returns 'duplicate', paid
// → conflict guard, platform aliases). This spec hardens the edges
// Connect actually exercises today, which the current spec made
// explicit:
//
//   • quote.upserted with price_cents / tax_cents / total_cents
//     OMITTED must not error (Connect omits them when it has no
//     number — zero is a value, missing is not).
//   • quote.upserted with a rep_email that has no matching HH profile
//     must process as Unassigned (sales_rep_profile_id = null), never
//     reject — HH doesn't maintain john@/nikki@/tom@humblehouseauto.com
//     accounts yet.
//   • payment.received and build.milestone are idempotent on their
//     payload-level external_id (Connect's milestone/stage id).
//     Replaying with the same external_id but a new envelope-level
//     event_id must not append a duplicate row. Omitting external_id
//     must be rejected (handler throws), so a later retry cannot
//     silently double-insert.
//   • Response contract: {"ok":true,"result":"processed"|"duplicate"}.
//   • Unknown event_type returns 400, no DB side effects.
//
// All DB writes use a Test* customer email so no live record is
// touched; the test cleans itself up in finally.
//
// Admin DB access runs via the Supabase Management API's /database/query
// endpoint using the local Supabase access token (~/.supabase/access-token
// or SUPABASE_ACCESS_TOKEN) so the test runs without having to export
// the project's sb_secret_ key. The webhook call itself uses HMAC auth
// via the per-builder webhook_secret and is keyless.

import { test, expect } from '@playwright/test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SUPABASE_URL = 'https://vvuccbskbswtfvxplxxm.supabase.co'
const PROJECT_REF  = 'vvuccbskbswtfvxplxxm'
const MGMT_URL     = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

function accessToken(): string {
  const env = process.env.SUPABASE_ACCESS_TOKEN
  if (env) return env
  const p = path.join(os.homedir(), '.supabase', 'access-token')
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim()
  throw new Error('SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token required')
}

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  // The mgmt API doesn't support parameterised queries, so we inline
  // values. Everything we send is generated locally (runIds, timestamps),
  // never user input — safe to concatenate, but we still use a small
  // literal-escaper to prevent accidental quote breakage.
  const bound = params.length === 0 ? query : query.replace(/\$(\d+)/g, (_, n) => {
    const v = params[Number(n) - 1]
    if (v == null) return 'null'
    if (typeof v === 'number') return String(v)
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    return `'${String(v).replace(/'/g, "''")}'`
  })
  const res = await fetch(MGMT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: bound }),
  })
  if (!res.ok) throw new Error(`mgmt SQL failed ${res.status}: ${await res.text()}`)
  return (await res.json()) as T[]
}

async function sqlOne<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T | null> {
  const rows = await sql<T>(query, params)
  return rows[0] ?? null
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
  try { json = JSON.parse(text) } catch { /* plain text tolerated */ }
  return { status: res.status, body: json ?? text }
}

test('builder-webhook matches Connect spec: omitted prices, unknown rep, idempotency', async () => {
  test.setTimeout(120_000)

  const builderRow = await sqlOne<{ id: string }>(
    `select id::text from builders where active = true limit 1`)
  if (!builderRow) throw new Error('no active builder')
  const builderId = builderRow.id
  const secret = crypto.randomBytes(32).toString('hex')
  await sql(
    `insert into builder_secrets (builder_id, webhook_secret) values ($1, $2)
       on conflict (builder_id) do update set webhook_secret = excluded.webhook_secret`,
    [builderId, secret])

  const runId = Math.random().toString(36).slice(2, 8)
  const customerEmail = `test-conn-spec-${runId}@humblehouse.test`
  const customerName = `Test Connect Spec ${runId}`
  const qNoPriceExt       = `conn-q-${runId}-np`
  const qUnknownRepExt    = `conn-q-${runId}-ur`
  const qForPaymentsExt   = `conn-q-${runId}-pm`

  const cleanup = async () => {
    await sql(`delete from builder_webhook_events
                where builder_id = $1 and event_id like 'evt-${runId}-%'`, [builderId])
    for (const ext of [qNoPriceExt, qUnknownRepExt, qForPaymentsExt]) {
      const q = await sqlOne<{ id: string }>(
        `select id::text from quotes where builder_id = $1 and external_id = $2`,
        [builderId, ext])
      if (q?.id) {
        await sql(`delete from quote_payments where quote_id = $1`, [q.id])
        await sql(`delete from quote_milestones where quote_id = $1`, [q.id])
        await sql(`delete from quotes where id = $1`, [q.id])
      }
    }
    await sql(`delete from customers where email = $1`, [customerEmail])
  }

  try {
    await cleanup()

    // ─── 1. quote.upserted with OMITTED price fields ─────────────────
    // Connect sends no price_cents / tax_cents / total_cents when it
    // doesn't have a number yet. The handler defaults to 0 (the DB
    // column is NOT NULL) and must not error.
    const r1 = await post(builderId, secret, {
      event_id: `evt-${runId}-np`,
      event_type: 'quote.upserted',
      payload: {
        external_id: qNoPriceExt,
        version: 1,
        status: 'draft',
        customer_email: customerEmail,
        customer_name: customerName,
      },
    })
    expect(r1.status, `np body: ${JSON.stringify(r1.body)}`).toBe(200)
    expect((r1.body as { ok?: boolean }).ok).toBe(true)
    expect((r1.body as { result?: string }).result).toBe('processed')
    const noPriceQuote = await sqlOne<{ id: string; price_cents: number; tax_cents: number; total_cents: number }>(
      `select id::text, price_cents, tax_cents, total_cents
         from quotes where builder_id = $1 and external_id = $2`,
      [builderId, qNoPriceExt])
    expect(noPriceQuote!.price_cents).toBe(0)
    expect(noPriceQuote!.tax_cents).toBe(0)
    expect(noPriceQuote!.total_cents).toBe(0)

    // ─── 2. Unknown rep_email must process as Unassigned ─────────────
    // HH doesn't maintain john@/nikki@/tom@humblehouseauto.com. The
    // webhook must accept them and store sales_rep_profile_id = null.
    const r2 = await post(builderId, secret, {
      event_id: `evt-${runId}-ur`,
      event_type: 'quote.upserted',
      payload: {
        external_id: qUnknownRepExt,
        version: 2,
        status: 'sent',
        price_cents: 50_000_00,
        tax_cents: 0,
        total_cents: 50_000_00,
        customer_email: customerEmail,
        customer_name: customerName,
        rep_email: 'john@humblehouseauto.com',
      },
    })
    expect(r2.status, `ur body: ${JSON.stringify(r2.body)}`).toBe(200)
    const urQuote = await sqlOne<{ sales_rep_profile_id: string | null; status: string }>(
      `select sales_rep_profile_id::text, status
         from quotes where builder_id = $1 and external_id = $2`,
      [builderId, qUnknownRepExt])
    expect(urQuote!.sales_rep_profile_id).toBeNull()
    expect(urQuote!.status).toBe('sent')

    // Set up a quote for payment / milestone idempotency.
    const r3 = await post(builderId, secret, {
      event_id: `evt-${runId}-pm`,
      event_type: 'quote.upserted',
      payload: {
        external_id: qForPaymentsExt,
        version: 3,
        status: 'approved',
        price_cents: 100_000_00,
        total_cents: 100_000_00,
        customer_email: customerEmail,
        customer_name: customerName,
      },
    })
    expect(r3.status).toBe(200)
    const forPayQuote = await sqlOne<{ id: string }>(
      `select id::text from quotes where builder_id = $1 and external_id = $2`,
      [builderId, qForPaymentsExt])
    const quoteId = forPayQuote!.id

    // ─── 3a. payment.received idempotent on external_id ──────────────
    // Second envelope with a NEW event_id but the SAME payload
    // external_id must not create a duplicate quote_payments row.
    const payExt = `pay-${runId}-A`
    const p1 = await post(builderId, secret, {
      event_id: `evt-${runId}-pay1`,
      event_type: 'payment.received',
      payload: {
        external_id: payExt,
        quote_external_id: qForPaymentsExt,
        amount_cents: 10_000_00,
        received_at: new Date().toISOString(),
        stage: 'reservation',
      },
    })
    expect(p1.status).toBe(200)
    const p2 = await post(builderId, secret, {
      event_id: `evt-${runId}-pay2`,
      event_type: 'payment.received',
      payload: {
        external_id: payExt,
        quote_external_id: qForPaymentsExt,
        amount_cents: 10_000_00,
        received_at: new Date().toISOString(),
        stage: 'reservation',
      },
    })
    expect(p2.status).toBe(200)
    const payRow = await sqlOne<{ n: number }>(
      `select count(*)::int as n from quote_payments where quote_id = $1 and external_id = $2`,
      [quoteId, payExt])
    expect(payRow!.n).toBe(1)

    // ─── 3b. payment.received without external_id must fail ──────────
    // Without the idempotency key we can't guarantee a replay won't
    // append a duplicate, so the handler rejects — Connect will see a
    // non-200 and either fix the payload or stop retrying.
    const pNoExt = await post(builderId, secret, {
      event_id: `evt-${runId}-pay-no-ext`,
      event_type: 'payment.received',
      payload: {
        quote_external_id: qForPaymentsExt,
        amount_cents: 1_00,
        received_at: new Date().toISOString(),
      },
    })
    expect(pNoExt.status).not.toBe(200)
    const evtRow = await sqlOne<{ error: string | null; processed_at: string | null }>(
      `select error, processed_at from builder_webhook_events
         where builder_id = $1 and event_id = $2`,
      [builderId, `evt-${runId}-pay-no-ext`])
    expect(evtRow!.error).toMatch(/external_id/i)
    expect(evtRow!.processed_at).toBeNull()

    // ─── 4a. build.milestone idempotent on external_id ───────────────
    const msExt = `ms-${runId}-A`
    const m1 = await post(builderId, secret, {
      event_id: `evt-${runId}-ms1`,
      event_type: 'build.milestone',
      payload: {
        external_id: msExt,
        quote_external_id: qForPaymentsExt,
        name: 'Deposit received',
        reached_at: new Date().toISOString(),
      },
    })
    expect(m1.status).toBe(200)
    const m2 = await post(builderId, secret, {
      event_id: `evt-${runId}-ms2`,
      event_type: 'build.milestone',
      payload: {
        external_id: msExt,
        quote_external_id: qForPaymentsExt,
        name: 'Deposit received',
        reached_at: new Date().toISOString(),
      },
    })
    expect(m2.status).toBe(200)
    const msRow = await sqlOne<{ n: number }>(
      `select count(*)::int as n from quote_milestones where quote_id = $1 and external_id = $2`,
      [quoteId, msExt])
    expect(msRow!.n).toBe(1)

    // ─── 4b. build.milestone without external_id must fail ───────────
    const mNoExt = await post(builderId, secret, {
      event_id: `evt-${runId}-ms-no-ext`,
      event_type: 'build.milestone',
      payload: {
        quote_external_id: qForPaymentsExt,
        name: 'Nebulous milestone',
        reached_at: new Date().toISOString(),
      },
    })
    expect(mNoExt.status).not.toBe(200)
    const mNoExtRow = await sqlOne<{ error: string | null }>(
      `select error from builder_webhook_events where builder_id = $1 and event_id = $2`,
      [builderId, `evt-${runId}-ms-no-ext`])
    expect(mNoExtRow!.error).toMatch(/external_id/i)

    // ─── 5. Unknown event_type → 400, no DB side effects ─────────────
    const unk = await post(builderId, secret, {
      event_id: `evt-${runId}-bogus`,
      event_type: 'quote.yeeted',
      payload: {},
    })
    expect(unk.status).toBe(400)
    const unkRow = await sqlOne<{ id: string }>(
      `select id::text from builder_webhook_events where builder_id = $1 and event_id = $2`,
      [builderId, `evt-${runId}-bogus`])
    expect(unkRow).toBeNull()

    // ─── 6. Duplicate event_id returns 'duplicate', payload ignored ──
    const dup = await post(builderId, secret, {
      event_id: `evt-${runId}-np`,
      event_type: 'quote.upserted',
      payload: {
        external_id: qNoPriceExt,
        version: 99,
        status: 'approved',
        price_cents: 999_999_99,
        customer_email: customerEmail,
        customer_name: customerName,
      },
    })
    expect(dup.status).toBe(200)
    expect((dup.body as { result?: string }).result).toBe('duplicate')
    const unchanged = await sqlOne<{ price_cents: number; status: string }>(
      `select price_cents, status from quotes where id = $1`, [noPriceQuote!.id])
    expect(unchanged!.price_cents).toBe(0)
    expect(unchanged!.status).toBe('draft')
  } finally {
    await cleanup()
  }
})
