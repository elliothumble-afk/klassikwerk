// Platform-switch sanitation. Seed a Grenadier quote with Grenadier-
// only options, switch to the Defender 110, confirm the dialog, and
// assert that none of the Grenadier-only options survive on the saved
// quote_options. Also exercises the server-side guard: a direct
// REST insert of a Grenadier option onto a Defender quote must fail.

import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const SUPABASE_URL = 'https://vvuccbskbswtfvxplxxm.supabase.co'
const PROJECT_REF = 'vvuccbskbswtfvxplxxm'
const OPERATOR_EMAIL = 'elliot.humble@gmail.com'
const CTC_ID = '20000000-0000-0000-0000-000000000004'

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
const ANON = env('VITE_SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')

async function session() {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } })
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: OPERATOR_EMAIL })
  if (error) throw error
  const token_hash = (data.properties as { hashed_token: string }).hashed_token
  const verify = await anon.auth.verifyOtp({ token_hash, type: 'magiclink' })
  if (verify.error) throw verify.error
  return verify.data.session!
}

// Three Grenadier-restricted SKUs that definitely won't survive a
// switch to the Defender 110.
const GRENADIER_SKUS = ['WAKMF9268M1F-KIT', 'LSCIC24SDWS3N', 'ECIG2DSSCB']

interface Seed {
  leadId: string
  customerId: string
  quoteId: string
  grenadierPlatformId: string
  defenderPlatformId: string
  grenadierOptionIds: string[]
  defenderPlatformName: string
  grenadierOptionNames: string[]
}

async function seed(admin: SupabaseClient): Promise<Seed> {
  // Platforms.
  const [{ data: gren }, { data: def }] = await Promise.all([
    admin.from('catalog_platforms').select('id, name')
      .eq('builder_id', CTC_ID).eq('slug', 'ineos-grenadier-2023-onwards').single(),
    admin.from('catalog_platforms').select('id, name')
      .eq('builder_id', CTC_ID).eq('slug', 'land-rover-defender-110-2020-onwards').single(),
  ])
  if (!gren || !def) throw new Error('Grenadier/Defender platform rows missing')

  // Options.
  const { data: opts } = await admin.from('catalog_options')
    .select('id, kit_sku, name').eq('builder_id', CTC_ID).in('kit_sku', GRENADIER_SKUS)
  const optionIds = (opts ?? []).map(o => o.id as string)
  const optionNames = (opts ?? []).map(o => o.name as string)
  if (optionIds.length !== GRENADIER_SKUS.length) {
    throw new Error(`Expected ${GRENADIER_SKUS.length} Grenadier options, got ${optionIds.length}`)
  }

  // Scratch customer + lead + quote.
  const { data: cust } = await admin.from('customers')
    .insert({ full_name: 'PW PlatformSwitch', email: `pw-platswitch-${Date.now()}@example.com` })
    .select('id').single()
  const { data: lead } = await admin.from('leads')
    .insert({ builder_id: CTC_ID, customer_id: cust!.id, source: 'site' })
    .select('id').single()
  const { data: tier } = await admin.from('catalog_tiers')
    .select('id').eq('builder_id', CTC_ID).eq('slug', 'chelsea-conversion').single()
  const { data: quote } = await admin.from('quotes').insert({
    lead_id: lead!.id,
    builder_id: CTC_ID,
    version: 1,
    platform_id: gren!.id,
    tier_id: tier!.id,
    price_cents: 0,
    status: 'draft',
  }).select('id').single()

  // Three Grenadier-only quote_options rows.
  for (const id of optionIds) {
    const ins = await admin.from('quote_options').insert({
      quote_id: quote!.id,
      option_id: id,
      quantity: 1,
      price_cents_at_selection: 100000,
    })
    if (ins.error) throw ins.error
  }

  return {
    leadId: lead!.id,
    customerId: cust!.id,
    quoteId: quote!.id,
    grenadierPlatformId: gren!.id,
    defenderPlatformId: def!.id,
    grenadierOptionIds: optionIds,
    defenderPlatformName: def!.name as string,
    grenadierOptionNames: optionNames,
  }
}

async function cleanup(admin: SupabaseClient, s: Seed) {
  await admin.from('quotes').delete().eq('lead_id', s.leadId)
  await admin.from('leads').delete().eq('id', s.leadId)
  await admin.from('customers').delete().eq('id', s.customerId)
}

test('Phase 6 — legacy quote banner lists off-platform options and prunes on save', async ({ page }) => {
  test.setTimeout(90_000)
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  const s = await seed(admin)
  try {
    // Simulate a legacy quote: flip the quote's platform directly on
    // the quotes row (no trigger on UPDATE of quotes), leaving the
    // Grenadier-only quote_options rows pointing at the now-Defender
    // quote. The editor must prune them on load and surface a banner.
    const flip = await admin.from('quotes').update({ platform_id: s.defenderPlatformId }).eq('id', s.quoteId)
    expect(flip.error).toBeNull()

    const sess = await session()
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value)
    }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })

    await page.goto(`/ops/quotes/${s.quoteId}`)
    const banner = page.getByRole('alert')
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(banner).toContainText(new RegExp(s.defenderPlatformName, 'i'))
    for (const name of s.grenadierOptionNames) {
      await expect(banner).toContainText(name)
    }
    // No UUIDs in the banner copy.
    const text = await banner.innerText()
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)

    await page.getByRole('button', { name: /Save draft/ }).click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

    const { data: qoRows } = await admin.from('quote_options')
      .select('option_id').eq('quote_id', s.quoteId)
    const survivingIds = (qoRows ?? []).map(r => r.option_id as string)
    for (const id of s.grenadierOptionIds) {
      expect(survivingIds, `${id} should have been pruned from the saved quote`).not.toContain(id)
    }
  } finally {
    await cleanup(admin, s)
  }
})

test('Phase 6 — platform switch drops incompatible options', async ({ page }) => {
  test.setTimeout(90_000)
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  const s = await seed(admin)
  try {
    const sess = await session()
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value)
    }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })

    await page.goto(`/ops/quotes/${s.quoteId}`)
    await expect(page.getByRole('button', { name: /Save draft/ })).toBeVisible({ timeout: 20_000 })

    // Switch to the Defender 110. The dialog should appear with every
    // Grenadier-only option listed.
    await page.getByRole('button', { name: new RegExp(s.defenderPlatformName, 'i') }).first().click()
    const dialog = page.getByRole('dialog', { name: /confirm platform switch/i })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    for (const name of s.grenadierOptionNames) {
      // Each option appears somewhere in the dialog's "Not available"
      // or "Auto-added" list.
      await expect(dialog.getByText(name, { exact: false })).toBeVisible()
    }
    await dialog.getByRole('button', { name: /Switch & remove/ }).click()
    await expect(dialog).toBeHidden({ timeout: 5_000 })

    await page.getByRole('button', { name: /Save draft/ }).click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

    // Grenadier-only rows must be gone; the surviving rows (if any) are
    // all linked to the Defender 110.
    const { data: qoRows } = await admin.from('quote_options')
      .select('option_id').eq('quote_id', s.quoteId)
    const survivingIds = (qoRows ?? []).map(r => r.option_id as string)
    for (const id of s.grenadierOptionIds) {
      expect(survivingIds, `${id} should have been dropped`).not.toContain(id)
    }

    // Server-side guard: a direct insert of a Grenadier option onto
    // the now-Defender quote must be rejected.
    const guardAttempt = await admin.from('quote_options').insert({
      quote_id: s.quoteId,
      option_id: s.grenadierOptionIds[0],
      quantity: 1,
      price_cents_at_selection: 100000,
    })
    expect(guardAttempt.error, 'server guard must reject off-platform option').toBeTruthy()
    expect(String(guardAttempt.error?.message ?? '')).toMatch(/not linked to this quote/i)
  } finally {
    await cleanup(admin, s)
  }
})
