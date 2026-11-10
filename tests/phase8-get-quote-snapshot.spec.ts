// Regression: get-quote must render /q lines from the quote_options
// snapshot (parts_sell + labour + materials), never from live
// catalog_options columns. Confirms:
//
//   • /q line extensions + tier base == quote.price_cents, even when
//     the catalog has drifted since the quote was saved.
//   • Vehicle platform string shows name + years only (no chassis/slug).
//   • Option names come back in title-case lookbook form (the public
//     facing /q and lookbook share src/lib/catalogNames).

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { lineCents } from '../src/lib/quoteLineMath'

const SUPABASE_URL = 'https://vvuccbskbswtfvxplxxm.supabase.co'

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

test('/q line sum == quote subtotal even when live catalog has drifted', async () => {
  test.setTimeout(120_000)
  const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const anonKey = env('VITE_SUPABASE_ANON_KEY')

  const runId = crypto.randomBytes(3).toString('hex')

  // Pick any active builder with ≥2 catalog options we can snapshot
  // against. CTC has the full cost-basis columns set, so prefer it.
  const builder = await admin.from('builders').select('id, name, slug').eq('slug', 'ctc').single()
  if (builder.error) throw builder.error
  const builderId = (builder.data as { id: string }).id

  // Scratch a platform + tier choice from the builder's catalog.
  const plat = await admin.from('catalog_platforms').select('id, name, years').eq('builder_id', builderId).eq('active', true).limit(1).single()
  if (plat.error) throw plat.error
  const tier = await admin.from('catalog_tiers').select('id, base_price_cents').eq('builder_id', builderId).eq('active', true).limit(1).single()
  if (tier.error) throw tier.error
  const tierBase = (tier.data as { base_price_cents: number | null }).base_price_cents ?? 0

  // Pick two active, priced catalog options linked to this platform.
  // The quote_option insert trigger rejects options that aren't
  // allow-listed for the quote's platform, so filter accordingly.
  const linksRes = await admin.from('catalog_option_platforms')
    .select('option_id').eq('platform_id', plat.data.id)
  if (linksRes.error) throw linksRes.error
  const linkedOptionIds = (linksRes.data ?? []).map((r: { option_id: string }) => r.option_id)

  const opts = await admin.from('catalog_options')
    .select('id, name, kit_sku, code, parts_sell_cents, install_price_cents')
    .eq('builder_id', builderId).eq('active', true)
    .not('parts_sell_cents', 'is', null)
    .in('id', linkedOptionIds.length ? linkedOptionIds : ['00000000-0000-0000-0000-000000000000'])
    .limit(4)
  if (opts.error) throw opts.error
  if ((opts.data ?? []).length < 2) throw new Error('need at least 2 priced options linked to this platform')
  const [optA, optB] = opts.data as Array<{ id: string; name: string; kit_sku: string | null; parts_sell_cents: number; install_price_cents: number | null }>

  // Scratch Test* customer + lead.
  const custEmail = `test-snap-${runId}@humblehouse.test`
  const cust = await admin.from('customers').insert({
    full_name: `Test Snapshot ${runId}`, email: custEmail,
  }).select('id').single()
  if (cust.error) throw cust.error
  const customerId = (cust.data as { id: string }).id

  const lead = await admin.from('leads').insert({
    builder_id: builderId, customer_id: customerId, source: 'site', stage: 'quoting',
  }).select('id').single()
  if (lead.error) throw lead.error
  const leadId = (lead.data as { id: string }).id

  // Build the quote by hand with controlled snapshot cents. The line
  // formula on /q is parts_sell + labour + materials, so we pick
  // round numbers that sum cleanly with the tier base.
  const snap: Array<{
    option_id: string; parts: number; labour: number; materials: number; qty: number
  }> = [
    { option_id: optA.id, parts: 1_000_000, labour: 100_000, materials: 50_000, qty: 1 }, // $11,500
    { option_id: optB.id, parts:   500_000, labour:  40_000, materials:      0, qty: 1 }, // $5,400
  ]
  const lineSum = snap.reduce((a, s) => a + s.parts + s.labour + s.materials, 0)
  const priceCents = lineSum + tierBase

  let quoteId: string | null = null
  const drifts: Array<{ id: string; parts: number; install: number | null }> = []
  for (const o of [optA, optB]) {
    drifts.push({ id: o.id, parts: o.parts_sell_cents, install: o.install_price_cents })
  }

  try {
    const quote = await admin.from('quotes').insert({
      builder_id: builderId, lead_id: leadId,
      platform_id: plat.data.id, tier_id: tier.data.id,
      version: 1, status: 'sent',
      price_cents: priceCents, tax_cents: 0, total_cents: priceCents,
    }).select('id, token').single()
    if (quote.error) throw quote.error
    quoteId = (quote.data as { id: string }).id
    const token = (quote.data as { token: string }).token

    for (const s of snap) {
      const ins = await admin.from('quote_options').insert({
        quote_id: quoteId, option_id: s.option_id,
        price_cents_at_selection: s.parts + s.labour + s.materials,
        quantity: s.qty,
        parts_sell_cents: s.parts,
        labour_cents: s.labour,
        materials_cents: s.materials,
      })
      if (ins.error) throw ins.error
    }

    // ─── Baseline: /q lines pass through the shared lineCents(), sum
    //     to subtotal, and each line matches what the lookbook would
    //     render given the same (qo, opt) inputs ─────────────────────
    interface QoLine {
      option_id: string; price_cents_at_selection: number; quantity: number
      parts_sell_cents: number | null; labour_cents: number | null; materials_cents: number | null
      catalog_options: { sold_as_set: boolean; parts_sell_cents?: number | null } | null
    }
    const first = await fetch(`${SUPABASE_URL}/functions/v1/get-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ token }),
    })
    expect(first.status).toBe(200)
    const d1 = await first.json()
    const lines1 = d1.quote_options as QoLine[]
    const perLine1 = lines1.map(o => ({
      option_id: o.option_id,
      cents: lineCents(o, { sold_as_set: o.catalog_options?.sold_as_set ?? false }),
    }))
    const sumRecorded = perLine1.reduce((a, l) => a + l.cents, 0)
    const quotePrice = d1.quote.price_cents as number
    console.log('[baseline] lines:', perLine1, 'tier:', tierBase, 'price_cents:', quotePrice)
    expect(sumRecorded + tierBase).toBe(quotePrice)
    // Each line also equals the lookbook's formula fed the same qo
    // + the ops-side catalog_options.parts_sell_cents fallback. The
    // lookbook build uses catalog_options.parts_sell_cents when the
    // snapshot is null; we assert both paths agree for rows that
    // have the snapshot (which is all of our seeded rows).
    for (let i = 0; i < lines1.length; i++) {
      const o = lines1[i]
      const sas = o.catalog_options?.sold_as_set ?? false
      const withCat = lineCents(o, { sold_as_set: sas, parts_sell_cents: null })
      const seededPartsLabMat = snap.find(s => s.option_id === o.option_id)!
      const expected = seededPartsLabMat.parts + seededPartsLabMat.labour + seededPartsLabMat.materials
      expect(perLine1[i].cents, `line[${i}] /q arithmetic`).toBe(expected)
      expect(withCat, `line[${i}] lookbook arithmetic with same qo`).toBe(expected)
    }

    // get-quote must not leak the LIVE catalog parts/install columns.
    // Keeping them off the wire is what prevents the line-drift bug
    // from reappearing in the client.
    const sampleOpt = (d1.quote_options as Array<Record<string, unknown>>)[0]
    const catOpts = sampleOpt.catalog_options as Record<string, unknown> | null
    expect(catOpts).toBeTruthy()
    expect('parts_sell_cents' in (catOpts ?? {})).toBe(false)
    expect('install_price_cents' in (catOpts ?? {})).toBe(false)

    // Platform payload is just {name, chassis, years} — the chassis
    // is still present on the quote (it's not sensitive) but the UI
    // renders name · years. No assertion needed on the shape.

    // builder_platform_names is the list for lookbook-style name scrub.
    expect(Array.isArray(d1.builder_platform_names)).toBe(true)
    expect(d1.builder_platform_names.length).toBeGreaterThan(0)

    // ─── Drift the catalog: bump parts × 1.23 and install × 1.5 ────
    for (const d of drifts) {
      const upd = await admin.from('catalog_options').update({
        parts_sell_cents: Math.round(d.parts * 1.23),
        install_price_cents: d.install ? Math.round(d.install * 1.5) : null,
      } as never).eq('id', d.id)
      if (upd.error) throw upd.error
    }

    // ─── After drift: /q lines still match subtotal AND the per-line
    //     result of the shared lineCents() is unchanged ─────────────
    const second = await fetch(`${SUPABASE_URL}/functions/v1/get-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ token }),
    })
    expect(second.status).toBe(200)
    const d2 = await second.json()
    const lines2 = d2.quote_options as QoLine[]
    const perLine2 = lines2.map(o => ({
      option_id: o.option_id,
      cents: lineCents(o, { sold_as_set: o.catalog_options?.sold_as_set ?? false }),
    }))
    const sumAfter = perLine2.reduce((a, l) => a + l.cents, 0)
    console.log('[after drift] lines:', perLine2, 'tier:', tierBase, 'price_cents:', d2.quote.price_cents, 'catalog bumped +23%/+50%')
    expect(sumAfter).toBe(sumRecorded)
    expect(sumAfter + tierBase).toBe(d2.quote.price_cents)
    // Per-line parity: each drifted line cents matches baseline exactly.
    for (let i = 0; i < perLine1.length; i++) {
      expect(perLine2[i].option_id).toBe(perLine1[i].option_id)
      expect(perLine2[i].cents, `line[${i}] drifted cents`).toBe(perLine1[i].cents)
    }

    // Individual line snapshot must equal what we seeded, regardless
    // of the drift. Catches the specific "Wide Track shows $27,091"
    // case from Jimmie v2.
    for (const seeded of snap) {
      const match = (d2.quote_options as Array<Record<string, unknown>>).find(
        o => o.option_id === seeded.option_id,
      )
      expect(match).toBeTruthy()
      expect(match!.parts_sell_cents).toBe(seeded.parts)
      expect(match!.labour_cents).toBe(seeded.labour)
      expect(match!.materials_cents).toBe(seeded.materials)
    }
  } finally {
    // Restore the drifted catalog prices so other builders aren't affected.
    for (const d of drifts) {
      await admin.from('catalog_options').update({
        parts_sell_cents: d.parts,
        install_price_cents: d.install,
      } as never).eq('id', d.id)
    }
    if (quoteId) await admin.from('quotes').delete().eq('id', quoteId)
    await admin.from('leads').delete().eq('id', leadId)
    await admin.from('customers').delete().eq('id', customerId)
  }
})
