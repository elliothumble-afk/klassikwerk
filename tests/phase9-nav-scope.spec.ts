// Phase 9 nav rules — strict workspace scope.
//
//   (1) "My homepage" selected → menu = Home, Commissions, My
//       commissions, Operator (for admins). No builder-scoped items.
//   (2) Builder selected → menu = Dashboard, Leads, Quotes, Builds,
//       Catalog, Brand, Terms, Contract, Costing. No Home link.
//   (3) Changing the dropdown navigates immediately — /ops or
//       /ops/dashboard — and resets builder-scoped queries.
//   (4) Deep link to a builder page pins the dropdown to that builder;
//       deep link to a cross-builder page sets it to My homepage.
//   (5) Selection persists across reload (within scope).

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

async function signInAs(page: Page, email: string, password: string, anonKey: string) {
  const anon = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } })
  const r = await anon.auth.signInWithPassword({ email, password })
  if (r.error) throw r.error
  const sess = r.data.session!
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value)
  }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })
}

test('nav is strictly scoped by workspace dropdown', async ({ page }) => {
  test.setTimeout(120_000)
  const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const anonKey = env('VITE_SUPABASE_ANON_KEY')

  // Spin up a disposable operator so we never touch the operator's
  // real auth state.
  const runId = crypto.randomBytes(3).toString('hex')
  const email = `test-nav-${runId}@humblehouse.test`
  const password = `test-${runId}-${crypto.randomBytes(8).toString('hex')}`
  const u = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (u.error) throw u.error
  const userId = u.data.user!.id
  const promote = await admin.from('profiles').update({
    role: 'operator', full_name: `Test Nav ${runId}`, active: true,
    updated_at: new Date().toISOString(),
  } as never).eq('user_id', userId)
  if (promote.error) throw promote.error

  // Pick two active builders for the dropdown test (the test only
  // reads from them — no row mutation).
  const bs = await admin.from('builders').select('id, name').eq('active', true).order('name').limit(2)
  if (bs.error) throw bs.error
  const builderA = (bs.data ?? [])[0] as { id: string; name: string }
  const builderB = (bs.data ?? [])[1] as { id: string; name: string } | undefined
  expect(builderA, 'need at least one active builder').toBeTruthy()

  try {
    await signInAs(page, email, password, anonKey)

    // ─── (1) My homepage menu ──────────────────────────────────────
    await page.goto('/ops')
    const menu = page.getByTestId('ops-menu')
    await expect(menu).toBeVisible({ timeout: 15_000 })
    await expect(menu).toHaveAttribute('data-mode', 'home')
    const select = page.getByTestId('workspace-select')
    await expect(select).toHaveValue('__home__')

    // Allowed items visible
    for (const label of ['Home', 'Commissions', 'My commissions', 'Builders', 'Operator', 'Users', 'Zoho sync']) {
      await expect(menu.getByRole('link', { name: new RegExp('^' + label + '$', 'i') })).toBeVisible()
    }
    // Builder-scoped items NOT visible
    for (const label of ['Dashboard', 'Leads', 'Quotes', 'Builds', 'Catalog', 'Brand', 'Terms', 'Contract', 'Costing']) {
      await expect(menu.getByRole('link', { name: new RegExp('^' + label + '$', 'i') })).toHaveCount(0)
    }

    // ─── (3) Changing dropdown navigates immediately to dashboard ──
    await select.selectOption(builderA.id)
    await page.waitForURL('**/ops/dashboard', { timeout: 10_000 })
    await expect(menu).toHaveAttribute('data-mode', 'builder')

    // ─── (2) Builder menu ──────────────────────────────────────────
    for (const label of ['Dashboard', 'Leads', 'Quotes', 'Builds', 'Catalog', 'Brand', 'Terms', 'Contract', 'Costing']) {
      await expect(menu.getByRole('link', { name: new RegExp('^' + label + '$', 'i') })).toBeVisible()
    }
    // Cross-builder items NOT visible
    for (const label of ['Home', 'My commissions']) {
      await expect(menu.getByRole('link', { name: new RegExp('^' + label + '$', 'i') })).toHaveCount(0)
    }

    // ─── (5) Selection persists across reload on builder-scoped URL ─
    await page.goto('/ops/leads')
    await expect(select).toHaveValue(builderA.id)
    await page.reload()
    await expect(menu).toBeVisible({ timeout: 15_000 })
    await expect(select).toHaveValue(builderA.id)
    await expect(menu).toHaveAttribute('data-mode', 'builder')

    // ─── (4a) Deep link to a builder page pins the dropdown ────────
    await page.goto(`/ops/builders/${builderA.id}/brand`)
    await expect(menu).toBeVisible({ timeout: 15_000 })
    await expect(select).toHaveValue(builderA.id)
    await expect(menu).toHaveAttribute('data-mode', 'builder')

    // If a second builder exists, pin via deep link to IT and ensure
    // the selector flips even though localStorage held the other.
    if (builderB) {
      await page.goto(`/ops/builders/${builderB.id}/terms`)
      await expect(select).toHaveValue(builderB.id)
    }

    // ─── (4b) Deep link to a cross-builder page sets My homepage ───
    await page.goto('/ops/commissions')
    await expect(menu).toBeVisible({ timeout: 15_000 })
    await expect(menu).toHaveAttribute('data-mode', 'home')
    await expect(select).toHaveValue('__home__')

    // ─── (3b) Switch back to a builder from inside a cross page ────
    await select.selectOption(builderA.id)
    await page.waitForURL('**/ops/dashboard', { timeout: 10_000 })
    await expect(menu).toHaveAttribute('data-mode', 'builder')

    // ─── (3c) Switch back to My homepage via dropdown ──────────────
    await select.selectOption('__home__')
    await page.waitForURL('**/ops', { timeout: 10_000 })
    await expect(menu).toHaveAttribute('data-mode', 'home')

    // ─── (6) /ops/quotes/:id with NO pinned builder resolves the
    //        builder from the record itself and renders, instead of
    //        bouncing back to /ops. Covers bookmarks, shared links,
    //        and the raced-navigation case from /ops row clicks.
    const anyQuote = await admin.from('quotes')
      .select('id, builder_id, builder:builders(active)')
      .eq('builder_id', builderA.id).limit(1).maybeSingle()
    if (anyQuote.data?.id) {
      // Clear the pin and jump straight to the detail route.
      await page.evaluate(() => window.localStorage.removeItem('ops.selectedBuilderId'))
      await page.goto(`/ops/quotes/${anyQuote.data.id}`)
      // Should NOT redirect to /ops. Dropdown should pin to builderA
      // once the record's builder_id is resolved.
      await expect(select).toHaveValue(builderA.id, { timeout: 15_000 })
      await expect(page).toHaveURL(new RegExp(`/ops/quotes/${anyQuote.data.id}$`))
      await expect(menu).toHaveAttribute('data-mode', 'builder')
    }

    // ─── (7) /ops/quotes/<nonexistent-uuid> still bounces to /ops ─
    await page.evaluate(() => window.localStorage.removeItem('ops.selectedBuilderId'))
    await page.goto('/ops/quotes/00000000-0000-0000-0000-000000000000')
    await page.waitForURL('**/ops', { timeout: 10_000 })
    await expect(menu).toHaveAttribute('data-mode', 'home')
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})

test('/ops row click pins workspace and lands on the detail page', async ({ page }) => {
  test.setTimeout(120_000)
  const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const anonKey = env('VITE_SUPABASE_ANON_KEY')

  const runId = crypto.randomBytes(3).toString('hex')
  const email = `test-row-${runId}@humblehouse.test`
  const password = `test-${runId}-${crypto.randomBytes(8).toString('hex')}`
  const u = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (u.error) throw u.error
  const userId = u.data.user!.id
  const promote = await admin.from('profiles').update({
    role: 'operator', full_name: `Test Row ${runId}`, active: true,
    updated_at: new Date().toISOString(),
  } as never).eq('user_id', userId)
  if (promote.error) throw promote.error

  // Find a sent quote on an active builder to click through. Fall
  // back to any quote if nothing is "sent" today.
  const builders = await admin.from('builders').select('id').eq('active', true).limit(1).single()
  if (builders.error) throw builders.error
  const builderId = builders.data.id as string
  let quote = await admin.from('quotes').select('id, lead_id')
    .eq('builder_id', builderId).eq('status', 'sent').limit(1).maybeSingle()
  if (!quote.data) {
    quote = await admin.from('quotes').select('id, lead_id')
      .eq('builder_id', builderId).limit(1).maybeSingle()
  }
  if (!quote.data?.id) {
    // No quote available — skip this test rather than fail CI on a
    // seed-data assumption.
    await admin.auth.admin.deleteUser(userId)
    test.skip()
    return
  }

  try {
    await signInAs(page, email, password, anonKey)
    // Clear any persisted selection so we start on My homepage.
    await page.addInitScript(() => {
      window.localStorage.removeItem('ops.selectedBuilderId')
    })
    await page.goto('/ops')
    const menu = page.getByTestId('ops-menu')
    const select = page.getByTestId('workspace-select')
    await expect(menu).toHaveAttribute('data-mode', 'home', { timeout: 15_000 })
    await expect(select).toHaveValue('__home__')

    // Expand the Quotes sent sublist and find a row link. The sublist
    // is populated from recent sent-status quotes across builders;
    // we only care that SOME quote-row renders and that clicking it
    // pins the workspace + navigates.
    const quotesTable = page.getByTestId('my-work-quotes')
    // Section may show "All sent quotes answered." if no quote is in
    // the sent bucket — in that case this flow isn't exercisable in
    // the current data and we fall back to Recent activity.
    if (await quotesTable.locator('tbody tr').count() > 0) {
      await quotesTable.locator('tbody tr a, tbody tr button').first().click()
      await expect(page).toHaveURL(/\/ops\/quotes\/[0-9a-f-]+/i, { timeout: 10_000 })
      await expect(menu).toHaveAttribute('data-mode', 'builder', { timeout: 10_000 })
      await expect(select).not.toHaveValue('__home__')
    } else {
      // Belt-and-braces: direct nav uses the same resolver.
      await page.goto(`/ops/quotes/${quote.data.id}`)
      await expect(menu).toHaveAttribute('data-mode', 'builder', { timeout: 15_000 })
      await expect(select).toHaveValue(builderId)
    }
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
