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

interface Seed {
  leadId: string
  customerId: string
  platformName: string
  tierName: string
  tierBasePriceCents: number
  wheelName: string
  wheelPriceCents: number
}

async function seed(): Promise<Seed> {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })

  const { data: cust, error: ce } = await admin.from('customers')
    .insert({ full_name: 'Playwright Wheels', email: `pw-wheels-${Date.now()}@example.com` })
    .select('id').single()
  if (ce) throw ce

  const { data: lead, error: le } = await admin.from('leads')
    .insert({ builder_id: CTC_ID, customer_id: cust.id, source: 'site' })
    .select('id').single()
  if (le) throw le

  const { data: plat, error: pe } = await admin.from('catalog_platforms')
    .select('id, name').eq('builder_id', CTC_ID).ilike('name', '%grenadier%')
    .eq('active', true).limit(1).single()
  if (pe) throw pe

  const { data: tier, error: te } = await admin.from('catalog_tiers')
    .select('id, name, base_price_cents').eq('builder_id', CTC_ID)
    .eq('active', true).order('sort').limit(1).single()
  if (te) throw te

  // Alloy wheels group, must be a universal (platform_id null) group
  const { data: grp, error: ge } = await admin.from('catalog_option_groups')
    .select('id').eq('builder_id', CTC_ID)
    .eq('external_id', 'shopify:group:alloy-wheels').single()
  if (ge) throw ge

  // Any active wheel option linked to Grenadier platform with a non-zero price
  const { data: links, error: lke } = await admin.from('catalog_option_platforms')
    .select('option_id').eq('platform_id', plat.id)
  if (lke) throw lke
  const linkedIds = (links ?? []).map(r => r.option_id as string)
  if (linkedIds.length === 0) throw new Error('No options linked to Grenadier')

  const { data: wheels, error: we } = await admin.from('catalog_options')
    .select('id, name, price_cents').eq('group_id', grp.id)
    .eq('active', true).gt('price_cents', 0).in('id', linkedIds)
    .order('name').limit(1)
  if (we) throw we
  if (!wheels || wheels.length === 0) throw new Error('No priced Grenadier wheel options found')
  const wheel = wheels[0]

  return {
    leadId: lead.id,
    customerId: cust.id,
    platformName: plat.name as string,
    tierName: tier.name as string,
    tierBasePriceCents: (tier.base_price_cents as number | null) ?? 0,
    wheelName: wheel.name as string,
    wheelPriceCents: wheel.price_cents as number,
  }
}

async function cleanup(leadId: string, customerId: string) {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  // Any draft quotes created by the editor get cascaded via quote_options FK
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

test.describe('CTC Grenadier wheel quantity', () => {
  let s: Seed

  test.beforeAll(async () => { s = await seed() })
  test.afterAll(async () => { if (s) await cleanup(s.leadId, s.customerId) })

  test('shows Set-of chips and multiplies total by 4', async ({ page }) => {
    const session = await operatorSession()
    const storageKey = `sb-${PROJECT_REF}-auth-token`
    // Supabase-js v2 default persister writes the full session object
    // under this key. Injecting it before any script runs makes the
    // app treat the browser as signed in from first paint.
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value)
    }, { key: storageKey, value: JSON.stringify(session) })

    await page.goto(`/ops/quotes/new?lead=${s.leadId}`)

    // Step 1: pick Grenadier platform
    await page.getByRole('button', { name: new RegExp(s.platformName, 'i') }).first().click()

    // Step 2: pick a tier
    await page.getByRole('button', { name: new RegExp(s.tierName, 'i') }).first().click()

    // Step 3: pick the wheel option (the option tile is a <button>
    // containing the option name — scope by name to be unambiguous).
    const wheelTile = page.getByRole('button', { name: new RegExp(s.wheelName.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first()
    await wheelTile.scrollIntoViewIfNeeded()
    await wheelTile.click()

    // Assert both chips are rendered
    await expect(page.getByRole('button', { name: 'Set of 4', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Set of 4 + matching spare' })).toBeVisible()

    // Assert the total shows unit_price × 4 (+ tier base)
    const expectedCents = s.tierBasePriceCents + s.wheelPriceCents * 4
    const expectedLabel = `$${(expectedCents / 100).toLocaleString('en-US')}`
    await expect(page.getByText(expectedLabel, { exact: true }).first()).toBeVisible()
  })
})
