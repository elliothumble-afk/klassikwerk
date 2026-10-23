import type { DocumentProps } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { supabase } from '@/lib/supabase'
import type {
  BuilderLike, BrandLike, TermsLike, OperatorContact,
  PlatformLike, TierLike, OptionLineForPdf,
  QuotePdfInput, ContractPdfInput, CustomerLike,
} from './types'

function money(cents: number | null | undefined): string {
  if (cents == null) return '$—'
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function pdfBlob(doc: ReactElement<DocumentProps>): Promise<Blob> {
  const { pdf } = await import('@react-pdf/renderer')
  return await pdf(doc).toBlob()
}

async function uploadPdf(path: string, blob: Blob): Promise<string> {
  const up = await supabase.storage
    .from('media')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw up.error
  const { data: pub } = supabase.storage.from('media').getPublicUrl(path)
  return pub.publicUrl
}

// ─────────────────────────────────────────────────────────────────────
// Quote
// ─────────────────────────────────────────────────────────────────────

export async function renderQuotePdfToStorage(quoteId: string): Promise<string> {
  const quoteRes = await supabase
    .from('quotes')
    .select(`
      id, version, price_cents, created_at, builder_id, platform_id, tier_id, lead_id,
      lead:leads(phone, customer:customers(full_name, email))
    `)
    .eq('id', quoteId)
    .single()
  if (quoteRes.error) throw quoteRes.error
  const quote = quoteRes.data as unknown as {
    id: string
    version: number
    price_cents: number
    created_at: string
    builder_id: string
    platform_id: string
    tier_id: string
    lead: { phone: string | null; customer: { full_name: string | null; email: string | null } | null } | null
  }

  const [builderRes, brandRes, termsRes, platformRes, tierRes, qoRes] = await Promise.all([
    supabase.from('builders').select('*, operator:operators(contact)').eq('id', quote.builder_id).single(),
    supabase.from('builder_brand').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
    supabase.from('builder_terms').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
    supabase.from('catalog_platforms').select('*').eq('id', quote.platform_id).single(),
    supabase.from('catalog_tiers').select('*').eq('id', quote.tier_id).single(),
    supabase.from('quote_options').select('option_id, price_cents_at_selection, quantity').eq('quote_id', quote.id),
  ])
  if (builderRes.error) throw builderRes.error
  if (brandRes.error) throw brandRes.error
  if (termsRes.error) throw termsRes.error
  if (platformRes.error) throw platformRes.error
  if (tierRes.error) throw tierRes.error
  if (qoRes.error) throw qoRes.error

  const builderRow = builderRes.data as unknown as BuilderLike & { operator: { contact: OperatorContact } | null }
  const brand = brandRes.data as BrandLike
  const terms = termsRes.data as TermsLike
  const platform = platformRes.data as PlatformLike
  const tier = tierRes.data as TierLike
  const qoRows = qoRes.data as { option_id: string; price_cents_at_selection: number; quantity: number }[]

  const optionIds = qoRows.map(o => o.option_id)
  const options: OptionLineForPdf[] = []
  if (optionIds.length) {
    const [optsRes, platsRes] = await Promise.all([
      supabase
        .from('catalog_options')
        .select('id, name, code, group_id, swatch_image_url, included_in_tier_ids, sold_as_set, parts_sell_cents, install_price_cents')
        .in('id', optionIds),
      supabase
        .from('catalog_option_platforms')
        .select('option_id, platform_id')
        .in('option_id', optionIds),
    ])
    if (optsRes.error) throw optsRes.error
    if (platsRes.error) throw platsRes.error
    const groupIds = Array.from(new Set((optsRes.data ?? []).map(o => o.group_id)))
    const groupsRes = await supabase
      .from('catalog_option_groups')
      .select('id, name, sort')
      .in('id', groupIds)
    if (groupsRes.error) throw groupsRes.error
    const groupById = new Map(
      (groupsRes.data ?? []).map(g => [g.id as string, { name: g.name as string, sort: g.sort as number }])
    )
    const qoByOption = new Map(qoRows.map(r => [r.option_id, r]))
    // option → platform restriction map
    const restricted = new Map<string, Set<string>>()
    for (const r of platsRes.data ?? []) {
      if (!restricted.has(r.option_id)) restricted.set(r.option_id, new Set())
      restricted.get(r.option_id)!.add(r.platform_id)
    }
    for (const o of optsRes.data ?? []) {
      // Skip options that are platform-restricted but not to this quote's platform.
      const r = restricted.get(o.id)
      if (r && r.size > 0 && !r.has(quote.platform_id)) continue
      const row = qoByOption.get(o.id)
      const oo = o as {
        sold_as_set?: boolean
        parts_sell_cents?: number | null
        install_price_cents?: number | null
      }
      options.push({
        group_name: groupById.get(o.group_id)?.name ?? 'Option',
        group_sort: groupById.get(o.group_id)?.sort ?? 0,
        name: o.name,
        code: o.code,
        swatch_image_url: o.swatch_image_url,
        price_cents_at_selection: row?.price_cents_at_selection ?? 0,
        quantity: row?.quantity ?? 1,
        sold_as_set: oo.sold_as_set ?? false,
        parts_sell_cents: oo.parts_sell_cents ?? null,
        install_price_cents: oo.install_price_cents ?? null,
        included: (o.included_in_tier_ids ?? []).includes(quote.tier_id),
      })
    }
  }

  const operatorContact: OperatorContact = builderRow.operator?.contact ?? {}

  const input: QuotePdfInput = {
    quote_id: quote.id,
    version: quote.version,
    price_cents: quote.price_cents,
    created_at: quote.created_at,
    builder: { name: builderRow.name, legal_name: builderRow.legal_name, slug: builderRow.slug },
    brand,
    terms,
    operator_contact: operatorContact,
    platform,
    tier,
    options,
    customer: (quote.lead?.customer ?? null) as CustomerLike | null,
    customer_phone: quote.lead?.phone ?? null,
    pricing_mode: ((terms as unknown as { pricing_mode?: 'simple' | 'cost_based' })?.pricing_mode) ?? 'simple',
  }

  const [{ QuotePdf }, { registerBrandFonts }] = await Promise.all([
    import('./QuotePdf'),
    import('./fonts'),
  ])
  registerBrandFonts(brand.font_display, brand.font_body)
  const blob = await pdfBlob(QuotePdf(input))

  const path = `document/quote_${quote.id}_v${quote.version}_${Date.now()}.pdf`
  const url = await uploadPdf(path, blob)
  const upd = await supabase.from('quotes').update({ pdf_url: url }).eq('id', quote.id)
  if (upd.error) throw upd.error
  return url
}

// ─────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────

export async function renderContractPdfToStorage(buildId: string): Promise<string> {
  const buildRes = await supabase
    .from('builds')
    .select('id, builder_id, platform_id, tier_id, customer_id, vehicle_id, price_cents')
    .eq('id', buildId)
    .single()
  if (buildRes.error) throw buildRes.error
  const build = buildRes.data

  const [tplRes, termsRes, builderRes, brandRes, platformRes, tierRes, buildOptsRes] = await Promise.all([
    supabase.from('contract_templates').select('*').eq('builder_id', build.builder_id).eq('is_current', true).single(),
    supabase.from('builder_terms').select('*').eq('builder_id', build.builder_id).maybeSingle(),
    supabase.from('builders').select('*, operator:operators(contact)').eq('id', build.builder_id).single(),
    supabase.from('builder_brand').select('*').eq('builder_id', build.builder_id).maybeSingle(),
    supabase.from('catalog_platforms').select('*').eq('id', build.platform_id).single(),
    supabase.from('catalog_tiers').select('*').eq('id', build.tier_id).single(),
    supabase.from('build_options').select('option_id, price_cents_at_selection, quantity').eq('build_id', build.id),
  ])
  if (tplRes.error) throw tplRes.error
  if (termsRes.error) throw termsRes.error
  if (builderRes.error) throw builderRes.error
  if (brandRes.error) throw brandRes.error
  if (platformRes.error) throw platformRes.error
  if (tierRes.error) throw tierRes.error
  if (buildOptsRes.error) throw buildOptsRes.error

  const builderRow = builderRes.data as unknown as BuilderLike & { operator: { contact: OperatorContact } | null }
  const brand = brandRes.data as BrandLike
  const platform = platformRes.data as PlatformLike
  const terms = termsRes.data as TermsLike | null

  const buildOpts = (buildOptsRes.data ?? []) as { option_id: string; price_cents_at_selection: number; quantity: number }[]
  const optionIds = buildOpts.map(bo => bo.option_id)
  let configurationTable = '| Group | Choice |\n| --- | --- |'
  if (optionIds.length) {
    const optsRes = await supabase.from('catalog_options').select('id, name, code, group_id, sold_as_set').in('id', optionIds)
    if (optsRes.error) throw optsRes.error
    const groupIds = Array.from(new Set((optsRes.data ?? []).map(o => o.group_id)))
    const groupsRes = await supabase.from('catalog_option_groups').select('id, name').in('id', groupIds)
    if (groupsRes.error) throw groupsRes.error
    const groupName = new Map<string, string>(
      (groupsRes.data ?? []).map(g => [g.id as string, g.name as string])
    )
    const qtyByOption = new Map(buildOpts.map(bo => [bo.option_id, bo.quantity ?? 1]))
    const rows = (optsRes.data ?? []).map(o => {
      const grp = groupName.get(o.group_id) ?? 'Option'
      const qty = qtyByOption.get(o.id) ?? 1
      const soldAsSet = (o as { sold_as_set?: boolean }).sold_as_set ?? false
      const qtyLabel = soldAsSet
        ? ' — Set of 4'
        : qty === 5 ? ' — Set of 5 incl. spare'
        : qty === 4 ? ' — Set of 4'
        : ''
      return `| ${grp} | ${o.name}${o.code ? ` (${o.code})` : ''}${qtyLabel} |`
    })
    configurationTable = ['| Group | Choice |', '| --- | --- |', ...rows].join('\n')
  }

  type CustomerShape = { full_name: string | null; email: string | null; address: unknown; profiles?: { full_name: string | null } | null } | null
  type VehicleShape = { vin: string | null; year: number | null } | null
  let customer: CustomerShape = null
  let profile: { full_name: string | null } | null = null
  if (build.customer_id) {
    const cr = await supabase.from('customers').select('*, profiles(*)').eq('id', build.customer_id).maybeSingle()
    if (cr.data) {
      customer = cr.data as unknown as CustomerShape
      profile = (cr.data as unknown as { profiles: { full_name: string | null } | null }).profiles
    }
  }
  let vehicle: VehicleShape = null
  if (build.vehicle_id) {
    const vr = await supabase.from('vehicles').select('vin, year').eq('id', build.vehicle_id).maybeSingle()
    vehicle = (vr.data ?? null) as VehicleShape
  }

  const addressFormatted = (() => {
    const a = customer?.address as { formatted?: string } | null | undefined
    if (!a) return '[address]'
    if (typeof a === 'string') return a
    return a.formatted ?? JSON.stringify(a)
  })()

  const { PAYMENT_SCHEDULE_SENTINEL } = await import('./types')

  const fields: Record<string, string> = {
    builder_name: builderRow.name,
    builder_legal_name: builderRow.legal_name ?? builderRow.name,
    customer_full_name: profile?.full_name ?? customer?.full_name ?? customer?.email ?? '[customer]',
    customer_address: addressFormatted,
    vehicle_platform: platform.name,
    vehicle_vin: vehicle?.vin ?? '[VIN]',
    vehicle_year: vehicle?.year?.toString() ?? '[year]',
    configuration_table: configurationTable,
    price_total: money(build.price_cents),
    payment_schedule_table: PAYMENT_SCHEDULE_SENTINEL,
    warranty_text: terms?.warranty_text ?? '',
    governing_law: terms?.governing_law ?? '',
  }

  const operatorContact: OperatorContact = builderRow.operator?.contact ?? {}

  const tpl = tplRes.data as unknown as { body_markdown: string; title: string; version: number }

  const input: ContractPdfInput = {
    build_id: build.id,
    title: tpl.title,
    version: tpl.version,
    body_markdown: tpl.body_markdown,
    merge_fields: fields,
    price_cents: build.price_cents ?? 0,
    reservation_cents: terms?.reservation_cents ?? 0,
    payment_schedule: terms?.payment_schedule ?? [],
    currency: terms?.currency ?? 'usd',
    builder: { name: builderRow.name, legal_name: builderRow.legal_name, slug: builderRow.slug },
    brand,
    operator_contact: operatorContact,
  }

  const [{ ContractPdf }, { registerBrandFonts }] = await Promise.all([
    import('./ContractPdf'),
    import('./fonts'),
  ])
  registerBrandFonts(brand.font_display, brand.font_body)
  const blob = await pdfBlob(ContractPdf(input))

  const path = `document/contract_${build.id}_v${tpl.version}_${Date.now()}.pdf`
  const url = await uploadPdf(path, blob)
  const ins = await supabase.from('media').insert({
    build_id: build.id,
    storage_path: path,
    kind: 'document',
    caption: `${tpl.title} v${tpl.version}`,
  })
  if (ins.error) throw ins.error
  return url
}
