// Phase 9d — builder commissions carry a human description.
//
// Connect sends commission.upserted with no description today. Before
// this fix /ops/commissions and /ops/me rendered those rows as "—",
// which is useless for a rep looking at their pipeline. The fix:
//
//   • Webhook composes "<customer> — <platform> · <ref> — $<total>"
//     at ingest when Connect doesn't send one and the linked quote
//     resolves. The composed description is stored on commissions.
//     description so it survives into the UI and CSV export.
//   • UI falls back to the same composer at read time for any row
//     still missing a description.
//   • Existing 9 ECD rows were backfilled by a one-off SQL update.
//
// This test seeds a Test* customer + a builder-sourced quote, posts
// a signed commission.upserted with no description, and asserts the
// DB row carries the composed description including the quote total.

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

test('builder commission description composes at ingest when Connect omits it', async () => {
  test.setTimeout(120_000)

  // Pick any active builder + one of its platforms — we need a real
  // platform row so platform:catalog_platforms resolves.
  const builder = await sqlOne<{ id: string }>(
    `select id::text from builders where active = true limit 1`)
  const plat = await sqlOne<{ id: string; name: string }>(
    `select id::text, name from catalog_platforms where builder_id = $1 limit 1`,
    [builder!.id])
  if (!builder || !plat) throw new Error('need an active builder + platform')
  const builderId = builder.id
  const platformId = plat.id
  const platformName = plat.name

  const secret = crypto.randomBytes(32).toString('hex')
  await sql(
    `insert into builder_secrets (builder_id, webhook_secret) values ($1, $2)
       on conflict (builder_id) do update set webhook_secret = excluded.webhook_secret`,
    [builderId, secret])

  const runId = Math.random().toString(36).slice(2, 8)
  const customerEmail = `test-comm-desc-${runId}@humblehouse.test`
  const customerName  = `Test Comm Desc ${runId}`
  const quoteExt      = `conn-q-${runId}-cd`
  const commExt       = `conn-cm-${runId}-cd`

  const cleanup = async () => {
    await sql(`delete from builder_webhook_events where builder_id = $1 and event_id like 'evt-${runId}-%'`, [builderId])
    await sql(`delete from commissions where builder_id = $1 and external_id = $2`, [builderId, commExt])
    const q = await sqlOne<{ id: string }>(
      `select id::text from quotes where builder_id = $1 and external_id = $2`, [builderId, quoteExt])
    if (q?.id) await sql(`delete from quotes where id = $1`, [q.id])
    await sql(`delete from customers where email = $1`, [customerEmail])
  }

  try {
    await cleanup()

    // Seed a builder-source quote with a known platform + total so the
    // composed description has every segment to produce.
    const quoteUpsert = await post(builderId, secret, {
      event_id: `evt-${runId}-q`,
      event_type: 'quote.upserted',
      payload: {
        external_id: quoteExt,
        version: 1,
        status: 'sent',
        price_cents: 125_000_00,
        tax_cents: 0,
        total_cents: 125_000_00,
        customer_email: customerEmail,
        customer_name: customerName,
        platform_name: platformName,
      },
    })
    expect(quoteUpsert.status, `quote.upserted body: ${JSON.stringify(quoteUpsert.body)}`).toBe(200)
    // Confirm the platform matched (otherwise the composed string
    // would substitute external_platform_name and fail the match).
    const seeded = await sqlOne<{ id: string; platform_id: string | null }>(
      `select id::text, platform_id::text from quotes where builder_id = $1 and external_id = $2`,
      [builderId, quoteExt])
    expect(seeded?.platform_id).toBe(platformId)

    // Now send commission.upserted with NO description. The webhook
    // should compose one and store it.
    const commUpsert = await post(builderId, secret, {
      event_id: `evt-${runId}-cm`,
      event_type: 'commission.upserted',
      payload: {
        external_id: commExt,
        quote_external_id: quoteExt,
        rep_email: 'john@humblehouseauto.com',
        amount_cents: 6_250_00,
        status: 'pending',
      },
    })
    expect(commUpsert.status, `commission.upserted body: ${JSON.stringify(commUpsert.body)}`).toBe(200)

    const comm = await sqlOne<{ description: string | null; source: string; quote_id: string | null }>(
      `select description, source, quote_id::text from commissions
         where builder_id = $1 and external_id = $2`,
      [builderId, commExt])
    expect(comm, 'commission row created').not.toBeNull()
    expect(comm!.source).toBe('builder')
    expect(comm!.quote_id).toBe(seeded!.id)
    // Composed format: "<customer> — <platform> · <ref> — $<total>"
    expect(comm!.description, `composed description: ${comm!.description}`).toContain(customerName)
    expect(comm!.description!).toContain(platformName)
    expect(comm!.description!).toContain(quoteExt)
    expect(comm!.description!).toContain('$125,000')
    // Full shape (double-check order + separators).
    expect(comm!.description!).toBe(
      `${customerName} — ${platformName} · ${quoteExt} — $125,000`)

    // Replay commission.upserted with an explicit description. Connect's
    // value must win over the composed fallback.
    const commRelabel = await post(builderId, secret, {
      event_id: `evt-${runId}-cm2`,
      event_type: 'commission.upserted',
      payload: {
        external_id: commExt,
        quote_external_id: quoteExt,
        rep_email: 'john@humblehouseauto.com',
        amount_cents: 6_250_00,
        status: 'pending',
        description: 'Connect-native description wins',
      },
    })
    expect(commRelabel.status).toBe(200)
    const after = await sqlOne<{ description: string | null }>(
      `select description from commissions where builder_id = $1 and external_id = $2`,
      [builderId, commExt])
    expect(after!.description).toBe('Connect-native description wins')
  } finally {
    await cleanup()
  }
})

test('existing 9 ECD commissions have composed descriptions after backfill', async () => {
  const rows = await sql<{ external_id: string; description: string | null }>(
    `select external_id, description from commissions
      where builder_id = '20000000-0000-0000-0000-000000000003'
        and source = 'builder'
      order by external_id`)
  expect(rows.length).toBe(9)
  for (const r of rows) {
    expect(r.description, `${r.external_id} description`).toBeTruthy()
    // Every ECD commission external_id has the form
    // "hh-comm-QV2-2026-####-X". The composed description must mention
    // the same Connect ref (sans "hh-comm-" prefix) so the UI link is
    // identifiable.
    const connectRef = r.external_id.replace(/^hh-comm-/, '')
    expect(r.description!, `${r.external_id} includes Connect ref`).toContain(connectRef)
    expect(r.description!, `${r.external_id} includes $ amount`).toMatch(/\$\d/)
  }
})
