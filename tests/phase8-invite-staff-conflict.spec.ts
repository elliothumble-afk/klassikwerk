// Phase 8 safety test: invite-staff MUST NOT touch an existing
// profile. A previous bug had it overwriting the operator's own
// name + role when invited with the same email. The function now
// returns 409 "User already exists" on a known email and changes
// nothing — this spec replays that scenario.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
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

test('invite-staff: pre-existing email returns 409 and leaves profile untouched', async () => {
  test.setTimeout(120_000)
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey    = env('VITE_SUPABASE_ANON_KEY')
  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

  const runId = Math.random().toString(36).slice(2, 8)
  const opEmail     = `test-operator-${runId}@humblehouse.test`
  const opPassword  = `test-${runId}-${Math.random().toString(36).slice(2, 12)}`
  const targetEmail = 'elliot.humble@gmail.com'

  // ─── 1. Spin up a disposable operator who can call invite-staff ──
  const create = await admin.auth.admin.createUser({
    email: opEmail, password: opPassword, email_confirm: true,
    user_metadata: { full_name: `Test Operator ${runId}` },
  })
  if (create.error) throw create.error
  const opUserId = create.data.user!.id
  // Promote the auto-created profile to 'operator'.
  const promote = await admin.from('profiles').update({
    role: 'operator', full_name: `Test Operator ${runId}`, active: true,
    updated_at: new Date().toISOString(),
  } as never).eq('user_id', opUserId)
  if (promote.error) throw promote.error

  try {
    // ─── 2. Sign in to get an access JWT ──────────────────────────
    const anon = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } })
    const signIn = await anon.auth.signInWithPassword({ email: opEmail, password: opPassword })
    if (signIn.error) throw signIn.error
    const accessToken = signIn.data.session?.access_token
    if (!accessToken) throw new Error('no access token')

    // ─── 3. Snapshot the target profile BEFORE the call ───────────
    const beforeRes = await admin.from('staff_profiles')
      .select('full_name, role, active').ilike('email', targetEmail).single()
    if (beforeRes.error) throw beforeRes.error
    const before = beforeRes.data as { full_name: string | null; role: string; active: boolean }

    // ─── 4. Call invite-staff with the pre-existing email ─────────
    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-staff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ email: targetEmail, full_name: 'Elliot Overwrite', role: 'rep' }),
    })
    const body = await res.json().catch(() => ({})) as { error?: string }
    console.log(`[invite-staff] status=${res.status} body=${JSON.stringify(body)}`)

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/already exists/i)

    // ─── 5. The target profile must be unchanged ──────────────────
    const afterRes = await admin.from('staff_profiles')
      .select('full_name, role, active').ilike('email', targetEmail).single()
    if (afterRes.error) throw afterRes.error
    const after = afterRes.data as { full_name: string | null; role: string; active: boolean }

    expect(after.full_name).toBe(before.full_name)
    expect(after.role).toBe(before.role)
    expect(after.active).toBe(before.active)

    // ─── 6. Also hit the function with an all-new email as a sanity
    // check that the happy path still runs. We skip the actual
    // invite email delivery by using a @humblehouse.test address and
    // cleaning up immediately after.
    // (Only run when the inbound SMTP is in sandbox mode — Supabase
    // by default queues the email; the test cleans up the user row
    // either way.)
    const newEmail = `test-invitee-${runId}@humblehouse.test`
    const okRes = await fetch(`${SUPABASE_URL}/functions/v1/invite-staff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ email: newEmail, full_name: `Test Invitee ${runId}`, role: 'rep' }),
    })
    const okBody = await okRes.json().catch(() => ({})) as { ok?: boolean; user_id?: string; error?: string }
    console.log(`[invite-staff happy] status=${okRes.status} body=${JSON.stringify(okBody)}`)
    // Supabase project-level rate limits can 429 the invite email;
    // only assert the function's own contract: 200 → user_id set, or
    // a 4xx/5xx that's NOT the 409 for a pre-existing user.
    if (okRes.ok) {
      expect(okBody.user_id).toBeTruthy()
      // Clean up the invitee's auth user + profile.
      await admin.auth.admin.deleteUser(okBody.user_id!)
    } else {
      expect(okRes.status).not.toBe(409)
    }
  } finally {
    // ─── 7. Clean up the disposable operator ──────────────────────
    await admin.auth.admin.deleteUser(opUserId)
  }
})
