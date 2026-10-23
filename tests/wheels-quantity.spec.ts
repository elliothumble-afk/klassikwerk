// Playwright test: on the operator quote editor, picking a wheel on
// the CTC Grenadier platform must show the two Set-of chips AND the
// total must multiply by the default qty of 4.
//
// To run locally:
//   SUPABASE_SERVICE_ROLE_KEY=... npx playwright test
//
// The service role key is used to seed a scratch customer + lead and
// to mint a magic-link session for the operator, which is injected
// into localStorage so the browser bypasses the login screen.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
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
  if (!v) throw new Error(`${k} is required (set in shell or .env)`)
  return v
}

const ANON = env('VITE_SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')

interface PlatformSeed {
  leadId: string
  customerId: string
  platformName: string
  tierName: string
  tierBasePriceCents: number
  wheelName: string
  wheelPriceCents: number
  soldAsSet: boolean
}

async function seedForPlatform(opts: {
  platformFilter: string
  wheelFilter: { nameLike?: string; soldAsSet: boolean }
}): Promise<PlatformSeed> {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })

  const { data: cust, error: ce } = await admin.from('customers')
    .insert({ full_name: `Playwright ${opts.platformFilter}`, email: `pw-${opts.platformFilter.replace(/\s+/g, '-')}-${Date.now()}@example.com` })
    .select('id').single()
  if (ce) throw ce

  const { data: lead, error: le } = await admin.from('leads')
    .insert({ builder_id: CTC_ID, customer_id: cust.id, source: 'site' })
    .select('id').single()
  if (le) throw le

  const { data: plat, error: pe } = await admin.from('catalog_platforms')
    .select('id, name').eq('builder_id', CTC_ID).ilike('name', `%${opts.platformFilter}%`)
    .eq('active', true).limit(1).single()
  if (pe) throw pe

  const { data: tier, error: te } = await admin.from('catalog_tiers')
    .select('id, name, base_price_cents').eq('builder_id', CTC_ID)
    .eq('active', true).order('sort').limit(1).single()
  if (te) throw te

  const { data: grp, error: ge } = await admin.from('catalog_option_groups')
    .select('id').eq('builder_id', CTC_ID)
    .eq('external_id', 'shopify:group:alloy-wheels').single()
  if (ge) throw ge

  const { data: links, error: lke } = await admin.from('catalog_option_platforms')
    .select('option_id').eq('platform_id', plat.id)
  if (lke) throw lke
  const linkedIds = (links ?? []).map(r => r.option_id as string)
  if (linkedIds.length === 0) throw new Error(`No options linked to ${opts.platformFilter}`)

  let q = admin.from('catalog_options')
    .select('id, name, price_cents, sold_as_set, kit_sku').eq('group_id', grp.id)
    .eq('active', true).gt('price_cents', 0).in('id', linkedIds)
    .eq('sold_as_set', opts.wheelFilter.soldAsSet)
  if (opts.wheelFilter.nameLike) q = q.ilike('name', `%${opts.wheelFilter.nameLike}%`)
  const { data: wheels, error: we } = await q.order('name').limit(1)
  if (we) throw we
  if (!wheels || wheels.length === 0) {
    throw new Error(`No wheel options match ${JSON.stringify(opts.wheelFilter)} on ${opts.platformFilter}`)
  }
  const wheel = wheels[0]

  return {
    leadId: lead.id,
    customerId: cust.id,
    platformName: plat.name as string,
    tierName: tier.name as string,
    tierBasePriceCents: (tier.base_price_cents as number | null) ?? 0,
    wheelName: wheel.name as string,
    wheelPriceCents: wheel.price_cents as number,
    soldAsSet: Boolean(wheel.sold_as_set),
  }
}

async function cleanup(leadId: string, customerId: string) {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  await admin.from('quotes').delete().eq('lead_id', leadId)
  await admin.from('leads').delete().eq('id', leadId)
  await admin.from('customers').delete().eq('id', customerId)
}

async function operatorSession() {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } })
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: OPERATOR_EMAIL })
  if (error) throw error
  const token_hash = (data.properties as { hashed_token: string }).hashed_token
  const verify = await anon.auth.verifyOtp({ token_hash, type: 'magiclink' })
  if (verify.error) throw verify.error
  if (!verify.data.session) throw new Error('No session after verifyOtp')
  return verify.data.session
}

async function injectSession(page: import('@playwright/test').Page) {
  const session = await operatorSession()
  const storageKey = `sb-${PROJECT_REF}-auth-token`
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value)
  }, { key: storageKey, value: JSON.stringify(session) })
}

async function driveToOptions(page: import('@playwright/test').Page, s: PlatformSeed) {
  await page.goto(`/ops/quotes/new?lead=${s.leadId}`)
  await page.getByRole('button', { name: new RegExp(s.platformName, 'i') }).first().click()
  await page.getByRole('button', { name: new RegExp(s.tierName, 'i') }).first().click()
}

async function clickWheel(page: import('@playwright/test').Page, name: string) {
  // Match the full wheel name so we don't pick a prefix-sharing sibling
  // (G63 options all begin "Mercedes G-Wagon (2018 Onwards) G63 AMG").
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tile = page.getByRole('button', { name: new RegExp(safe, 'i') }).first()
  await tile.scrollIntoViewIfNeeded()
  await tile.click()
}

test.describe('CTC wheel quantity', () => {
  test('Grenadier non-kit wheel: chips appear, total = unit × 4', async ({ page }) => {
    const s = await seedForPlatform({
      platformFilter: 'grenadier',
      wheelFilter: { soldAsSet: false },
    })
    try {
      await injectSession(page)
      await driveToOptions(page, s)
      await clickWheel(page, s.wheelName)

      await expect(page.getByRole('button', { name: 'Set of 4', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Set of 4 + matching spare' })).toBeVisible()

      const expected = `$${((s.tierBasePriceCents + s.wheelPriceCents * 4) / 100).toLocaleString('en-US')}`
      await expect(page.getByText(expected, { exact: true }).first()).toBeVisible()
    } finally {
      await cleanup(s.leadId, s.customerId)
    }
  })

  test('G63 kit SKU (Type 57 Deep Concave): no chips, total = unit × 1', async ({ page }) => {
    const s = await seedForPlatform({
      platformFilter: 'G63',
      wheelFilter: { soldAsSet: true, nameLike: 'Type 57 Deep Concave' },
    })
    try {
      await injectSession(page)
      await driveToOptions(page, s)
      await clickWheel(page, s.wheelName)

      // No Set-of-5 chip (kit SKU — one price, no spare upgrade)
      await expect(page.getByRole('button', { name: 'Set of 4 + matching spare' })).toHaveCount(0)
      // The "Set of 4" sub-label under the option name is a div, not a
      // button — scope to the one that is a button (the chip) to assert
      // it's absent. Using role=button ensures we match the chip only.
      await expect(page.getByRole('button', { name: 'Set of 4', exact: true })).toHaveCount(0)

      // Total adds the kit price ONCE
      const expected = `$${((s.tierBasePriceCents + s.wheelPriceCents) / 100).toLocaleString('en-US')}`
      await expect(page.getByText(expected, { exact: true }).first()).toBeVisible()
    } finally {
      await cleanup(s.leadId, s.customerId)
    }
  })
})
