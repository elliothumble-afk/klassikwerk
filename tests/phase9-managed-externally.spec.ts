// Phase 9 §5 — externally-managed builder mode.
//
// For builders with managed_externally = true (ECD today), the ops
// app hides catalog, builds, costing, contract and the terms-pricing
// page entirely. The only builder-scoped routes the user can reach
// are Dashboard, Leads, Quotes (list + read-only summary) and
// Settings (brand + webhook + scheduled jobs + platform aliases).
//
// This test seeds a Test* externally-managed builder, pins it via
// the Workspace dropdown, and asserts that:
//   • the sidebar shows only Dashboard / Leads / Quotes / Settings
//   • navigating to /ops/catalog, /ops/builds, /ops/quotes/new,
//     /ops/builders/:id/terms etc. redirects to /ops/dashboard
//   • the Settings route (Brand + webhook + schedule + platform
//     aliases panel) renders under the managed id
//   • toggling managed_externally back to false restores the full
//     builder menu

import { test, expect, type Page } from '@playwright/test'
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

async function signIn(page: Page, email: string, password: string, anonKey: string) {
  const anon = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } })
  const r = await anon.auth.signInWithPassword({ email, password })
  if (r.error) throw r.error
  const sess = r.data.session!
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value)
  }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })
}

test('externally-managed builders expose no catalog/build routes', async ({ page }) => {
  test.setTimeout(120_000)
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey    = env('VITE_SUPABASE_ANON_KEY')
  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

  const runId = crypto.randomBytes(3).toString('hex')
  const email = `test-mgd-${runId}@humblehouse.test`
  const password = `test-${runId}-${crypto.randomBytes(8).toString('hex')}`
  const u = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (u.error) throw u.error
  const userId = u.data.user!.id
  const promote = await admin.from('profiles').update({
    role: 'operator', full_name: `Test Managed ${runId}`, active: true,
    updated_at: new Date().toISOString(),
  } as never).eq('user_id', userId)
  if (promote.error) throw promote.error

  // Operator id needed for the builders insert.
  const op = await admin.from('builders').select('operator_id').limit(1).single()
  const operatorId = (op.data as { operator_id: string }).operator_id

  const slug = `test-managed-${runId}`
  const ins = await admin.from('builders').insert({
    operator_id: operatorId,
    slug,
    name: `Test Managed ${runId}`,
    active: true,
    sort: 999,
    catalog_source: 'connect',
    managed_externally: true,
  }).select('id').single()
  if (ins.error) throw ins.error
  const builderId = (ins.data as { id: string }).id

  try {
    await signIn(page, email, password, anonKey)
    // Pin the new builder before first paint
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value)
    }, { key: 'ops.selectedBuilderId', value: builderId })

    await page.goto('/ops/dashboard')
    const menu = page.getByTestId('ops-menu')
    await expect(menu).toBeVisible({ timeout: 15_000 })
    await expect(menu).toHaveAttribute('data-mode', 'builder')

    // Allowed items visible
    for (const label of ['Dashboard', 'Leads', 'Quotes', 'Settings']) {
      await expect(menu.getByRole('link', { name: new RegExp('^' + label + '$', 'i') })).toBeVisible()
    }
    // Forbidden items NOT visible
    for (const label of ['Builds', 'Catalog', 'Brand', 'Terms', 'Contract', 'Costing']) {
      await expect(menu.getByRole('link', { name: new RegExp('^' + label + '$', 'i') })).toHaveCount(0)
    }

    // Deep-link to each hidden route → ExternallyManagedGuard bounces
    // to /ops/dashboard. The guard uses <Navigate replace>; wait for
    // the URL to settle.
    for (const forbidden of ['/ops/catalog', '/ops/builds', '/ops/quotes/new',
                             `/ops/builders/${builderId}/terms`,
                             `/ops/builders/${builderId}/costing`,
                             `/ops/builders/${builderId}/contract`]) {
      await page.goto(forbidden)
      await page.waitForURL('**/ops/dashboard', { timeout: 10_000 })
    }

    // Settings page renders
    await page.goto(`/ops/builders/${builderId}/settings`)
    await expect(page.locator('h1', { hasText: /^Settings$/ })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('webhook-panel')).toBeVisible()
    await expect(page.locator('h2', { hasText: /Platforms.*aliases/ })).toBeVisible()

    // Toggle back to HH-managed → full menu returns
    const unm = await admin.from('builders').update({ managed_externally: false }).eq('id', builderId)
    if (unm.error) throw unm.error
    await page.goto('/ops/dashboard')
    await expect(menu).toBeVisible({ timeout: 15_000 })
    for (const label of ['Dashboard', 'Leads', 'Quotes', 'Builds', 'Catalog', 'Brand', 'Terms', 'Contract', 'Costing']) {
      await expect(menu.getByRole('link', { name: new RegExp('^' + label + '$', 'i') })).toBeVisible()
    }
    // Settings link is gone when the flag is off
    await expect(menu.getByRole('link', { name: /^Settings$/i })).toHaveCount(0)
  } finally {
    await admin.from('builders').delete().eq('id', builderId)
    await admin.auth.admin.deleteUser(userId)
  }
})
