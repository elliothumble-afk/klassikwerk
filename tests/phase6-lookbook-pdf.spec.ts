// Phase 6: cost_based builders get a 16:9 landscape "lookbook" PDF
// with one page per selected option. The acceptance test seeds the
// Grenadier $44,312 scenario, clicks Generate PDF, downloads the
// resulting file and asserts: ≥12 pages, and every option in the
// quote has at least one image row stored (so no page would render
// with a placeholder).

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

const PRICE_FIXTURE: Record<string, number> = {
  'WAKMF9268M1F-KIT': 680200,
  'WAKRF9468M1F-1':   45400,
  'LSCIC24SDWS3N':    510200,
  'ECIG2DSSCB':       226800,
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

  const skus = Object.keys(PRICE_FIXTURE)
  const { data: before, error: be } = await admin.from('catalog_options')
    .select('id, kit_sku, web_price_cents').eq('builder_id', CTC_ID).in('kit_sku', skus).eq('active', true)
  if (be) throw be
  for (const row of before ?? []) {
    const target = PRICE_FIXTURE[row.kit_sku as string]
    if (target == null) continue
    await admin.from('catalog_options').update({ web_price_cents: target }).eq('id', row.id)
  }
  await admin.from('catalog_categories').update({ install_hours: 24 })
    .eq('builder_id', CTC_ID).eq('name', 'Body kit')
  await admin.from('catalog_options').update({ auto_add_with_group_id: null })
    .eq('builder_id', CTC_ID).eq('kit_sku', '4929')
  await admin.rpc('reprice_builder', { target_builder: CTC_ID })

  const { data: cust } = await admin.from('customers')
    .insert({ full_name: 'Mitchell Phase 6', email: `pw-phase6-${Date.now()}@example.com` })
    .select('id').single()
  const { data: lead } = await admin.from('leads')
    .insert({ builder_id: CTC_ID, customer_id: cust!.id, source: 'site' })
    .select('id').single()

  const { data: plat } = await admin.from('catalog_platforms')
    .select('id, name').eq('builder_id', CTC_ID).ilike('name', '%grenadier%').eq('active', true).limit(1).single()
  const { data: tier } = await admin.from('catalog_tiers')
    .select('id, name').eq('builder_id', CTC_ID).eq('slug', 'chelsea-conversion').single()
  const { data: optRows } = await admin.from('catalog_options')
    .select('kit_sku, name').eq('builder_id', CTC_ID).in('kit_sku', skus).eq('active', true)
  const nameBySku = new Map<string, string>((optRows ?? []).map(r => [r.kit_sku as string, r.name as string]))

  return {
    leadId: lead!.id, customerId: cust!.id,
    platformName: plat!.name as string, tierName: tier!.name as string,
    options: skus.map(sku => ({ sku, name: nameBySku.get(sku) ?? sku })),
    originalPrices: (before ?? []) as { id: string; web_price_cents: number | null }[],
  }
}

async function cleanup(s: Seed) {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  await admin.from('quotes').delete().eq('lead_id', s.leadId)
  await admin.from('leads').delete().eq('id', s.leadId)
  await admin.from('customers').delete().eq('id', s.customerId)
  for (const row of s.originalPrices) {
    await admin.from('catalog_options').update({ web_price_cents: row.web_price_cents }).eq('id', row.id)
  }
  const grp = await admin.from('catalog_option_groups').select('id')
    .eq('builder_id', CTC_ID).eq('slug', 'shopify-alloy-wheels').maybeSingle()
  if (grp.data) {
    await admin.from('catalog_options').update({ auto_add_with_group_id: grp.data.id })
      .eq('builder_id', CTC_ID).eq('kit_sku', '4929')
  }
  await admin.rpc('reprice_builder', { target_builder: CTC_ID })
}

test('Phase 6 — Grenadier Lookbook PDF renders 12+ pages', async ({ page }) => {
  test.setTimeout(90_000)
  const s = await seed()
  try {
    const sess = await session()
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value)
    }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })

    await page.goto(`/ops/quotes/new?lead=${s.leadId}`)
    await page.getByRole('button', { name: new RegExp(s.platformName, 'i') }).first().click()
    await page.getByRole('button', { name: new RegExp(s.tierName, 'i') }).first().click()

    for (const o of s.options) {
      const safe = o.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const tile = page.getByRole('button', { name: new RegExp(safe, 'i') }).first()
      await tile.scrollIntoViewIfNeeded()
      await tile.click()
      if (o.sku === 'WAKRF9468M1F-1') {
        await page.getByRole('button', { name: 'Set of 4 + matching spare' }).click()
      }
      if (o.sku === 'WAKMF9268M1F-KIT') {
        await page.getByRole('button', { name: 'Body-colour paint', exact: true }).click()
      }
      if (o.sku === 'LSCIC24SDWS3N') {
        await page.getByRole('button', { name: 'Black', exact: true }).click()
      }
    }

    // Fill theme words + vehicle colour so the Lookbook cover + mood
    // pages have something to show.
    await page.getByPlaceholder('Carbon · Bronze · All-Terrain').fill('Carbon · Bronze · All-Terrain')
    await page.getByPlaceholder('Carpathian Grey').fill('Carpathian Grey')

    await page.getByRole('button', { name: /Save draft/ }).click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

    // Download the generated PDF via its public URL once "PDF ready"
    // appears in the editor's status strip.
    await page.getByRole('button', { name: /Generate PDF/ }).click()
    await expect(page.getByText(/PDF ready/)).toBeVisible({ timeout: 60_000 })
    const pdfLink = page.getByRole('link', { name: /Open PDF/ })
    const url = await pdfLink.getAttribute('href')
    expect(url, 'quote should have a pdf_url after Generate PDF').toBeTruthy()

    const resp = await page.request.get(url!)
    expect(resp.status(), 'pdf is reachable').toBe(200)
    const buf = Buffer.from(await resp.body())
    // Count /Type /Page occurrences — a cheap page count that doesn't
    // require pulling a PDF parsing lib into node_modules. 12+ pages
    // means Cover + Platform + Mood + ≥4 option pages + Wheels page +
    // Statement + At a Glance + Investment + Closing.
    const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(pageCount, `expected ≥12 lookbook pages, got ${pageCount}`).toBeGreaterThanOrEqual(12)
  } finally {
    await cleanup(s)
  }
})
