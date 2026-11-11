// Phase 9 workspace-scope follow-up: inactive builders must not
// appear in the Workspace dropdown, and a persisted selection that
// points at an inactive builder falls back to My homepage.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SUPABASE_URL = 'https://vvuccbskbswtfvxplxxm.supabase.co'
const PROJECT_REF = 'vvuccbskbswtfvxplxxm'

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

test('inactive builders are invisible in Workspace; persisted inactive pin → My homepage', async ({ page }) => {
  test.setTimeout(120_000)
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey    = env('VITE_SUPABASE_ANON_KEY')
  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

  const runId = crypto.randomBytes(3).toString('hex')
  const email = `test-wsinactive-${runId}@humblehouse.test`
  const password = `test-${runId}-${crypto.randomBytes(8).toString('hex')}`

  // Disposable operator
  const u = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (u.error) throw u.error
  const userId = u.data.user!.id
  const promote = await admin.from('profiles').update({
    role: 'operator', full_name: `Test WS ${runId}`, active: true,
    updated_at: new Date().toISOString(),
  } as never).eq('user_id', userId)
  if (promote.error) throw promote.error

  // Pick an active builder to compare against + the operator
  // id required for the inactive seed row.
  const activeBuilder = await admin.from('builders').select('id, name, operator_id').eq('active', true).limit(1).single()
  if (activeBuilder.error) throw activeBuilder.error
  const activeName = (activeBuilder.data as { name: string }).name
  const operatorId = (activeBuilder.data as { operator_id: string }).operator_id

  // Scratch inactive builder we'll toggle during the test. Named
  // Test* so it's visibly a test fixture.
  const inactiveSlug = `test-inactive-${runId}`
  const inactiveName = `Test Inactive ${runId}`
  const ins = await admin.from('builders').insert({
    operator_id: operatorId, slug: inactiveSlug, name: inactiveName,
    active: false, sort: 999, catalog_source: 'manual',
  }).select('id').single()
  if (ins.error) throw ins.error
  const inactiveId = (ins.data as { id: string }).id

  try {
    // Sign-in via session injection
    const anon = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } })
    const s = await anon.auth.signInWithPassword({ email, password })
    if (s.error) throw s.error
    const sess = s.data.session!
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value)
    }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })

    // ─── 1. Inactive builder absent from the Workspace dropdown ─────
    // Pre-pin the inactive builder in localStorage; the provider
    // should detect it's inactive and clear it, dropping the user
    // onto My homepage.
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value)
    }, { key: 'ops.selectedBuilderId', value: inactiveId })

    await page.goto('/ops')
    const select = page.getByTestId('workspace-select')
    await expect(select).toBeVisible({ timeout: 15_000 })
    // Workspace falls back to My homepage because the stored pin is inactive
    await expect(select).toHaveValue('__home__')
    // The inactive option is not rendered
    await expect(select.locator('option', { hasText: inactiveName })).toHaveCount(0)
    // The active builder IS rendered
    await expect(select.locator('option', { hasText: activeName })).toHaveCount(1)
    // The stale pin was wiped from storage too (no re-pin on reload)
    const storedAfter = await page.evaluate(() => window.localStorage.getItem('ops.selectedBuilderId'))
    expect(storedAfter).toBeNull()

    // ─── 2. Toggle the scratch builder to active → it appears ───────
    const activate = await admin.from('builders').update({ active: true }).eq('id', inactiveId)
    if (activate.error) throw activate.error
    await page.reload()
    await expect(select).toBeVisible({ timeout: 15_000 })
    await expect(select.locator('option', { hasText: inactiveName })).toHaveCount(1)

    // ─── 3. Deactivate while pinned → fallback to My homepage ──────
    await select.selectOption(inactiveId)
    await page.waitForURL('**/ops/dashboard', { timeout: 10_000 })
    await expect(select).toHaveValue(inactiveId)
    const deactivate = await admin.from('builders').update({ active: false }).eq('id', inactiveId)
    if (deactivate.error) throw deactivate.error
    // Reload: provider should see that pin resolves to inactive and clear it
    await page.reload()
    await expect(select).toBeVisible({ timeout: 15_000 })
    await expect(select).toHaveValue('__home__')
    // And on scoped routes, the pin-clear should bounce to /ops
    await page.goto('/ops/leads')
    await page.waitForURL('**/ops', { timeout: 10_000 })
  } finally {
    await admin.from('builders').delete().eq('id', inactiveId)
    await admin.auth.admin.deleteUser(userId)
  }
})
