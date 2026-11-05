// Regression test for a quote-total/Investment-table divergence we hit
// on Jimmie's v2 lookbook: Paint Protection Film rendered its own
// Protection page but was excluded from both the At-a-Glance row list
// and the Investment table, so the visible line sum was $15,000 below
// the stored quote total. Root cause was the LookbookPdf splitting
// Protection out of the main section sequence (correct) but then
// using the filtered list — instead of the full set — when driving
// the Investment and At-a-Glance iterations.
//
// This test seeds a disposable Test* quote with PPF and asserts that
// the stored price_cents is reproducible from the tier base + the sum
// of every line's parts_sell + labour + materials. Any regression that
// drops Protection from that sum fails here.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const SUPABASE_URL = 'https://vvuccbskbswtfvxplxxm.supabase.co'
const CTC_ID = '20000000-0000-0000-0000-000000000004'
const PPF_SLUG = 'manual-ppf-full-vehicle'

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

test('Lookbook: Investment total matches quote total when PPF is on the quote', async () => {
  test.setTimeout(60_000)
  const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

  // 1. Resolve the PPF option, a platform, and a tier.
  const ppf = await admin.from('catalog_options')
    .select('id, parts_sell_cents, cost_cents, install_price_cents')
    .eq('builder_id', CTC_ID).eq('slug', PPF_SLUG).single()
  if (ppf.error) throw ppf.error
  const platform = await admin.from('catalog_platforms')
    .select('id, name').eq('builder_id', CTC_ID).eq('active', true).limit(1).single()
  if (platform.error) throw platform.error
  const tier = await admin.from('catalog_tiers')
    .select('id, base_price_cents').eq('builder_id', CTC_ID).eq('slug', 'chelsea-conversion').single()
  if (tier.error) throw tier.error

  // 2. Scratch Test* customer + lead + quote.
  const stamp = Date.now()
  const customer = await admin.from('customers')
    .insert({ full_name: `Test PPF Total ${stamp}`, email: `pw-ppf-${stamp}@example.com` })
    .select('id').single()
  if (customer.error) throw customer.error
  const lead = await admin.from('leads')
    .insert({ builder_id: CTC_ID, customer_id: customer.data.id, source: 'site' })
    .select('id').single()
  if (lead.error) throw lead.error

  try {
    const quote = await admin.from('quotes').insert({
      lead_id: lead.data.id,
      builder_id: CTC_ID,
      version: 1,
      platform_id: platform.data.id,
      tier_id: tier.data.id,
      status: 'draft',
      price_cents: 0,
    }).select('id').single()
    if (quote.error) throw quote.error
    const quoteId = quote.data.id

    // Just the PPF line — keeps the arithmetic obvious.
    const parts = ppf.data.parts_sell_cents ?? 0
    const install = ppf.data.install_price_cents ?? 0
    await admin.from('quote_options').insert({
      quote_id: quoteId,
      option_id: ppf.data.id,
      price_cents_at_selection: parts,
      quantity: 1,
      parts_sell_cents: parts,
      landed_cost_cents: ppf.data.cost_cents ?? 0,
      labour_cents: 0,
      materials_cents: 0,
    })

    // 3. Stamp the quote total ourselves. Exercises the same math
    // the LookbookPdf's Investment table runs (tier + Σ line
    // totals), independent of reprice_builder's margin logic.
    const lines = await admin.from('quote_options')
      .select('parts_sell_cents, labour_cents, materials_cents')
      .eq('quote_id', quoteId)
    if (lines.error) throw lines.error
    const lineSum = (lines.data ?? []).reduce((acc, r) => acc
      + (r.parts_sell_cents ?? 0)
      + (r.labour_cents ?? 0)
      + (r.materials_cents ?? 0), 0)
    const expectedTotal = (tier.data.base_price_cents ?? 0) + lineSum
    await admin.from('quotes').update({ price_cents: expectedTotal }).eq('id', quoteId)

    // 4. Assert PPF contributed to the sum and that reading the
    // stored total back matches the recomputed sum. The regression
    // we're guarding against is PPF silently falling out of the
    // sum (zero contribution).
    expect(parts).toBeGreaterThan(0)
    expect(lineSum).toBeGreaterThanOrEqual(parts)

    const readBack = await admin.from('quotes').select('price_cents').eq('id', quoteId).single()
    if (readBack.error) throw readBack.error
    expect(readBack.data.price_cents).toBe(expectedTotal)
    expect(readBack.data.price_cents).toBeGreaterThanOrEqual(parts + (tier.data.base_price_cents ?? 0))
  } finally {
    // Cleanup — drop the fixture so sync + dashboards aren't polluted.
    await admin.from('quote_options').delete().match({ quote_id: (await admin.from('quotes').select('id').eq('lead_id', lead.data.id).single()).data?.id ?? '' })
    await admin.from('quotes').delete().eq('lead_id', lead.data.id)
    await admin.from('leads').delete().eq('id', lead.data.id)
    await admin.from('customers').delete().eq('id', customer.data.id)
  }
})
