// Manual helper — captures sign-in, My homepage and the CTC dashboard
// screenshots for the HH brand roll-out. Not run in CI; invoked by
// hand around the tokens.css swap to produce before/after pairs
// under docs/design/screenshots/<tag>-*.png.
//
// Usage:
//   SCREENSHOT_TAG=before npx playwright test tests/_hh-brand-screenshots.spec.ts
//   # (apply the tokens swap)
//   SCREENSHOT_TAG=after  npx playwright test tests/_hh-brand-screenshots.spec.ts

import { test } from '@playwright/test'
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

const TAG = process.env.SCREENSHOT_TAG ?? 'before'
const OUT = `docs/design/screenshots`

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true })
})

test('HH brand screenshots: sign-in, My homepage, CTC dashboard', async ({ page }) => {
  test.setTimeout(120_000)
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey    = env('VITE_SUPABASE_ANON_KEY')
  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

  await page.setViewportSize({ width: 1440, height: 900 })

  // ─── Sign-in (unauthenticated) ───────────────────────────────────
  await page.goto('/auth/login')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `${OUT}/${TAG}-signin.png`, fullPage: false })

  // ─── Seed a disposable operator + sign in ────────────────────────
  const runId = crypto.randomBytes(3).toString('hex')
  const email = `test-snap-${runId}@humblehouse.test`
  const password = `test-${runId}-${crypto.randomBytes(8).toString('hex')}`
  const u = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (u.error) throw u.error
  const userId = u.data.user!.id
  const promote = await admin.from('profiles').update({
    role: 'operator', full_name: 'Elliot Humble', active: true,
    updated_at: new Date().toISOString(),
  } as never).eq('user_id', userId)
  if (promote.error) throw promote.error

  try {
    const anon = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } })
    const s = await anon.auth.signInWithPassword({ email, password })
    if (s.error) throw s.error
    const sess = s.data.session!
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value)
    }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })
    // Force the workspace to None on first load so we land on My homepage
    await page.addInitScript(({ key }) => {
      window.localStorage.removeItem(key)
    }, { key: 'ops.selectedBuilderId' })

    // ─── My homepage ───────────────────────────────────────────────
    await page.goto('/ops')
    await page.waitForSelector('[data-testid="ops-nav"]', { timeout: 15_000 })
    // Let the dashboards' queries settle so cards have real data
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `${OUT}/${TAG}-my-homepage.png`, fullPage: true })

    // ─── CTC dashboard (per-builder) ───────────────────────────────
    const ctc = await admin.from('builders').select('id').eq('slug', 'ctc').single()
    if (!ctc.error && ctc.data) {
      // addInitScript applies on every navigation. Replace the earlier
      // "remove this key" init with a definitive "pin to CTC" set so
      // the dashboard mounts with the selector already on CTC.
      const ctcId = ctc.data.id as string
      await page.addInitScript(({ key, value }) => {
        window.localStorage.setItem(key, value)
      }, { key: 'ops.selectedBuilderId', value: ctcId })
      await page.goto('/ops/dashboard')
      await page.waitForSelector('[data-testid="ops-nav"]', { timeout: 15_000 })
      // Wait for the workspace dropdown to settle on the CTC id so
      // the shot doesn't catch mid-redirect content.
      await page.waitForFunction(
        (id) => (document.querySelector('[data-testid="workspace-select"]') as HTMLSelectElement | null)?.value === id,
        ctcId,
        { timeout: 10_000 },
      )
      await page.waitForLoadState('networkidle')
      await page.screenshot({ path: `${OUT}/${TAG}-ctc-dashboard.png`, fullPage: true })
    }
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
