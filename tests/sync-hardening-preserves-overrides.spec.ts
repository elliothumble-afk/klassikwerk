// Sync hardening: when ops has edited description, lead image,
// category or origin on a synced option, the next sync must respect
// those overrides. We flip the per-column locks on a known Shopify
// row, call sync-builder-catalog, and assert all four survive.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const SUPABASE_URL = 'https://vvuccbskbswtfvxplxxm.supabase.co'
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
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')

interface Snap {
  optionId: string
  originalDescription: string | null
  originalLeadImageUrl: string | null
  originalCategoryId: string | null
  originalCategoryLocked: boolean
  originalOriginId: string | null
  originalOriginLocked: boolean
  originalDescriptionLocked: boolean
  originalWebPriceCents: number | null
}

test('Sync hardening — manual overrides survive a resync', async () => {
  test.setTimeout(180_000)
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })

  // Pick a stable synced Grenadier row and stash its pre-override
  // state so we can restore it in the finally block.
  const SKU = 'LSCIC24SDWS3N'
  const { data: before, error: be } = await admin.from('catalog_options')
    .select('id, description, lead_image_url, category_id, category_locked, description_locked, origin_id, origin_locked, web_price_cents')
    .eq('builder_id', CTC_ID).eq('kit_sku', SKU).single()
  if (be || !before) throw be ?? new Error('seed row not found')
  const snap: Snap = {
    optionId: before.id as string,
    originalDescription: (before as { description: string | null }).description,
    originalLeadImageUrl: (before as { lead_image_url: string | null }).lead_image_url,
    originalCategoryId: (before as { category_id: string | null }).category_id,
    originalCategoryLocked: (before as { category_locked: boolean }).category_locked,
    originalOriginId: (before as { origin_id: string | null }).origin_id,
    originalOriginLocked: (before as { origin_locked: boolean }).origin_locked,
    originalDescriptionLocked: (before as { description_locked: boolean }).description_locked,
    originalWebPriceCents: (before as { web_price_cents: number | null }).web_price_cents,
  }

  // Need one real category id and one real origin id on the builder
  // so the test can assert the sync keeps them exactly.
  const { data: cats } = await admin.from('catalog_categories')
    .select('id, name').eq('builder_id', CTC_ID).limit(2)
  const { data: origins } = await admin.from('origins')
    .select('id, name').eq('builder_id', CTC_ID).limit(1)
  const targetCategory = (cats ?? []).find(c => c.id !== snap.originalCategoryId) ?? cats?.[0]
  const targetOrigin = origins?.[0]
  if (!targetCategory || !targetOrigin) throw new Error('builder missing category/origin seed')

  // Candidate override values. The description + lead image are chosen
  // so they can't collide with Shopify's current state for this row.
  const MANUAL_DESCRIPTION = 'OPS-EDITED: handcrafted hybrid interior, ops override'
  const MANUAL_LEAD_IMAGE = 'https://example.com/ops-override.jpg'

  try {
    // Flip every override + lock in a single update.
    const flip = await admin.from('catalog_options').update({
      description: MANUAL_DESCRIPTION,
      lead_image_url: MANUAL_LEAD_IMAGE,
      category_id: targetCategory.id,
      category_locked: true,
      origin_id: targetOrigin.id,
      origin_locked: true,
      description_locked: true,
    }).eq('id', snap.optionId)
    expect(flip.error).toBeNull()

    // Run the sync.
    const r = await fetch(`${SUPABASE_URL}/functions/v1/sync-builder-catalog`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ builder_id: CTC_ID }),
    })
    expect(r.ok, `sync HTTP ${r.status}`).toBeTruthy()

    // Verify every override survived.
    const { data: after } = await admin.from('catalog_options')
      .select('description, lead_image_url, category_id, origin_id')
      .eq('id', snap.optionId).single()
    expect(after?.description, 'description override').toBe(MANUAL_DESCRIPTION)
    expect(after?.lead_image_url, 'lead_image_url override').toBe(MANUAL_LEAD_IMAGE)
    expect(after?.category_id, 'category override').toBe(targetCategory.id)
    expect(after?.origin_id, 'origin override').toBe(targetOrigin.id)
  } finally {
    // Restore the row to its pre-test state.
    await admin.from('catalog_options').update({
      description: snap.originalDescription,
      lead_image_url: snap.originalLeadImageUrl,
      category_id: snap.originalCategoryId,
      category_locked: snap.originalCategoryLocked,
      origin_id: snap.originalOriginId,
      origin_locked: snap.originalOriginLocked,
      description_locked: snap.originalDescriptionLocked,
    }).eq('id', snap.optionId)
  }
})
