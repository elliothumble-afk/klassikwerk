#!/usr/bin/env node
// Export CTC's active catalog to CSV. One row per active option.
// product_type / tags / vendor come live from chelseatruckcompany.com
// because the sync doesn't persist them; everything else is from the DB.
//
// Run: SUPABASE_DB_PASSWORD=… node scripts/export-ctc-catalog.mjs
//
// The CSV lands at docs/exports/ctc-catalog.csv.

import { Client } from 'pg'
import fs from 'node:fs'
import path from 'node:path'

const SHOPIFY_BASE = 'https://chelseatruckcompany.com'
const CTC_BUILDER_ID = '20000000-0000-0000-0000-000000000004'
const OUT = path.resolve('docs/exports/ctc-catalog.csv')

function csvCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function fetchAllProducts() {
  const byHandle = new Map()
  let page = 1
  while (page <= 20) {
    const url = `${SHOPIFY_BASE}/products.json?limit=250&page=${page}`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`${url} HTTP ${r.status}`)
    const body = await r.json()
    const products = body.products ?? []
    if (products.length === 0) break
    for (const p of products) byHandle.set(p.handle, p)
    if (products.length < 250) break
    page += 1
  }
  return byHandle
}

async function main() {
  if (!process.env.SUPABASE_DB_PASSWORD) {
    throw new Error('SUPABASE_DB_PASSWORD is required')
  }

  const db = new Client({
    host: 'aws-0-us-west-2.pooler.supabase.com',
    port: 6543,
    user: 'postgres.vvuccbskbswtfvxplxxm',
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })
  await db.connect()

  // Load fx + markup so we can compute USD from the live GBP price.
  const termsRes = await db.query(
    `SELECT fx_rate, kit_markup FROM builder_terms WHERE builder_id = $1`,
    [CTC_BUILDER_ID]
  )
  const fx = Number(termsRes.rows[0]?.fx_rate ?? 1)
  const markup = Number(termsRes.rows[0]?.kit_markup ?? 1)

  // Options + group + platforms, flattened. Semicolon-join platform names.
  const sql = `
    SELECT
      o.id,
      o.name,
      o.kit_sku,
      o.external_id,
      o.sold_as_set,
      g.name AS group_name,
      g.external_id AS group_external_id,
      COALESCE(
        STRING_AGG(DISTINCT (p.name || ' (' || p.years || ')'), '; ' ORDER BY p.name || ' (' || p.years || ')'),
        ''
      ) AS platforms
    FROM catalog_options o
    JOIN catalog_option_groups g ON g.id = o.group_id
    LEFT JOIN catalog_option_platforms cp ON cp.option_id = o.id
    LEFT JOIN catalog_platforms p ON p.id = cp.platform_id
    WHERE o.builder_id = $1
      AND o.active = true
      AND o.synced = true
    GROUP BY o.id, g.id
    ORDER BY g.sort, g.name, o.name
  `
  const optRes = await db.query(sql, [CTC_BUILDER_ID])
  await db.end()

  console.log(`Loaded ${optRes.rows.length} active synced options from Supabase.`)

  const productsByHandle = await fetchAllProducts()
  console.log(`Loaded ${productsByHandle.size} products from Shopify.`)

  // Index each (handle, variant.sku) → variant so we can resolve options
  // by SKU. Shopify SKUs within a store are usually unique.
  const variantBySku = new Map()
  const productByHandleOnly = new Map(productsByHandle)
  for (const p of productsByHandle.values()) {
    for (const v of p.variants ?? []) {
      if (v.sku) variantBySku.set(v.sku.trim(), { product: p, variant: v })
    }
  }

  const header = [
    'group',
    'product_type',
    'tags',
    'vendor',
    'name',
    'kit_sku',
    'sold_as_set',
    'platforms',
    'gbp_price',
    'usd_price',
    'product_handle',
    'product_url',
  ]
  const lines = [header.map(csvCell).join(',')]

  let matched = 0
  let unmatched = 0
  for (const row of optRes.rows) {
    const sku = (row.kit_sku ?? '').trim()
    const match = sku ? variantBySku.get(sku) : null
    let product = match?.product ?? null
    let variant = match?.variant ?? null
    let handle = null

    if (!product) {
      // Fall back to parsing handle out of external_id.
      // Shape: shopify:option:<handle>[-<variant_id>]
      const m = String(row.external_id ?? '').match(/^shopify:option:(.+?)(?:-(\d{8,}))?$/)
      if (m) {
        const candidate = m[1]
        product = productByHandleOnly.get(candidate) ?? null
        handle = candidate
        if (product && m[2]) {
          variant = (product.variants ?? []).find(v => String(v.id) === m[2]) ?? null
        }
      }
    } else {
      handle = product.handle
    }

    if (product) matched += 1
    else unmatched += 1

    const tags = Array.isArray(product?.tags) ? product.tags.join('; ') : (product?.tags ?? '')
    const gbp = variant ? Number(variant.price) : (product?.variants?.[0] ? Number(product.variants[0].price) : null)
    const usd = gbp != null ? Number((gbp * fx * markup).toFixed(2)) : null
    const url = handle ? `${SHOPIFY_BASE}/products/${handle}` : ''

    lines.push([
      row.group_name,
      product?.product_type ?? '',
      tags,
      product?.vendor ?? '',
      row.name,
      row.kit_sku ?? '',
      row.sold_as_set ? 'true' : 'false',
      row.platforms,
      gbp != null ? gbp.toFixed(2) : '',
      usd != null ? usd.toFixed(2) : '',
      handle ?? '',
      url,
    ].map(csvCell).join(','))
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, lines.join('\n') + '\n')
  console.log(`Wrote ${OUT} — ${optRes.rows.length} rows (${matched} matched, ${unmatched} unmatched to Shopify).`)
}

main().catch(e => {
  console.error('export failed:', e.message)
  process.exit(1)
})
