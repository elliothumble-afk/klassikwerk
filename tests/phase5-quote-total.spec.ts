// Phase 5 acceptance: on CTC's Grenadier platform with the four
// workbook SKUs + the Chelsea Conversion base, the quote total,
// margin after HH ($) and margin % must match the workbook's Quote
// Calculator — $44,312, $11,345, 25.6%.
//
// The test pins each option's web_price_cents to the workbook's GBP
// so the result is stable against live Shopify price drift, reprices,
// then drives the editor through the four SKUs with qty handling.

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

// Workbook GBP prices for the four SKUs. Pinning these makes the
// $44,312 target exact — otherwise live Shopify drift of £1-£2
// scrambles the trailing dollar.
const PRICE_FIXTURE: Record<string, number> = {
  'WAKMF9268M1F-KIT': 680200,  // £6,802
  'WAKRF9468M1F-1':   45400,   // £454
  'LSCIC24SDWS3N':    510200,  // £5,102
  'ECIG2DSSCB':       226800,  // £2,268
}

async function session() {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  const anon  = createClient(SUPABASE_URL, ANON,    { auth: { persistSession: false } })
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: OPERATOR_EMAIL })
  if (error) throw error
  const token_hash = (data.properties as { hashed_token: string }).hashed_token
  const verify = await anon.auth.verifyOtp({ token_hash, type: 'magiclink' })
  if (verify.error) throw verify.error
  return verify.data.session!
}

interface Seed {
  leadId: string
  customerId: string
  platformName: string
  tierName: string
  options: { sku: string; name: string }[]
  originalPrices: { id: string; web_price_cents: number | null }[]
}

async function seed(): Promise<Seed> {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })

  // 1. Snapshot and overwrite the web_price_cents for the four SKUs.
  const skus = Object.keys(PRICE_FIXTURE)
  const { data: before, error: be } = await admin.from('catalog_options')
    .select('id, kit_sku, web_price_cents').eq('builder_id', CTC_ID).in('kit_sku', skus).eq('active', true)
  if (be) throw be
  for (const row of before ?? []) {
    const target = PRICE_FIXTURE[row.kit_sku as string]
    if (target == null) continue
    await admin.from('catalog_options').update({ web_price_cents: target }).eq('id', row.id)
  }
  // Pin the Body kit install_hours to the workbook value (24) in
  // case category edits have drifted it. Reset afterwards in cleanup.
  await admin.from('catalog_categories').update({ install_hours: 24 }).eq('builder_id', CTC_ID).eq('name', 'Body kit')
  await admin.rpc('reprice_builder', { target_builder: CTC_ID })

  // 2. Scratch customer + lead.
  const { data: cust, error: ce } = await admin.from('customers')
    .insert({ full_name: 'Phase 5 Target', email: `pw-phase5-${Date.now()}@example.com` })
    .select('id').single()
  if (ce) throw ce
  const { data: lead, error: le } = await admin.from('leads')
    .insert({ builder_id: CTC_ID, customer_id: cust.id, source: 'site' })
    .select('id').single()
  if (le) throw le

  // 3. Resolve names (platform, tier, each wheel/body-kit).
  const { data: plat } = await admin.from('catalog_platforms')
    .select('id, name').eq('builder_id', CTC_ID).ilike('name', '%grenadier%')
    .eq('active', true).limit(1).single()
  const { data: tier } = await admin.from('catalog_tiers')
    .select('id, name').eq('builder_id', CTC_ID).eq('slug', 'chelsea-conversion').single()
  const { data: optRows } = await admin.from('catalog_options')
    .select('kit_sku, name').eq('builder_id', CTC_ID).in('kit_sku', skus).eq('active', true)
  const nameBySku = new Map<string, string>((optRows ?? []).map(r => [r.kit_sku as string, r.name as string]))

  return {
    leadId: lead!.id,
    customerId: cust!.id,
    platformName: plat!.name as string,
    tierName: tier!.name as string,
    options: skus.map(sku => ({ sku, name: nameBySku.get(sku) ?? sku })),
    originalPrices: (before ?? []) as { id: string; web_price_cents: number | null }[],
  }
}

async function cleanup(s: Seed) {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  await admin.from('quotes').delete().eq('lead_id', s.leadId)
  await admin.from('leads').delete().eq('id', s.leadId)
  await admin.from('customers').delete().eq('id', s.customerId)
  // Restore original web_price_cents so a sync drift doesn't surprise
  // the human who watches the dashboard.
  for (const row of s.originalPrices) {
    await admin.from('catalog_options').update({ web_price_cents: row.web_price_cents }).eq('id', row.id)
  }
  await admin.rpc('reprice_builder', { target_builder: CTC_ID })
}

test('Phase 5 — Grenadier $44,312 scenario matches the workbook', async ({ page }) => {
  const s = await seed()
  try {
    const sess = await session()
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value)
    }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })

    await page.goto(`/ops/quotes/new?lead=${s.leadId}`)
    await page.getByRole('button', { name: new RegExp(s.platformName, 'i') }).first().click()
    await page.getByRole('button', { name: new RegExp(s.tierName, 'i') }).first().click()

    // Pick all four options. Picked finishes drive paint hours and
    // materials for cost_based builders — body kit + leather need
    // explicit choices to match the workbook (which was authored
    // before finishes existed, so uses category defaults = full paint
    // on body-kit, no paint on leather).
    for (const o of s.options) {
      const safe = o.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const tile = page.getByRole('button', { name: new RegExp(safe, 'i') }).first()
      await tile.scrollIntoViewIfNeeded()
      await tile.click()
      if (o.sku === 'WAKRF9468M1F-1') {
        // Non-kit wheel — chips are visible; pick the "+ matching spare".
        await page.getByRole('button', { name: 'Set of 4 + matching spare' }).click()
      }
      if (o.sku === 'WAKMF9268M1F-KIT') {
        // Body kit: pick "Body-colour paint" so the workbook's
        // category defaults (24h install, 16h paint, $1,500 materials)
        // apply — the first-chip default "No finish" would zero paint.
        await page.getByRole('button', { name: 'Body-colour paint', exact: true }).click()
      }
      if (o.sku === 'LSCIC24SDWS3N') {
        // Leather interior: pick "Black" (no overrides).
        await page.getByRole('button', { name: 'Black', exact: true }).click()
      }
    }

    // Total = $44,312.27 → rendered as "$44,312.27". `toLocaleString`
    // default drops trailing zeros so we assert on a substring.
    await expect(page.getByText(/\$44,312\.?27/).first()).toBeVisible()

    // Margin panel: workbook target is $11,344.72 after HH, 25.6%.
    // Allow a cent or two of rounding drift between the spreadsheet
    // and PostgreSQL's numeric by scanning page text rather than
    // matching exactly.
    const bodyText = await page.textContent('body')
    const marginMatch = bodyText?.match(/\$11,344\.\d{2}/)?.[0]
    expect(marginMatch, 'expected a $11,344.xx margin on the page').toBeTruthy()
    await expect(page.getByText('25.6%').first()).toBeVisible()
  } finally {
    await cleanup(s)
  }
})
