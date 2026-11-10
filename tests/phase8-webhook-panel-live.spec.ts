// Phase 8 regression: Builder webhook panel on /ops/builders/:id/terms.
//
// Bug: on Connect-source builders where builder_terms.synced=true the
// surrounding <fieldset disabled={synced}> wrapper cascaded disabled
// onto every form control inside, including the WebhookPanel's
// Reveal / Rotate / Save / Pull buttons. Reveal silently did nothing
// because the browser ignored clicks on disabled buttons.
//
// The fix moves WebhookPanel out of the fieldset; this spec locks
// the behaviour in by:
//   • creating a disposable builder with terms.synced = true
//   • signing in as a disposable operator
//   • navigating to its /terms page
//   • asserting every Reveal / Rotate / Save / Pull control is enabled
//   • asserting Reveal toggles the code block's text content
//   • asserting Save persists backfill_url
//   • asserting Pull becomes enabled once both secret and backfill_url exist
//
// Nothing touches ECD.

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

test('WebhookPanel buttons work when builder_terms.synced=true', async ({ page }) => {
  test.setTimeout(120_000)
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey    = env('VITE_SUPABASE_ANON_KEY')
  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

  const runId = Math.random().toString(36).slice(2, 8)
  const builderSlug = `test-webhook-${runId}`
  const opEmail     = `test-op-webhook-${runId}@humblehouse.test`
  const opPassword  = `test-${runId}-${crypto.randomBytes(8).toString('hex')}`
  const seededSecret = crypto.randomBytes(32).toString('hex')

  // ─── Disposable operator ─────────────────────────────────────────
  const create = await admin.auth.admin.createUser({
    email: opEmail, password: opPassword, email_confirm: true,
    user_metadata: { full_name: `Test Op ${runId}` },
  })
  if (create.error) throw create.error
  const opUserId = create.data.user!.id
  const promote = await admin.from('profiles').update({
    role: 'operator', full_name: `Test Op ${runId}`, active: true,
    updated_at: new Date().toISOString(),
  } as never).eq('user_id', opUserId)
  if (promote.error) throw promote.error

  // ─── Disposable builder with synced=true terms ───────────────────
  // operator_id is required — reuse whatever operator row exists.
  const op = await admin.from('operators').select('id').limit(1).single()
  if (op.error) throw op.error
  const operatorId = (op.data as { id: string }).id
  const b = await admin.from('builders').insert({
    operator_id: operatorId,
    slug: builderSlug,
    name: `Test Webhook ${runId}`,
    active: true,
    catalog_source: 'connect',
  } as never).select('id').single()
  if (b.error) throw b.error
  const builderId = (b.data as { id: string }).id

  // Secrets + service URLs live on the operator-only builder_secrets
  // table now. Seed webhook_secret only — leave backfill_url null so
  // the Pull-becomes-enabled assertion exercises the real transition.
  const secretsIns = await admin.from('builder_secrets').insert({
    builder_id: builderId,
    webhook_secret: seededSecret,
    backfill_url: null,
  } as never)
  if (secretsIns.error) throw secretsIns.error

  // Minimal terms row with synced=true to re-create the fieldset-disabled condition.
  const terms = await admin.from('builder_terms').insert({
    builder_id: builderId,
    reservation_cents: 0,
    payment_schedule: [],
    currency: 'USD',
    payment_mode: 'none',
    option_mode: 'priced',
    fx_rate: 1,
    kit_markup: 1,
    synced: true,
  } as never)
  if (terms.error) throw terms.error

  try {
    // ─── Sign in via password → session → inject into localStorage ──
    const anon = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } })
    const signIn = await anon.auth.signInWithPassword({ email: opEmail, password: opPassword })
    if (signIn.error) throw signIn.error
    const sess = signIn.data.session!
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value)
    }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })

    // Intercept the native confirm() for Rotate so tests don't block.
    await page.addInitScript(() => { window.confirm = () => true })

    // ─── Navigate ───────────────────────────────────────────────────
    await page.goto(`/ops/builders/${builderId}/terms`)
    const panel = page.getByTestId('webhook-panel')
    await panel.waitFor({ state: 'visible', timeout: 30_000 })

    const reveal = page.getByTestId('webhook-reveal')
    const rotate = page.getByTestId('webhook-rotate')
    const save   = page.getByTestId('webhook-save-backfill')
    const pull   = page.getByTestId('webhook-pull')
    const display = page.getByTestId('webhook-secret-display')
    const urlInput = page.getByTestId('webhook-backfill-url')

    // ─── 1. Reveal is enabled and toggles the display ───────────────
    await expect(reveal).toBeEnabled()
    const masked = await display.textContent()
    expect(masked).toMatch(/^•+$/)
    await reveal.click()
    await expect(display).toHaveText(seededSecret, { timeout: 5_000 })
    await reveal.click()
    await expect(display).not.toHaveText(seededSecret)

    // ─── 2. Rotate is enabled (we DON'T click it — we only verify the
    //     button accepts clicks; clicking would invalidate the secret).
    await expect(rotate).toBeEnabled()

    // ─── 3. Save is disabled until the URL is edited, then enabled ──
    await expect(save).toBeDisabled()
    const newUrl = `https://example.test/${runId}/backfill`
    await urlInput.fill(newUrl)
    await expect(save).toBeEnabled()
    await save.click()
    // Poll the DB until the save lands (onSuccess resets draftBackfill
    // to null, so we can't rely on a button-state transition).
    await expect.poll(async () => {
      const after = await admin.from('builder_secrets').select('backfill_url')
        .eq('builder_id', builderId).maybeSingle()
      return after.data?.backfill_url
    }, { timeout: 10_000 }).toBe(newUrl)

    // ─── 4. Pull is enabled once both secret + backfill_url exist ───
    // The button's disabled state is bound to the cached query; invalidate
    // by a reload so react-query refetches.
    await page.reload()
    await panel.waitFor({ state: 'visible', timeout: 30_000 })
    await expect(page.getByTestId('webhook-pull')).toBeEnabled({ timeout: 15_000 })
  } finally {
    // ─── Cleanup ────────────────────────────────────────────────────
    await admin.from('builder_secrets').delete().eq('builder_id', builderId)
    await admin.from('builder_terms').delete().eq('builder_id', builderId)
    await admin.from('builders').delete().eq('id', builderId)
    await admin.auth.admin.deleteUser(opUserId)
  }
})
