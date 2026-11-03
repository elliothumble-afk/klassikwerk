import type { DocumentProps } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { supabase } from '@/lib/supabase'
import type {
  BuilderLike, BrandLike, TermsLike, OperatorContact,
  PlatformLike, TierLike, OptionLineForPdf,
  QuotePdfInput, ContractPdfInput, CustomerLike,
  LookbookPdfInput, LookbookOption, LookbookTyre,
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
      theme_words, vehicle_colour,
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
    theme_words: string | null
    vehicle_colour: string | null
    lead: { phone: string | null; customer: { full_name: string | null; email: string | null } | null } | null
  }

  // Peek at pricing mode — cost_based builders get the Lookbook PDF.
  const modeRes = await supabase.from('builder_terms')
    .select('pricing_mode').eq('builder_id', quote.builder_id).maybeSingle()
  if ((modeRes.data as { pricing_mode?: 'simple' | 'cost_based' } | null)?.pricing_mode === 'cost_based') {
    return renderLookbookPdfToStorage(quoteId)
  }

  const [builderRes, brandRes, termsRes, platformRes, tierRes, qoRes] = await Promise.all([
    supabase.from('builders').select('*, operator:operators(contact)').eq('id', quote.builder_id).single(),
    supabase.from('builder_brand').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
    supabase.from('builder_terms').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
    supabase.from('catalog_platforms').select('*').eq('id', quote.platform_id).single(),
    supabase.from('catalog_tiers').select('*').eq('id', quote.tier_id).single(),
    supabase.from('quote_options').select('id, option_id, price_cents_at_selection, quantity, finish_note, quote_option_finishes(finish_set_id, finish_id, catalog_finish_sets(sort), catalog_finishes(name))').eq('quote_id', quote.id),
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
  interface QoFinishRow { finish_set_id: string; finish_id: string; catalog_finish_sets: { sort: number } | null; catalog_finishes: { name: string } | null }
  const qoRows = qoRes.data as unknown as { id: string; option_id: string; price_cents_at_selection: number; quantity: number; finish_note: string | null; quote_option_finishes: QoFinishRow[] }[]

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
      // Order finish names by their set's sort so the display is
      // stable: "Interior colour, Interior pattern" not reversed.
      const finishNames = ((row?.quote_option_finishes ?? [])
        .slice()
        .sort((a, b) => (a.catalog_finish_sets?.sort ?? 0) - (b.catalog_finish_sets?.sort ?? 0))
        .map(r => r.catalog_finishes?.name)
        .filter((v): v is string => !!v))
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
        finish_names: finishNames,
        finish_note: row?.finish_note ?? null,
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
    .select('id, builder_id, platform_id, tier_id, customer_id, vehicle_id, price_cents, quote_id')
    .eq('id', buildId)
    .single()
  if (buildRes.error) throw buildRes.error
  const build = buildRes.data

  const [tplRes, termsRes, builderRes, brandRes, platformRes, tierRes, buildOptsRes, finishesSnapshotRes] = await Promise.all([
    supabase.from('contract_templates').select('*').eq('builder_id', build.builder_id).eq('is_current', true).single(),
    supabase.from('builder_terms').select('*').eq('builder_id', build.builder_id).maybeSingle(),
    supabase.from('builders').select('*, operator:operators(contact)').eq('id', build.builder_id).single(),
    supabase.from('builder_brand').select('*').eq('builder_id', build.builder_id).maybeSingle(),
    supabase.from('catalog_platforms').select('*').eq('id', build.platform_id).single(),
    supabase.from('catalog_tiers').select('*').eq('id', build.tier_id).single(),
    supabase.from('build_options').select('option_id, price_cents_at_selection, quantity').eq('build_id', build.id),
    // Finish snapshots live on quote_options; the contract carries
    // them forward via builds.quote_id.
    build.quote_id
      ? supabase.from('quote_options').select('option_id, finish_note, quote_option_finishes(finish_set_id, catalog_finish_sets(sort), catalog_finishes(name))').eq('quote_id', build.quote_id)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])
  if (tplRes.error) throw tplRes.error
  if (termsRes.error) throw termsRes.error
  if (builderRes.error) throw builderRes.error
  if (brandRes.error) throw brandRes.error
  if (platformRes.error) throw platformRes.error
  if (tierRes.error) throw tierRes.error
  if (buildOptsRes.error) throw buildOptsRes.error
  if ('error' in finishesSnapshotRes && finishesSnapshotRes.error) throw finishesSnapshotRes.error

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
    interface SnapRow { option_id: string; finish_note: string | null; quote_option_finishes: { catalog_finish_sets: { sort: number } | null; catalog_finishes: { name: string } | null }[] }
    const finishByOption = new Map<string, { names: string[]; note: string | null }>()
    for (const r of (finishesSnapshotRes.data ?? []) as unknown as SnapRow[]) {
      const names = (r.quote_option_finishes ?? [])
        .slice()
        .sort((a, b) => (a.catalog_finish_sets?.sort ?? 0) - (b.catalog_finish_sets?.sort ?? 0))
        .map(x => x.catalog_finishes?.name)
        .filter((v): v is string => !!v)
      finishByOption.set(r.option_id, { names, note: r.finish_note })
    }
    const rows = (optsRes.data ?? []).map(o => {
      const grp = groupName.get(o.group_id) ?? 'Option'
      const qty = qtyByOption.get(o.id) ?? 1
      const soldAsSet = (o as { sold_as_set?: boolean }).sold_as_set ?? false
      const qtyLabel = soldAsSet
        ? ' — Set of 4'
        : qty === 5 ? ' — Set of 5 incl. spare'
        : qty === 4 ? ' — Set of 4'
        : ''
      const fin = finishByOption.get(o.id)
      const parts: string[] = [...(fin?.names ?? [])]
      if (fin?.note) parts.push(fin.note)
      const finishLabel = parts.length ? ` — ${parts.join(', ')}` : ''
      return `| ${grp} | ${o.name}${finishLabel}${o.code ? ` (${o.code})` : ''}${qtyLabel} |`
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

// ─────────────────────────────────────────────────────────────────────
// Lookbook (cost_based builders)
// ─────────────────────────────────────────────────────────────────────

/** Phase 6: cost_based builders get a 16:9 landscape "lookbook"
 *  quote PDF with one image-led page per selected option. */
export async function renderLookbookPdfToStorage(quoteId: string): Promise<string> {
  const qRes = await supabase.from('quotes')
    .select(`
      id, version, price_cents, created_at, builder_id, platform_id, tier_id, lead_id,
      theme_words, vehicle_colour, vehicle_colour_hex, vehicle_year, vehicle_photo_url,
      lead:leads(phone, customer:customers(full_name, email))
    `)
    .eq('id', quoteId).single()
  if (qRes.error) throw qRes.error
  const quote = qRes.data as unknown as {
    id: string; version: number; price_cents: number; created_at: string
    builder_id: string; platform_id: string; tier_id: string
    theme_words: string | null; vehicle_colour: string | null
    vehicle_colour_hex: string | null; vehicle_year: number | null; vehicle_photo_url: string | null
    lead: { phone: string | null; customer: { full_name: string | null; email: string | null } | null } | null
  }

  const [builderRes, brandRes, termsRes, platformRes, allPlatformsRes, tierRes, qoRes, eventsRes] = await Promise.all([
    supabase.from('builders').select('*, operator:operators(contact)').eq('id', quote.builder_id).single(),
    supabase.from('builder_brand').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
    supabase.from('builder_terms').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
    supabase.from('catalog_platforms').select('*').eq('id', quote.platform_id).single(),
    supabase.from('catalog_platforms').select('name').eq('builder_id', quote.builder_id),
    supabase.from('catalog_tiers').select('*').eq('id', quote.tier_id).single(),
    // install_price_cents lives on catalog_options; here we read the
    // per-line snapshot (parts × qty + labour + materials = line price).
    supabase.from('quote_options')
      .select('id, option_id, quantity, finish_note, parts_sell_cents, labour_cents, materials_cents, price_cents_at_selection, quote_option_finishes(finish_set_id, finish_id, catalog_finish_sets(name, sort), catalog_finishes(name, swatch_hex))')
      .eq('quote_id', quote.id),
    // Who sent/created the quote? Grab the most recent sent-or-created
    // event with a by_profile_id for the Closing sign-off.
    supabase.from('quote_events')
      .select('kind, by_profile_id, created_at')
      .eq('quote_id', quote.id)
      .in('kind', ['sent', 'created'])
      .not('by_profile_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1),
  ])
  if (builderRes.error) throw builderRes.error
  if (brandRes.error) throw brandRes.error
  if (termsRes.error) throw termsRes.error
  if (platformRes.error) throw platformRes.error
  if (allPlatformsRes.error) throw allPlatformsRes.error
  if (tierRes.error) throw tierRes.error
  if (qoRes.error) throw qoRes.error
  if (eventsRes.error) throw eventsRes.error

  type BrandWithLookbook = BrandLike & { lookbook_statement: string | null }
  type PlatformWithLookbook = PlatformLike & { lookbook_copy: string | null }
  const builderRow = builderRes.data as unknown as BuilderLike & { operator: { contact: OperatorContact } | null }
  const brand = brandRes.data as unknown as BrandWithLookbook
  const terms = termsRes.data as TermsLike
  const platform = platformRes.data as unknown as PlatformWithLookbook
  const tier = tierRes.data as TierLike

  // Ops signer — profile row behind the most recent sent/created event.
  let signerName: string | null = null
  let signerTitle: string | null = null
  let signerPhone: string | null = null
  let signerEmail: string | null = null
  const senderId = ((eventsRes.data ?? []) as { by_profile_id: string | null }[])?.[0]?.by_profile_id
  if (senderId) {
    const pRes = await supabase.from('profiles')
      .select('full_name, title, phone, user_id')
      .eq('id', senderId).maybeSingle()
    if (pRes.data) {
      const p = pRes.data as { full_name: string | null; title: string | null; phone: string | null; user_id: string }
      signerName = p.full_name
      signerTitle = p.title
      signerPhone = p.phone
      // Email lives on auth.users — the admin can't be queried from the
      // browser, so fall back to the operator contact email below.
    }
  }
  const operatorContact: OperatorContact = builderRow.operator?.contact ?? {}
  signerEmail = signerEmail ?? operatorContact.email ?? null
  signerPhone = signerPhone ?? operatorContact.phone ?? null
  signerName  = signerName  ?? operatorContact.person ?? null
  signerTitle = signerTitle ?? null

  // ─── Option enrichment ───────────────────────────────────────────
  interface QoFinishRow {
    finish_set_id: string; finish_id: string
    catalog_finish_sets: { name: string; sort: number } | null
    catalog_finishes: { name: string; swatch_hex: string | null } | null
  }
  const qoRows = qoRes.data as unknown as {
    id: string; option_id: string; quantity: number; finish_note: string | null
    parts_sell_cents: number | null; labour_cents: number | null; materials_cents: number | null
    price_cents_at_selection: number
    quote_option_finishes: QoFinishRow[]
  }[]

  const optionIds = qoRows.map(r => r.option_id)
  if (optionIds.length === 0) throw new Error('Quote has no options — nothing to put in the lookbook.')

  // Finish-image overrides (interior leather + pattern). Pulled
  // builder-wide once and resolved per-option in a ladder:
  //  (platform, colour, pattern) → (colour, pattern) → (pattern) → option image.
  // Rows written by the sync are source='shopify'; ops uploads are
  // 'manual' and take precedence at the same specificity level.
  const finishImagesRes = await supabase.from('catalog_finish_images')
    .select('finish_id, pattern_finish_id, platform_id, image_url, source, source_colour_label')
    .eq('builder_id', quote.builder_id)
  if (finishImagesRes.error) throw finishImagesRes.error
  type FimRow = {
    finish_id: string | null
    pattern_finish_id: string | null
    platform_id: string | null
    image_url: string
    source: 'shopify' | 'manual'
    source_colour_label: string | null
  }
  const finishImages = (finishImagesRes.data ?? []) as FimRow[]
  // Finish name map — used to label the "any interior photo" fallback
  // ("Shown: Clamshell / Volcanic Black — yours in Tan, Designo").
  const finishIdSet = new Set<string>()
  for (const r of finishImages) {
    if (r.finish_id) finishIdSet.add(r.finish_id)
    if (r.pattern_finish_id) finishIdSet.add(r.pattern_finish_id)
  }
  const finishNameById = new Map<string, string>()
  if (finishIdSet.size > 0) {
    const fnRes = await supabase.from('catalog_finishes')
      .select('id, name').in('id', Array.from(finishIdSet))
    if (!fnRes.error) {
      for (const r of (fnRes.data ?? []) as { id: string; name: string }[]) {
        finishNameById.set(r.id, r.name)
      }
    }
  }
  interface ResolvedFim { url: string; sourceColourLabel: string | null; exact: boolean }

  // Interior images sometimes come back as line drawings / template
  // layouts (seat-map SVGs rendered as JPG). Skip anything whose URL
  // or alt text obviously names a diagram, and anything whose pixel
  // profile reads as "near-zero saturation + mostly white" at 32×32.
  const DIAGRAM_WORDS = /(template|diagram|pattern|layout|line|seat-map)/i
  function urlLooksDiagrammatic(url: string | null | undefined): boolean {
    if (!url) return false
    return DIAGRAM_WORDS.test(url)
  }
  async function sampleDiagrammatic(url: string | null): Promise<boolean> {
    if (!url || typeof window === 'undefined' || typeof Image === 'undefined') return false
    return new Promise<boolean>(resolve => {
      const img = new Image()
      const to = setTimeout(() => resolve(false), 5000)
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        clearTimeout(to)
        try {
          const canvas = document.createElement('canvas')
          canvas.width = 32; canvas.height = 32
          const ctx = canvas.getContext('2d')
          if (!ctx) return resolve(false)
          ctx.drawImage(img, 0, 0, 32, 32)
          const d = ctx.getImageData(0, 0, 32, 32).data
          let satSum = 0, whiteCount = 0, n = 0
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2]
            const maxC = Math.max(r, g, b), minC = Math.min(r, g, b)
            const sat = maxC === 0 ? 0 : (maxC - minC) / maxC
            satSum += sat
            if (r > 240 && g > 240 && b > 240) whiteCount++
            n++
          }
          const avgSat = satSum / n
          const whiteFrac = whiteCount / n
          resolve(avgSat < 0.08 && whiteFrac > 0.55)
        } catch {
          resolve(false)
        }
      }
      img.onerror = () => { clearTimeout(to); resolve(false) }
      img.src = url
    })
  }
  async function viableInteriorImage(url: string | null): Promise<boolean> {
    if (!url) return false
    // @react-pdf renders JPG/PNG only — a GIF slot silently vanishes.
    if (/\.gif(?:\?|$)/i.test(url)) return false
    if (urlLooksDiagrammatic(url)) return false
    const sampled = await sampleDiagrammatic(url)
    return !sampled
  }

  function pickFinishImage(
    platformId: string, colourId: string | null, patternId: string | null,
    tier: 'exact' | 'pattern-only',
  ): ResolvedFim | null {
    if (!patternId) return null
    const prefer = (a: FimRow, b: FimRow) => (a.source === 'manual' ? -1 : b.source === 'manual' ? 1 : 0)
    const pick = (filterFn: (r: FimRow) => boolean, exact: boolean): ResolvedFim | null => {
      const hit = finishImages.filter(filterFn).sort(prefer)[0]
      return hit ? { url: hit.image_url, sourceColourLabel: hit.source_colour_label, exact } : null
    }
    if (tier === 'exact') {
      if (!colourId) return null
      const platHit = pick(r => r.pattern_finish_id === patternId && r.finish_id === colourId && r.platform_id === platformId, true)
      if (platHit) return platHit
      return pick(r => r.pattern_finish_id === patternId && r.finish_id === colourId && r.platform_id === null, true)
    }
    // pattern-only tier
    const platHit = pick(r => r.pattern_finish_id === patternId && r.finish_id === null && r.platform_id === platformId, false)
    if (platHit) return platHit
    return pick(r => r.pattern_finish_id === patternId && r.finish_id === null, false)
  }

  // Tier-4 fallback: any leather-interior photo for this platform
  // (any colour/pattern), then any such photo at all. Walks the
  // candidates and returns the first that passes the diagram filter
  // (both URL + pixel probe). Caller builds the caption from the
  // row's finish names so the shown identity is clear.
  async function pickAnyInteriorPhoto(platformId: string): Promise<FimRow | null> {
    const prefer = (a: FimRow, b: FimRow) => (a.source === 'manual' ? -1 : b.source === 'manual' ? 1 : 0)
    const platformFirst = finishImages
      .filter(r => r.platform_id === platformId)
      .sort(prefer)
    for (const r of platformFirst) {
      if (await viableInteriorImage(r.image_url)) return r
    }
    const anywhere = finishImages
      .filter(r => r.platform_id !== platformId)
      .sort(prefer)
    for (const r of anywhere) {
      if (await viableInteriorImage(r.image_url)) return r
    }
    return null
  }

  // Build "Pattern / Colour" (or just one if the other is unknown)
  // from a FimRow. Prefers catalog finish names, falls back to the
  // raw source_colour_label captured from the Shopify title.
  function fimIdentity(row: FimRow): string {
    const pattern = row.pattern_finish_id ? finishNameById.get(row.pattern_finish_id) ?? null : null
    const colour = row.finish_id
      ? finishNameById.get(row.finish_id) ?? null
      : row.source_colour_label ?? null
    return [pattern, colour].filter((v): v is string => !!v && v.length > 0).join(' / ')
  }

  const [optsRes, imagesRes, groupsRes] = await Promise.all([
    supabase.from('catalog_options')
      .select('id, name, code, group_id, category_id, swatch_image_url, lead_image_url, description, sold_as_set, parts_sell_cents, install_price_cents')
      .in('id', optionIds),
    supabase.from('catalog_option_images').select('option_id, url, sort').in('option_id', optionIds),
    supabase.from('catalog_option_groups').select('id, slug, name'),
  ])
  if (optsRes.error) throw optsRes.error
  if (imagesRes.error) throw imagesRes.error
  if (groupsRes.error) throw groupsRes.error

  // Categories for section + sort.
  const catIds = Array.from(new Set((optsRes.data ?? []).map(o => (o as { category_id: string | null }).category_id).filter((v): v is string => !!v)))
  const catsRes = catIds.length
    ? await supabase.from('catalog_categories')
        .select('id, name, lookbook_section, lookbook_sort').in('id', catIds)
    : { data: [] as unknown[] }
  if ('error' in catsRes && catsRes.error) throw catsRes.error
  const categoryById = new Map<string, { name: string; section: string | null; sort: number }>()
  for (const c of (catsRes.data ?? []) as { id: string; name: string; lookbook_section: string | null; lookbook_sort: number }[]) {
    categoryById.set(c.id, { name: c.name, section: c.lookbook_section, sort: c.lookbook_sort ?? 999 })
  }

  // Lead image for each option — ops override wins, otherwise the
  // first image by sort, otherwise the swatch.
  const imagesByOption = new Map<string, { url: string; sort: number }[]>()
  for (const r of (imagesRes.data ?? []) as { option_id: string; url: string; sort: number }[]) {
    const list = imagesByOption.get(r.option_id) ?? []
    list.push({ url: r.url, sort: r.sort })
    imagesByOption.set(r.option_id, list)
  }
  for (const list of imagesByOption.values()) list.sort((a, b) => a.sort - b.sort)

  // Group lookup — tyres live in the manual "tyres" slug group, wheels
  // live under shopify:group:alloy-wheels. Everything else sits in
  // its category's section.
  const groups = (groupsRes.data ?? []) as { id: string; slug: string; name: string }[]
  const tyresGroupId = groups.find(g => g.slug === 'tyres')?.id ?? null
  const wheelsGroupId = groups.find(g => g.slug === 'shopify-alloy-wheels' || g.name === 'Alloy wheels')?.id ?? null

  const qoByOption = new Map(qoRows.map(r => [r.option_id, r]))
  const options: LookbookOption[] = []
  const tyres: LookbookTyre[] = []
  const wheelOptions: LookbookOption[] = []
  const optRows = (optsRes.data ?? []) as unknown as {
    id: string; name: string; code: string | null; group_id: string; category_id: string | null
    swatch_image_url: string | null; lead_image_url: string | null; description: string | null
    sold_as_set: boolean; parts_sell_cents: number | null; install_price_cents: number | null
  }[]
  const built = await Promise.all(optRows.map(async (o) => {
    const qo = qoByOption.get(o.id)!
    const qty = qo.quantity ?? 1
    // Line price reads straight off the quote_options snapshot:
    //   parts_sell_cents is already × qty (set at save time)
    //   labour_cents + materials_cents form the install portion.
    const partsSell = qo.parts_sell_cents
      ?? (o.parts_sell_cents ?? qo.price_cents_at_selection) * (o.sold_as_set ? 1 : qty)
    const installPart = (qo.labour_cents ?? 0) + (qo.materials_cents ?? 0)
    const linePrice = partsSell + installPart

    const finishes = (qo.quote_option_finishes ?? [])
      .slice()
      .sort((a, b) => (a.catalog_finish_sets?.sort ?? 0) - (b.catalog_finish_sets?.sort ?? 0))
      .map(f => ({
        set_name: f.catalog_finish_sets?.name ?? '',
        name: f.catalog_finishes?.name ?? '',
        swatch_hex: f.catalog_finishes?.swatch_hex ?? null,
      }))
      .filter(f => f.name)

    const cat = o.category_id ? categoryById.get(o.category_id) : null

    const colourFinish = (qo.quote_option_finishes ?? [])
      .find(f => f.catalog_finish_sets?.name === 'Interior colour') ?? null
    const patternFinish = (qo.quote_option_finishes ?? [])
      .find(f => f.catalog_finish_sets?.name === 'Interior pattern') ?? null

    const isLeatherInterior = cat?.name === 'Leather interior'
    let img: string | null = null
    let finishImageCaption: string | null = null
    const chosenColourName = colourFinish?.catalog_finishes?.name ?? null
    const chosenPatternName = patternFinish?.catalog_finishes?.name ?? null

    if (isLeatherInterior) {
      // Four-tier resolution for leather-interior options:
      //   1. exact colour + pattern photo (platform or agnostic)
      //   2. option's own product photos (first non-diagram)
      //   3. pattern-only photo (with "Shown in X — yours in Y" when
      //      the Shopify colour was captured)
      //   4. any CTC interior photo on this platform (any
      //      colour/pattern) — captioned with the shown identity so
      //      the customer knows it's representative, not literal
      // Diagram detection: URL keyword filter + 32×32 pixel probe
      // (near-zero saturation + mostly-white). Never a stock OEM.
      const exactHit = patternFinish
        ? pickFinishImage(quote.platform_id, colourFinish?.finish_id ?? null, patternFinish.finish_id, 'exact')
        : null
      if (exactHit && await viableInteriorImage(exactHit.url)) {
        img = exactHit.url
      } else {
        const ownCandidates = [
          o.lead_image_url,
          ...(imagesByOption.get(o.id) ?? []).map(x => x.url),
          o.swatch_image_url,
        ].filter((v): v is string => !!v)
        for (const u of ownCandidates) {
          if (await viableInteriorImage(u)) { img = u; break }
        }
        if (!img) {
          const patternHit = patternFinish
            ? pickFinishImage(quote.platform_id, null, patternFinish.finish_id, 'pattern-only')
            : null
          if (patternHit && await viableInteriorImage(patternHit.url)) {
            img = patternHit.url
            if (patternHit.sourceColourLabel && chosenColourName
                && patternHit.sourceColourLabel.toLowerCase() !== chosenColourName.toLowerCase()) {
              finishImageCaption = `Shown in ${patternHit.sourceColourLabel} — yours in ${chosenColourName}`
            }
          }
          if (!img) {
            const anyHit = await pickAnyInteriorPhoto(quote.platform_id)
            if (anyHit) {
              img = anyHit.image_url
              const shown = fimIdentity(anyHit)
              const yoursParts = [chosenColourName, chosenPatternName].filter((v): v is string => !!v)
              const yours = yoursParts.join(', ')
              if (shown && yours) finishImageCaption = `Shown: ${shown} — yours in ${yours}`
              else if (shown) finishImageCaption = `Shown: ${shown}`
            }
          }
        }
      }
    } else {
      const finishImg = patternFinish
        ? pickFinishImage(quote.platform_id, colourFinish?.finish_id ?? null, patternFinish.finish_id, 'exact')
          ?? pickFinishImage(quote.platform_id, null, patternFinish.finish_id, 'pattern-only')
        : null
      img = finishImg?.url
        ?? o.lead_image_url
        ?? imagesByOption.get(o.id)?.[0]?.url
        ?? o.swatch_image_url
    }

    // Investment columns need the parts + fitting split per option.
    // parts_cents is parts_sell × qty (already baked into the snapshot
    // partsSell); fitting = labour + materials; hours = labour/rate.
    const fittingCents = (qo.labour_cents ?? 0) + (qo.materials_cents ?? 0)
    const labourRateCents = (terms as unknown as { labour_rate_cents?: number }).labour_rate_cents ?? 20000
    const fittingHours = labourRateCents > 0 && qo.labour_cents != null
      ? Math.round(qo.labour_cents / labourRateCents)
      : null

    const lookbook: LookbookOption = {
      option_id: o.id,
      name: o.name,
      code: o.code,
      description: o.description,
      image_url: img,
      swatch_image_url: o.swatch_image_url,
      finish_image_caption: finishImageCaption,
      line_price_cents: linePrice,
      parts_cents: partsSell,
      fitting_cents: fittingCents,
      fitting_hours: fittingHours,
      parts_sell_cents: o.parts_sell_cents,
      quantity: qty,
      sold_as_set: o.sold_as_set,
      category_name: cat?.name ?? null,
      section: cat?.section ?? null,
      section_sort: cat?.sort ?? 999,
      finishes,
      finish_note: qo.finish_note,
      // Shopify tags aren't persisted; the Lookbook renderer parses
      // size out of the option name as a graceful fallback.
      shopify_tags: [],
    }

    return { o, lookbook, linePrice, qty }
  }))
  for (const b of built) {
    // Tyres get a one-liner on the Wheels page. Wheels become cards.
    // Everything else is a full option page.
    if (b.o.group_id === tyresGroupId) {
      tyres.push({
        name: b.o.name,
        code: b.o.code,
        description: b.o.description,
        line_price_cents: b.linePrice,
        quantity: b.qty,
        sold_as_set: b.o.sold_as_set,
      })
    } else if (b.o.group_id === wheelsGroupId) {
      wheelOptions.push(b.lookbook)
    } else {
      options.push(b.lookbook)
    }
  }

  // Sort options by section then name so the pages flow left-to-right
  // in the right order.
  options.sort((a, b) => a.section_sort - b.section_sort || (a.name ?? '').localeCompare(b.name ?? ''))

  const customerFullName = quote.lead?.customer?.full_name ?? null
  const customerFirstName = customerFullName ? customerFullName.split(/\s+/)[0] : null

  // Page 2 hero: customer-uploaded photo wins; otherwise the platform
  // hero; otherwise fall back to the image of the highest-priced non-
  // wheel/tyre option on the quote. Never ship a grey box.
  const platformRow = platform as {
    hero_image_url?: string | null
    hero_image_width?: number | null
    hero_image_height?: number | null
  }
  const platformHero = platformRow.hero_image_url ?? null
  const topOptionImage = [...options]
    .sort((a, b) => b.line_price_cents - a.line_price_cents)[0]?.image_url ?? null
  const page2HeroUrl = quote.vehicle_photo_url
    ?? platformHero
    ?? topOptionImage

  // Decide between the half-page portrait layout (customer photos,
  // product renders) and the full-width banner layout (Shopify
  // collection images) from the stored intrinsic ratio on
  // catalog_platforms. The ratio is only known for the platform hero
  // — a customer-uploaded photo or an option image stays as portrait.
  const usingPlatformHero = page2HeroUrl === platformHero
  const page2HeroIsWide = usingPlatformHero
    && !!platformRow.hero_image_width
    && !!platformRow.hero_image_height
    && (platformRow.hero_image_width / platformRow.hero_image_height) > 1.6

  // Cutout detection: sample the four corners of the hero in a hidden
  // canvas. ≥3 near-white (within 8 of #FFFFFF) means it's a studio
  // cutout, not a photograph — the lookbook renders those on cream
  // without the dark overlay band. Non-browser envs skip detection.
  async function sampleCutout(url: string | null): Promise<boolean> {
    if (!url || typeof window === 'undefined' || typeof Image === 'undefined') return false
    return new Promise<boolean>(resolve => {
      const img = new Image()
      const to = setTimeout(() => resolve(false), 5000)
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        clearTimeout(to)
        try {
          const w = img.naturalWidth, h = img.naturalHeight
          if (!w || !h) return resolve(false)
          const canvas = document.createElement('canvas')
          const sw = Math.min(240, w), sh = Math.min(240, h)
          canvas.width = sw; canvas.height = sh
          const ctx = canvas.getContext('2d')
          if (!ctx) return resolve(false)
          ctx.drawImage(img, 0, 0, sw, sh)
          const samplePatch = (x: number, y: number) => {
            const d = ctx.getImageData(x, y, 8, 8).data
            let r = 0, g = 0, b = 0, n = 0
            for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; n++ }
            return [r/n, g/n, b/n]
          }
          const corners = [
            samplePatch(2, 2),
            samplePatch(sw - 10, 2),
            samplePatch(2, sh - 10),
            samplePatch(sw - 10, sh - 10),
          ]
          const nearWhite = (c: number[]) =>
            Math.abs(c[0] - 255) <= 8 && Math.abs(c[1] - 255) <= 8 && Math.abs(c[2] - 255) <= 8
          resolve(corners.filter(nearWhite).length >= 3)
        } catch {
          resolve(false)
        }
      }
      img.onerror = () => { clearTimeout(to); resolve(false) }
      img.src = url
    })
  }
  const page2HeroIsCutout = await sampleCutout(page2HeroUrl)

  const input: LookbookPdfInput = {
    quote_id: quote.id,
    version: quote.version,
    price_cents: quote.price_cents,
    created_at: quote.created_at,
    builder: { name: builderRow.name, legal_name: builderRow.legal_name, slug: builderRow.slug },
    brand,
    terms,
    operator_contact: operatorContact,
    closing_signer: { name: signerName, title: signerTitle, phone: signerPhone, email: signerEmail },
    platform,
    all_platform_names: ((allPlatformsRes.data ?? []) as { name: string }[]).map(r => r.name),
    tier,
    options,
    tyres,
    wheel_options: wheelOptions,
    customer: (quote.lead?.customer ?? null) as CustomerLike | null,
    customer_first_name: customerFirstName,
    theme_words: quote.theme_words,
    vehicle_colour: quote.vehicle_colour,
    vehicle_year: quote.vehicle_year,
    page2_hero_url: page2HeroUrl,
    page2_hero_is_wide: page2HeroIsWide,
    page2_hero_is_cutout: page2HeroIsCutout,
    labour_rate_cents: (terms as unknown as { labour_rate_cents?: number }).labour_rate_cents ?? 20000,
  }

  const [{ LookbookPdf }, { registerBrandFonts }] = await Promise.all([
    import('./LookbookPdf'),
    import('./fonts'),
  ])
  // The Lookbook always uses Cormorant Garamond + DM Sans regardless
  // of the brand's font_display / font_body — the design language is
  // builder-neutral until someone asks for it to vary.
  registerBrandFonts('Cormorant Garamond', 'DM Sans')
  const blob = await pdfBlob(LookbookPdf(input))

  const path = `document/lookbook_${quote.id}_v${quote.version}_${Date.now()}.pdf`
  const url = await uploadPdf(path, blob)
  const upd = await supabase.from('quotes').update({ pdf_url: url }).eq('id', quote.id)
  if (upd.error) throw upd.error
  return url
}

// ─────────────────────────────────────────────────────────────────────
// Purchase Order (Phase 7)
// ─────────────────────────────────────────────────────────────────────

// Supplier-view finish filter. The customer's exterior paint pick
// (Body-colour paint, Raptor coating) isn't the supplier's business —
// we paint ourselves — so swap it for "Unpainted / as supplied".
// Interior colour/pattern + wheel finishes pass through.
function supplierFinishView(finish: string | null): string | null {
  if (!finish) return finish
  const parts = finish.split(/\s*·\s*/).map(p => p.trim()).filter(Boolean)
  const isPaint = (p: string) => /body[-\s]?colour\s*paint|body[-\s]?color\s*paint|^raptor\b/i.test(p)
  if (parts.some(isPaint)) return 'Unpainted / as supplied'
  return finish
}

export async function renderPurchaseOrderPdfToStorage(poId: string): Promise<string> {
  const poRes = await supabase.from('purchase_orders')
    .select('id, build_id, supplier_id, number, status, currency, subtotal_cents, created_at')
    .eq('id', poId).single()
  if (poRes.error) throw poRes.error
  const po = poRes.data as {
    id: string; build_id: string; supplier_id: string; number: string
    status: 'draft' | 'sent' | 'confirmed' | 'received'
    currency: string; subtotal_cents: number; created_at: string
  }

  const [supplierRes, linesRes, buildRes] = await Promise.all([
    supabase.from('suppliers')
      .select('name, email, cc_email, address, order_notes, lead_time_days')
      .eq('id', po.supplier_id).single(),
    supabase.from('purchase_order_lines')
      .select('sku, description, qty, unit_cost_cents, finish, note, created_at')
      .eq('po_id', po.id).order('created_at'),
    supabase.from('builds')
      .select('id, builder_id, platform_id, customer_id, vehicle_id, slot_year, slot_number')
      .eq('id', po.build_id).single(),
  ])
  if (supplierRes.error) throw supplierRes.error
  if (linesRes.error) throw linesRes.error
  if (buildRes.error) throw buildRes.error
  const supplier = supplierRes.data as {
    name: string; email: string | null; cc_email: string | null
    address: string | null; order_notes: string | null; lead_time_days: number | null
  }
  const lines = (linesRes.data ?? []) as {
    sku: string | null; description: string; qty: number
    unit_cost_cents: number; finish: string | null; note: string | null
  }[]
  const build = buildRes.data as {
    id: string; builder_id: string; platform_id: string
    customer_id: string | null; vehicle_id: string | null
    slot_year: number | null; slot_number: number | null
  }

  const [brandRes, builderRes, platformRes, customerRes, vehicleRes] = await Promise.all([
    supabase.from('builder_brand').select('*').eq('builder_id', build.builder_id).maybeSingle(),
    supabase.from('builders').select('name, legal_name, operator:operators(name, brand, contact)').eq('id', build.builder_id).single(),
    supabase.from('catalog_platforms').select('name').eq('id', build.platform_id).single(),
    build.customer_id
      ? supabase.from('customers').select('full_name, email').eq('id', build.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    build.vehicle_id
      ? supabase.from('vehicles').select('vin, year').eq('id', build.vehicle_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (brandRes.error) throw brandRes.error
  if (builderRes.error) throw builderRes.error
  if (platformRes.error) throw platformRes.error
  if ('error' in customerRes && customerRes.error) throw customerRes.error
  if ('error' in vehicleRes && vehicleRes.error) throw vehicleRes.error

  const brand = brandRes.data as {
    logo_url: string | null; wordmark_text: string | null; color_accent: string
    font_display: string; font_body: string
  } | null
  const builderRow = builderRes.data as unknown as {
    name: string; legal_name: string | null
    operator: {
      name: string | null
      brand: { logo_url?: string; wordmark_text?: string; color_accent?: string; font_display?: string; font_body?: string } | null
      contact: { name?: string; address?: string; phone?: string; email?: string } | null
    } | null
  }
  const platform = platformRes.data as { name: string }
  const customer = (customerRes.data ?? null) as { full_name: string | null; email: string | null } | null
  const vehicle = (vehicleRes.data ?? null) as { vin: string | null; year: number | null } | null

  const opName = builderRow.operator?.name ?? 'Humble House'
  const opBrand = builderRow.operator?.brand ?? {}
  const opContact = builderRow.operator?.contact ?? {}
  const shipTo = {
    name: opName,
    address: opContact.address ?? '',
    phone: opContact.phone ?? null,
    email: opContact.email ?? null,
  }

  const buildNumber = build.slot_year && build.slot_number
    ? `${build.slot_year}-${String(build.slot_number).padStart(3, '0')}`
    : build.id.slice(0, 8)

  const input = {
    po_number: po.number,
    created_at: po.created_at,
    status: po.status,
    currency: po.currency,
    subtotal_cents: po.subtotal_cents,
    supplier,
    ship_to: shipTo,
    brand: {
      // HH-letterhead: prefer the operator's brand so the PO reads as
      // Humble House → supplier, not as the end builder → supplier.
      logo_url: opBrand.logo_url ?? brand?.logo_url ?? null,
      wordmark_text: opBrand.wordmark_text ?? opName,
      color_accent: opBrand.color_accent ?? brand?.color_accent ?? '#1C1C1A',
      font_display: opBrand.font_display ?? brand?.font_display ?? 'Cormorant Garamond',
      font_body: opBrand.font_body ?? brand?.font_body ?? 'DM Sans',
    },
    vehicle: {
      platform: platform.name,
      year: vehicle?.year?.toString() ?? null,
      vin: vehicle?.vin ?? null,
    },
    build_number: buildNumber,
    customer_name: customer?.full_name ?? customer?.email ?? '—',
    // Finish filter: a PO only reveals finishes the supplier can act
    // on. Interior colour / pattern and wheel finishes stay. Exterior
    // paint picks (Body-colour paint, Raptor) are internal and get
    // replaced with "Unpainted / as supplied" so the supplier ships
    // raw. "No finish (…)" strings pass through untouched — the
    // supplier already knows the item is being delivered as-is.
    lines: lines.map(l => ({
      sku: l.sku, description: l.description, qty: l.qty,
      unit_cost_cents: l.unit_cost_cents,
      finish: supplierFinishView(l.finish),
      note: l.note,
    })),
  }

  const [{ PurchaseOrderPdf }, { registerBrandFonts }] = await Promise.all([
    import('./PurchaseOrderPdf'),
    import('./fonts'),
  ])
  registerBrandFonts(input.brand.font_display, input.brand.font_body)
  const blob = await pdfBlob(PurchaseOrderPdf(input))

  const path = `document/po_${po.number}_${Date.now()}.pdf`
  const url = await uploadPdf(path, blob)
  const upd = await supabase.from('purchase_orders')
    .update({ pdf_url: url, updated_at: new Date().toISOString() })
    .eq('id', po.id)
  if (upd.error) throw upd.error
  return url
}


// ─────────────────────────────────────────────────────────────────────
// Build sheet (Phase 7)
// ─────────────────────────────────────────────────────────────────────

export async function renderBuildSheetPdfToStorage(buildId: string): Promise<string> {
  const buildRes = await supabase.from('builds')
    .select('id, builder_id, platform_id, customer_id, vehicle_id, quote_id, slot_year, slot_number, install_instructions')
    .eq('id', buildId).single()
  if (buildRes.error) throw buildRes.error
  const build = buildRes.data as {
    id: string; builder_id: string; platform_id: string
    customer_id: string | null; vehicle_id: string | null; quote_id: string | null
    slot_year: number | null; slot_number: number | null
    install_instructions: string | null
  }

  const [brandRes, builderRes, platformRes, customerRes, vehicleRes, boRes, quoteRes] = await Promise.all([
    supabase.from('builder_brand').select('logo_url, wordmark_text, font_display, font_body').eq('builder_id', build.builder_id).maybeSingle(),
    supabase.from('builders').select('name, operator:operators(name, contact)').eq('id', build.builder_id).single(),
    supabase.from('catalog_platforms').select('name').eq('id', build.platform_id).single(),
    build.customer_id
      ? supabase.from('customers').select('full_name, email').eq('id', build.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    build.vehicle_id
      ? supabase.from('vehicles').select('vin, year, colour_original, mileage').eq('id', build.vehicle_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('build_options')
      .select('id, option_id, quantity, instruction')
      .eq('build_id', buildId),
    build.quote_id
      ? supabase.from('quote_options')
          .select('option_id, finish_note, labour_cents, materials_cents, quote_option_finishes(catalog_finish_sets(name, sort), catalog_finishes(name))')
          .eq('quote_id', build.quote_id)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])
  if (brandRes.error) throw brandRes.error
  if (builderRes.error) throw builderRes.error
  if (platformRes.error) throw platformRes.error
  if ('error' in customerRes && customerRes.error) throw customerRes.error
  if ('error' in vehicleRes && vehicleRes.error) throw vehicleRes.error
  if (boRes.error) throw boRes.error
  if ('error' in quoteRes && quoteRes.error) throw quoteRes.error

  const brand = brandRes.data as { logo_url: string | null; wordmark_text: string | null; font_display: string; font_body: string } | null
  const builderRow = builderRes.data as unknown as { name: string; operator: { name: string | null; contact: { name?: string; phone?: string; email?: string } | null } | null }
  const platform = platformRes.data as { name: string }
  const customer = (customerRes.data ?? null) as { full_name: string | null; email: string | null } | null
  const vehicle = (vehicleRes.data ?? null) as { vin: string | null; year: number | null; colour_original: string | null; mileage: number | null } | null
  const buildOpts = (boRes.data ?? []) as { id: string; option_id: string; quantity: number; instruction: string | null }[]
  const qoRows = (quoteRes.data ?? []) as unknown as { option_id: string; finish_note: string | null; labour_cents: number | null; materials_cents: number | null; quote_option_finishes: { catalog_finish_sets: { name: string; sort: number } | null; catalog_finishes: { name: string } | null }[] }[]

  const optionIds = buildOpts.map(bo => bo.option_id)
  let optionData: Array<{ id: string; name: string; code: string | null; kit_sku: string | null; category_id: string | null; lead_image_url: string | null; swatch_image_url: string | null }> = []
  let categoryById = new Map<string, { name: string; section: string | null; install_hours: number | null; paint_hours: number | null; materials_cents: number | null; sort: number }>()
  let imagesByOption = new Map<string, string>()

  if (optionIds.length) {
    const [optsRes, imgsRes] = await Promise.all([
      supabase.from('catalog_options').select('id, name, code, kit_sku, category_id, lead_image_url, swatch_image_url').in('id', optionIds),
      supabase.from('catalog_option_images').select('option_id, url, sort').in('option_id', optionIds).order('sort'),
    ])
    if (optsRes.error) throw optsRes.error
    if (imgsRes.error) throw imgsRes.error
    optionData = (optsRes.data ?? []) as unknown as typeof optionData
    for (const r of (imgsRes.data ?? []) as { option_id: string; url: string; sort: number }[]) {
      if (!imagesByOption.has(r.option_id) && !/\.gif(?:\?|$)/i.test(r.url)) {
        imagesByOption.set(r.option_id, r.url)
      }
    }
    const catIds = Array.from(new Set(optionData.map(o => o.category_id).filter((v): v is string => !!v)))
    if (catIds.length) {
      const catsRes = await supabase.from('catalog_categories')
        .select('id, name, lookbook_section, lookbook_sort, install_hours, paint_hours, paint_materials_cents').in('id', catIds)
      if (catsRes.error) throw catsRes.error
      for (const c of (catsRes.data ?? []) as unknown as { id: string; name: string; lookbook_section: string | null; lookbook_sort: number; install_hours: number | null; paint_hours: number | null; paint_materials_cents: number | null }[]) {
        categoryById.set(c.id, { name: c.name, section: c.lookbook_section, install_hours: c.install_hours, paint_hours: c.paint_hours, materials_cents: c.paint_materials_cents, sort: c.lookbook_sort ?? 999 })
      }
    }
  }

  const optionById = new Map(optionData.map(o => [o.id, o]))
  const qoByOption = new Map(qoRows.map(r => [r.option_id, r]))

  // Build line list, sorted by category sort then name.
  const lines = buildOpts
    .map(bo => {
      const o = optionById.get(bo.option_id)
      if (!o) return null
      const cat = o.category_id ? categoryById.get(o.category_id) : null
      const qo = qoByOption.get(bo.option_id)
      const finishes = qo?.quote_option_finishes
        ? (qo.quote_option_finishes
            .slice()
            .sort((a, b) => (a.catalog_finish_sets?.sort ?? 0) - (b.catalog_finish_sets?.sort ?? 0))
            .map(x => x.catalog_finishes?.name).filter(Boolean) as string[]).join(' · ')
        : null
      return {
        section: cat?.section ?? 'Other',
        sectionSort: cat?.sort ?? 999,
        name: o.name,
        sku: o.kit_sku ?? o.code ?? null,
        qty: bo.quantity,
        finishes: finishes || null,
        finish_note: qo?.finish_note ?? null,
        instruction: bo.instruction,
        install_hours: cat?.install_hours ?? null,
        paint_hours: cat?.paint_hours ?? null,
        materials_cents: qo?.materials_cents ?? cat?.materials_cents ?? null,
        size: null,
        thumbnail_url: imagesByOption.get(o.id) ?? o.lead_image_url ?? o.swatch_image_url ?? null,
      }
    })
    .filter((v): v is NonNullable<typeof v> => !!v)
    .sort((a, b) => a.sectionSort - b.sectionSort || a.name.localeCompare(b.name))

  const buildNumber = build.slot_year && build.slot_number
    ? `${build.slot_year}-${String(build.slot_number).padStart(3, '0')}`
    : build.id.slice(0, 8)

  // Version: count existing build sheet media rows for this build.
  const mediaRes = await supabase.from('media')
    .select('id', { count: 'exact', head: true })
    .eq('build_id', buildId)
    .ilike('storage_path', 'document/build_sheet_%')
  const version = (mediaRes.count ?? 0) + 1

  const opContact = builderRow.operator?.contact ?? {}
  const input = {
    build_number: buildNumber,
    customer_name: customer?.full_name ?? customer?.email ?? '—',
    vehicle: {
      platform: platform.name,
      year: vehicle?.year?.toString() ?? null,
      colour: vehicle?.colour_original ?? null,
      vin: vehicle?.vin ?? null,
      mileage_in: vehicle?.mileage?.toString() ?? null,
    },
    key_dates: [
      { label: 'Build created', date: new Date().toLocaleDateString('en-US') },
    ],
    hh_contact: {
      name: builderRow.operator?.name ?? opContact.name ?? 'Humble House',
      phone: opContact.phone ?? null,
      email: opContact.email ?? null,
    },
    instructions_markdown: build.install_instructions,
    brand: {
      logo_url: brand?.logo_url ?? null,
      wordmark_text: brand?.wordmark_text ?? builderRow.name,
      font_display: brand?.font_display ?? 'Cormorant Garamond',
      font_body: brand?.font_body ?? 'DM Sans',
    },
    lines,
    version,
  }

  const [{ BuildSheetPdf }, { registerBrandFonts }] = await Promise.all([
    import('./BuildSheetPdf'),
    import('./fonts'),
  ])
  registerBrandFonts(input.brand.font_display, input.brand.font_body)
  const blob = await pdfBlob(BuildSheetPdf(input))

  const path = `document/build_sheet_${buildId}_v${version}_${Date.now()}.pdf`
  const url = await uploadPdf(path, blob)
  const ins = await supabase.from('media').insert({
    build_id: buildId,
    storage_path: path,
    kind: 'document' as const,
    caption: `Build sheet v${version}`,
  })
  if (ins.error) throw ins.error
  return url
}
