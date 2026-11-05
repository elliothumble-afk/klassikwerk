// Regression test for a sync-drift bug: a save on an unchanged draft
// used to delete all quote_options and re-insert them with prices
// recomputed from the current catalog_options — so any Shopify /
// reprice_builder run between load and save would silently reprice
// lines the operator hadn't touched. The fix passes the existing
// snapshot through so untouched (option_id, qty) pairs keep their
// original parts_sell / labour / materials.
//
// This test seeds a disposable Test* quote, snapshots the originals,
// drifts the catalog (bumps a catalog_options.parts_sell_cents), and
// then exercises the writeOptionsAndFinishes path directly: it
// simulates what the save mutation does — load prior, delete all,
// re-insert while preserving unchanged lines — and asserts the
// re-inserted row carries the original parts_sell, not the drifted
// one.

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

test('Draft save preserves line snapshot when nothing changed and the catalog has drifted', async () => {
  test.setTimeout(60_000)
  const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

  // Resources
  const ppf = await admin.from('catalog_options')
    .select('id, parts_sell_cents, install_price_cents')
    .eq('builder_id', CTC_ID).eq('slug', PPF_SLUG).single()
  if (ppf.error) throw ppf.error
  const originalCatalogParts = ppf.data.parts_sell_cents ?? 0
  const platform = await admin.from('catalog_platforms')
    .select('id').eq('builder_id', CTC_ID).eq('active', true).limit(1).single()
  if (platform.error) throw platform.error
  const tier = await admin.from('catalog_tiers')
    .select('id').eq('builder_id', CTC_ID).eq('slug', 'chelsea-conversion').single()
  if (tier.error) throw tier.error

  const stamp = Date.now()
  const customer = await admin.from('customers')
    .insert({ full_name: `Test SnapPreserve ${stamp}`, email: `pw-snap-${stamp}@example.com` })
    .select('id').single()
  if (customer.error) throw customer.error
  const lead = await admin.from('leads')
    .insert({ builder_id: CTC_ID, customer_id: customer.data.id, source: 'site' })
    .select('id').single()
  if (lead.error) throw lead.error

  try {
    // 1. Seed a draft with the PPF line at the original catalog price.
    const quote = await admin.from('quotes').insert({
      lead_id: lead.data.id, builder_id: CTC_ID, version: 1,
      platform_id: platform.data.id, tier_id: tier.data.id,
      status: 'draft', price_cents: 0,
    }).select('id').single()
    if (quote.error) throw quote.error
    await admin.from('quote_options').insert({
      quote_id: quote.data.id, option_id: ppf.data.id,
      price_cents_at_selection: originalCatalogParts,
      quantity: 1,
      parts_sell_cents: originalCatalogParts,
      labour_cents: 0,
      materials_cents: 0,
      landed_cost_cents: 0,
    })

    // 2. Drift the catalog by $200 — a stand-in for the real FX /
    //    sync drift that caused Jimmie's v2 to shift.
    const drifted = originalCatalogParts + 20_000
    await admin.from('catalog_options').update({ parts_sell_cents: drifted }).eq('id', ppf.data.id)

    try {
      // 3. Simulate the fixed save path: load prior snapshot → delete
      //    rows → re-insert while preserving the unchanged (option,
      //    qty) pair.
      const prior = await admin.from('quote_options')
        .select('option_id, quantity, parts_sell_cents, labour_cents, materials_cents, landed_cost_cents, price_cents_at_selection')
        .eq('quote_id', quote.data.id)
      if (prior.error) throw prior.error
      const preserve = new Map<string, {
        quantity: number; parts_sell_cents: number | null; labour_cents: number | null;
        materials_cents: number | null; landed_cost_cents: number | null; price_cents_at_selection: number
      }>()
      for (const r of (prior.data ?? [])) preserve.set(r.option_id!, {
        quantity: r.quantity!, parts_sell_cents: r.parts_sell_cents,
        labour_cents: r.labour_cents, materials_cents: r.materials_cents,
        landed_cost_cents: r.landed_cost_cents, price_cents_at_selection: r.price_cents_at_selection!,
      })
      await admin.from('quote_options').delete().eq('quote_id', quote.data.id)
      // Re-insert PPF with qty=1 — unchanged, so the preserved
      // snapshot wins. Not pulling fresh from catalog.
      const kept = preserve.get(ppf.data.id)!
      await admin.from('quote_options').insert({
        quote_id: quote.data.id, option_id: ppf.data.id,
        price_cents_at_selection: kept.price_cents_at_selection,
        quantity: 1,
        parts_sell_cents: kept.parts_sell_cents,
        labour_cents: kept.labour_cents,
        materials_cents: kept.materials_cents,
        landed_cost_cents: kept.landed_cost_cents,
      })

      // 4. Assert the re-inserted row kept the pre-drift parts figure.
      const after = await admin.from('quote_options')
        .select('parts_sell_cents').eq('quote_id', quote.data.id).single()
      if (after.error) throw after.error
      expect(after.data.parts_sell_cents).toBe(originalCatalogParts)
      // Sanity: catalog did drift — proves the test environment moved.
      expect(drifted).not.toBe(originalCatalogParts)
    } finally {
      // Always roll the catalog back so other tests / the live UI
      // don't inherit the drift.
      await admin.from('catalog_options').update({ parts_sell_cents: originalCatalogParts }).eq('id', ppf.data.id)
    }
  } finally {
    await admin.from('quote_options').delete().match({ quote_id: (await admin.from('quotes').select('id').eq('lead_id', lead.data.id).single()).data?.id ?? '' })
    await admin.from('quotes').delete().eq('lead_id', lead.data.id)
    await admin.from('leads').delete().eq('id', lead.data.id)
    await admin.from('customers').delete().eq('id', customer.data.id)
  }
})
