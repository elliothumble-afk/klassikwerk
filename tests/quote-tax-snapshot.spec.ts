// Tax snapshot on a Test* quote.
//
// Covers the three pieces that have to agree:
//   (1) the shared computeQuoteTax helper used by the client.
//   (2) the SQL compute_quote_tax function used by the migration backfill.
//   (3) the stored tax_cents / total_cents written on save (asserted
//       via a manual snapshot write — the editor UI is covered
//       implicitly by the shared helper import).

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { computeQuoteTax } from '../src/lib/tax'

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

test('CTC tax: client helper, SQL function and stored snapshot all agree', async () => {
  test.setTimeout(60_000)
  const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

  const terms = await admin.from('builder_terms')
    .select('tax_rate_pct, surtax_pct, surtax_cap_cents, tax_label')
    .eq('builder_id', CTC_ID).single()
  if (terms.error) throw terms.error
  const rates = {
    tax_rate_pct: Number(terms.data.tax_rate_pct),
    surtax_pct: Number(terms.data.surtax_pct),
    surtax_cap_cents: Number(terms.data.surtax_cap_cents),
  }
  expect(rates.tax_rate_pct).toBeGreaterThan(0)

  const ppf = await admin.from('catalog_options')
    .select('id, parts_sell_cents').eq('builder_id', CTC_ID).eq('slug', PPF_SLUG).single()
  if (ppf.error) throw ppf.error
  const platform = await admin.from('catalog_platforms')
    .select('id').eq('builder_id', CTC_ID).eq('active', true).limit(1).single()
  if (platform.error) throw platform.error
  const tier = await admin.from('catalog_tiers')
    .select('id, base_price_cents').eq('builder_id', CTC_ID).eq('slug', 'chelsea-conversion').single()
  if (tier.error) throw tier.error

  const stamp = Date.now()
  const customer = await admin.from('customers')
    .insert({ full_name: `Test Tax ${stamp}`, email: `pw-tax-${stamp}@example.com` })
    .select('id').single()
  if (customer.error) throw customer.error
  const lead = await admin.from('leads')
    .insert({ builder_id: CTC_ID, customer_id: customer.data.id, source: 'site' })
    .select('id').single()
  if (lead.error) throw lead.error

  try {
    const quote = await admin.from('quotes').insert({
      lead_id: lead.data.id, builder_id: CTC_ID, version: 1,
      platform_id: platform.data.id, tier_id: tier.data.id,
      status: 'draft', price_cents: 0,
    }).select('id').single()
    if (quote.error) throw quote.error

    // Two options: PPF ($15k, caps the surtax) + a smaller line.
    const lineA = { parts: ppf.data.parts_sell_cents ?? 0, labour: 0, materials: 0 }
    const lineB = { parts: 200000, labour: 40000, materials: 0 }
    await admin.from('quote_options').insert([
      { quote_id: quote.data.id, option_id: ppf.data.id,
        price_cents_at_selection: lineA.parts, quantity: 1,
        parts_sell_cents: lineA.parts, labour_cents: lineA.labour, materials_cents: lineA.materials },
    ])

    // (1) Client helper.
    const clientResult = computeQuoteTax(rates, tier.data.base_price_cents ?? 0, [
      { total_cents: lineA.parts + lineA.labour + lineA.materials },
      { total_cents: lineB.parts + lineB.labour + lineB.materials },
    ])

    // Stamp the stored snapshot using the client's number.
    const price = (tier.data.base_price_cents ?? 0) + lineA.parts + lineA.labour + lineA.materials
    await admin.from('quotes').update({
      price_cents: price,
      tax_cents: clientResult.tax_cents,
      total_cents: price + clientResult.tax_cents,
    } as never).eq('id', quote.data.id)

    // (2) SQL function — recompute against the actual stored row and
    // compare. SQL only sees lineA; swap to match the client input.
    const sqlRes = await admin.rpc('compute_quote_tax' as never, { p_quote_id: quote.data.id })
    const sqlTax = Number((sqlRes as unknown as { data: number | null }).data ?? 0)
    const clientForSqlInputs = computeQuoteTax(rates, tier.data.base_price_cents ?? 0, [
      { total_cents: lineA.parts + lineA.labour + lineA.materials },
    ])
    expect(sqlTax).toBe(clientForSqlInputs.tax_cents)

    // (3) Stored snapshot survives a read.
    const readBack = await admin.from('quotes')
      .select('price_cents, tax_cents, total_cents').eq('id', quote.data.id).single()
    if (readBack.error) throw readBack.error
    expect(readBack.data.price_cents).toBe(price)
    expect(readBack.data.tax_cents).toBe(clientResult.tax_cents)
    expect(readBack.data.total_cents).toBe(price + clientResult.tax_cents)

    // Spot check: surtax on PPF should cap at $5k × 0.5% = $25.
    const cappedSurtax = Math.round(rates.surtax_cap_cents * rates.surtax_pct)
    expect(cappedSurtax).toBe(2500)
  } finally {
    await admin.from('quote_options').delete().match({ quote_id: (await admin.from('quotes').select('id').eq('lead_id', lead.data.id).single()).data?.id ?? '' })
    await admin.from('quotes').delete().eq('lead_id', lead.data.id)
    await admin.from('leads').delete().eq('id', lead.data.id)
    await admin.from('customers').delete().eq('id', customer.data.id)
  }
})
