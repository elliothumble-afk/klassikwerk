// Phase 8 security: pricing internals locked down.
//
//   • builder_terms — operators/ops staff only via RLS; anon reads
//     the thin builder_terms_public view (presentation fields only).
//   • catalog_options — anon can read the public subset of columns
//     only; web_price_cents / cost_cents / manual_parts_sell_cents /
//     landed_cost_cents / source_currency / origin_id etc. are
//     column-REVOKEd from anon.
//   • catalog_categories — cost fields and origin link off the anon
//     surface.
//   • origins — whole table off the anon surface (every column is
//     cost-basis).
//
// This spec runs each check with a raw REST call so there's no
// supabase-js auto-selection cleverness between us and PostgREST.

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

// PostgREST needs the project apikey header AND an Authorization
// bearer. For anon they're the same key; for an authenticated user
// we pass the project anon key as apikey + their JWT as bearer.
function headersFor(apikey: string, bearer: string): Record<string, string> {
  return { apikey, Authorization: `Bearer ${bearer}` }
}
async function status(apikey: string, bearer: string, url: string): Promise<number> {
  const r = await fetch(url, { headers: headersFor(apikey, bearer) })
  return r.status
}
async function fetchJson(apikey: string, bearer: string, url: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(url, { headers: headersFor(apikey, bearer) })
  const body = await r.json().catch(() => null)
  return { status: r.status, body }
}

test('Pricing internals are not readable by anon or portal customers', async () => {
  test.setTimeout(120_000)
  const anonKey = env('VITE_SUPABASE_ANON_KEY')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

  // ─── Anon matrix ─────────────────────────────────────────────────
  const anonBlocked = [
    `${SUPABASE_URL}/rest/v1/builder_terms?select=*&limit=1`,
    `${SUPABASE_URL}/rest/v1/builder_terms?select=labour_rate_cents&limit=1`,
    `${SUPABASE_URL}/rest/v1/builder_terms?select=commission_bonus_cents&limit=1`,
    `${SUPABASE_URL}/rest/v1/builder_terms?select=fx_rate&limit=1`,
    `${SUPABASE_URL}/rest/v1/catalog_options?select=*&limit=1`,
    `${SUPABASE_URL}/rest/v1/catalog_options?select=web_price_cents&limit=1`,
    `${SUPABASE_URL}/rest/v1/catalog_options?select=cost_cents&limit=1`,
    `${SUPABASE_URL}/rest/v1/catalog_options?select=manual_parts_sell_cents&limit=1`,
    `${SUPABASE_URL}/rest/v1/catalog_options?select=landed_cost_cents&limit=1`,
    `${SUPABASE_URL}/rest/v1/catalog_options?select=origin_id&limit=1`,
    `${SUPABASE_URL}/rest/v1/catalog_categories?select=*&limit=1`,
    `${SUPABASE_URL}/rest/v1/catalog_categories?select=freight_cents&limit=1`,
    `${SUPABASE_URL}/rest/v1/catalog_categories?select=hts_duty_pct&limit=1`,
    `${SUPABASE_URL}/rest/v1/catalog_categories?select=default_origin_id&limit=1`,
    `${SUPABASE_URL}/rest/v1/origins?select=*&limit=1`,
  ]
  for (const url of anonBlocked) {
    const s = await status(anonKey, anonKey, url)
    expect(s, `anon should be blocked on ${url.split('?')[1]}`).toBe(401)
  }

  // 200 + at least one row for the public surfaces we want publicly
  // readable. (catalog_categories currently has an operator-only RLS
  // policy too, so anon gets 200 + 0 rows — column grants are a
  // belt-and-braces barrier if that policy is ever loosened. We
  // assert the HTTP shape there but not the row count.)
  const anonAllowedWithRows: Array<[string, string]> = [
    ['builder_terms_public row', `${SUPABASE_URL}/rest/v1/builder_terms_public?select=currency,reservation_cents&limit=1`],
    ['catalog_options safe',     `${SUPABASE_URL}/rest/v1/catalog_options?select=id,name,price_cents,description&limit=1`],
  ]
  for (const [label, url] of anonAllowedWithRows) {
    const r = await fetchJson(anonKey, anonKey, url)
    expect(r.status, `${label}`).toBe(200)
    expect(Array.isArray(r.body), label).toBe(true)
    expect((r.body as unknown[]).length, label).toBeGreaterThan(0)
  }
  const catsSafe = await fetchJson(anonKey, anonKey,
    `${SUPABASE_URL}/rest/v1/catalog_categories?select=id,name,sort&limit=1`)
  expect(catsSafe.status, 'catalog_categories safe cols must be 200').toBe(200)

  // Positive check: the sensitive columns really exist at the DB
  // layer. If a future migration drops one, the "blocked" assertions
  // above would become trivially true — this catches that.
  const serviceCheck = await admin.from('builder_terms')
    .select('labour_rate_cents, commission_bonus_cents, fx_rate').limit(1).single()
  expect(serviceCheck.error).toBeNull()
  expect(serviceCheck.data?.labour_rate_cents).toBeDefined()

  // ─── Authenticated customer (portal role) ────────────────────────
  // handle_new_user stamps role='customer' on signup, so an auto-
  // created profile is the realistic "logged-in but not staff" case.
  const runId = Math.random().toString(36).slice(2, 8)
  const email = `test-cust-pricing-${runId}@humblehouse.test`
  const password = `test-${runId}-${crypto.randomBytes(8).toString('hex')}`
  const create = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (create.error) throw create.error
  const userId = create.data.user!.id

  try {
    const customer = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } })
    const signIn = await customer.auth.signInWithPassword({ email, password })
    if (signIn.error) throw signIn.error
    const custToken = signIn.data.session!.access_token

    // Customer must not read builder_terms base at all — tightened
    // RLS requires auth_can_write_builder() which only resolves for
    // profiles.role in (operator, ops) linked to the builder.
    const ctRead = await fetchJson(anonKey, custToken,
      `${SUPABASE_URL}/rest/v1/builder_terms?select=currency,labour_rate_cents&limit=1`)
    console.log('[customer builder_terms]', ctRead.status, JSON.stringify(ctRead.body).slice(0, 160))
    if (ctRead.status === 200) {
      // RLS filters rather than errors — zero rows is the shape.
      expect(Array.isArray(ctRead.body)).toBe(true)
      expect((ctRead.body as unknown[]).length).toBe(0)
    } else {
      expect([401, 403]).toContain(ctRead.status)
    }

    // ...but the public view still returns rows for them.
    const ctView = await fetchJson(anonKey, custToken,
      `${SUPABASE_URL}/rest/v1/builder_terms_public?select=currency,reservation_cents&limit=1`)
    expect(ctView.status).toBe(200)
    expect((ctView.body as unknown[]).length).toBeGreaterThan(0)
    // And the labour fields do NOT appear in the view's column set.
    const viewCols = Object.keys((ctView.body as Array<Record<string, unknown>>)[0])
    for (const hidden of ['labour_rate_cents', 'commission_bonus_cents', 'fx_rate', 'mpf_pct']) {
      expect(viewCols, `view must not expose ${hidden}`).not.toContain(hidden)
    }
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
