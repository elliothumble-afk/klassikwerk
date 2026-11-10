// Phase 8 security: builder_secrets must only be readable by
// operators (and service role). Anon and non-operator authenticated
// users must see 0 rows — even if the policy ever drifts to
// permissive, the column-level revoke from anon is a second barrier.

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

test('builder_secrets is readable only by operators (anon + non-op blocked)', async () => {
  test.setTimeout(120_000)
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey    = env('VITE_SUPABASE_ANON_KEY')
  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

  const runId = Math.random().toString(36).slice(2, 8)

  // ─── Seed: service role can read & write everything ──────────────
  const anyBuilder = await admin.from('builders').select('id').limit(1).single()
  if (anyBuilder.error) throw anyBuilder.error
  const builderId = (anyBuilder.data as { id: string }).id

  // Make sure a row exists so any failure to block below is visible.
  const preSeed = await admin.from('builder_secrets')
    .upsert({ builder_id: builderId, webhook_secret: 'test-secret-should-stay-hidden' },
            { onConflict: 'builder_id' })
  if (preSeed.error) throw preSeed.error

  const asService = await admin.from('builder_secrets')
    .select('builder_id, webhook_secret').eq('builder_id', builderId).single()
  if (asService.error) throw asService.error
  expect(asService.data?.webhook_secret).toBeTruthy()

  // ─── Scenario 1: anon user via REST ──────────────────────────────
  // Hit PostgREST directly with only the anon key — this is what the
  // public builder landing pages use.
  const anonList = await fetch(
    `${SUPABASE_URL}/rest/v1/builder_secrets?select=webhook_secret,catalog_source_token,catalog_source_url,backfill_url`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  const anonBody = await anonList.json()
  // Supabase returns [] when RLS filters everything, or a 401/403
  // when a column grant blocks. Either way the secret MUST NOT leak.
  console.log('[anon RLS]', anonList.status, JSON.stringify(anonBody).slice(0, 200))
  expect(JSON.stringify(anonBody)).not.toContain('test-secret-should-stay-hidden')
  if (anonList.ok) {
    expect(Array.isArray(anonBody)).toBe(true)
    expect(anonBody.length).toBe(0)
  } else {
    // 401/403 are acceptable — anon has no column grant.
    expect([401, 403, 404]).toContain(anonList.status)
  }

  // ─── Scenario 2: authenticated non-operator user ─────────────────
  const email = `test-nonop-${runId}@humblehouse.test`
  const password = `test-${runId}-${crypto.randomBytes(8).toString('hex')}`
  const create = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (create.error) throw create.error
  const userId = create.data.user!.id
  // handle_new_user auto-inserts profiles.role = 'customer'. Make sure
  // it stayed that way.
  const prof = await admin.from('profiles').select('role').eq('user_id', userId).single()
  expect(prof.data?.role).toBe('customer')

  try {
    const nonOp = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } })
    const signIn = await nonOp.auth.signInWithPassword({ email, password })
    if (signIn.error) throw signIn.error

    const nonOpRead = await nonOp.from('builder_secrets')
      .select('builder_id, webhook_secret, catalog_source_token, catalog_source_url, backfill_url')
    console.log('[non-op RLS]', nonOpRead.status, 'rows=', (nonOpRead.data ?? []).length, 'err=', nonOpRead.error?.message)
    expect(JSON.stringify(nonOpRead.data ?? [])).not.toContain('test-secret-should-stay-hidden')
    // The policy filters rather than errors — zero rows is the expected shape.
    expect((nonOpRead.data ?? []).length).toBe(0)

    // Also confirm the user cannot INSERT or UPDATE.
    const upsertAttempt = await nonOp.from('builder_secrets')
      .upsert({ builder_id: builderId, webhook_secret: 'malicious' }, { onConflict: 'builder_id' })
    expect(upsertAttempt.error, 'non-operator upsert must be rejected').toBeTruthy()
    // Service-role check: the real secret must be untouched.
    const check = await admin.from('builder_secrets')
      .select('webhook_secret').eq('builder_id', builderId).single()
    expect(check.data?.webhook_secret).toBe('test-secret-should-stay-hidden')
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }

  // ─── Belt-and-braces: builders table no longer exposes these ─────
  const anonBuilders = await fetch(
    `${SUPABASE_URL}/rest/v1/builders?id=eq.${builderId}&select=*`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  const row = (await anonBuilders.json())[0] ?? {}
  console.log('[anon builders cols]', Object.keys(row).join(','))
  expect(Object.keys(row)).not.toContain('webhook_secret')
  expect(Object.keys(row)).not.toContain('catalog_source_token')
  expect(Object.keys(row)).not.toContain('catalog_source_url')
  expect(Object.keys(row)).not.toContain('backfill_url')
})
