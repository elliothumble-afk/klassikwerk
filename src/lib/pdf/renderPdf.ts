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
      theme_words, vehicle_colour,
      lead:leads(phone, customer:customers(full_name, email))
    `)
    .eq('id', quoteId).single()
  if (qRes.error) throw qRes.error
  const quote = qRes.data as unknown as {
    id: string; version: number; price_cents: number; created_at: string
    builder_id: string; platform_id: string; tier_id: string
    theme_words: string | null; vehicle_colour: string | null
    lead: { phone: string | null; customer: { full_name: string | null; email: string | null } | null } | null
  }

  const [builderRes, brandRes, termsRes, platformRes, tierRes, qoRes, eventsRes] = await Promise.all([
    supabase.from('builders').select('*, operator:operators(contact)').eq('id', quote.builder_id).single(),
    supabase.from('builder_brand').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
    supabase.from('builder_terms').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
    supabase.from('catalog_platforms').select('*').eq('id', quote.platform_id).single(),
    supabase.from('catalog_tiers').select('*').eq('id', quote.tier_id).single(),
    // install_price_cents lives on catalog_options; here we read the
    // per-line snapshot (parts × qty + labour + materials = line price).
    supabase.from('quote_options')
      .select('id, option_id, quantity, finish_note, parts_sell_cents, labour_cents, materials_cents, price_cents_at_selection, quote_option_finishes(finish_set_id, finish_id, catalog_finish_sets(name, sort), catalog_finishes(name))')
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
    catalog_finishes: { name: string } | null
  }
  const qoRows = qoRes.data as unknown as {
    id: string; option_id: string; quantity: number; finish_note: string | null
    parts_sell_cents: number | null; labour_cents: number | null; materials_cents: number | null
    price_cents_at_selection: number
    quote_option_finishes: QoFinishRow[]
  }[]

  const optionIds = qoRows.map(r => r.option_id)
  if (optionIds.length === 0) throw new Error('Quote has no options — nothing to put in the lookbook.')

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
  for (const o of (optsRes.data ?? []) as unknown as {
    id: string; name: string; code: string | null; group_id: string; category_id: string | null
    swatch_image_url: string | null; lead_image_url: string | null; description: string | null
    sold_as_set: boolean; parts_sell_cents: number | null; install_price_cents: number | null
  }[]) {
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
      .map(f => ({ set_name: f.catalog_finish_sets?.name ?? '', name: f.catalog_finishes?.name ?? '' }))
      .filter(f => f.name)

    const cat = o.category_id ? categoryById.get(o.category_id) : null
    const img = o.lead_image_url ?? imagesByOption.get(o.id)?.[0]?.url ?? o.swatch_image_url

    const lookbook: LookbookOption = {
      option_id: o.id,
      name: o.name,
      code: o.code,
      description: o.description,
      image_url: img,
      swatch_image_url: o.swatch_image_url,
      line_price_cents: linePrice,
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

    // Tyres get a one-liner on the Wheels page. Wheels become cards.
    // Everything else is a full option page.
    if (o.group_id === tyresGroupId) {
      tyres.push({ name: o.name, code: o.code, description: o.description })
    } else if (o.group_id === wheelsGroupId) {
      wheelOptions.push(lookbook)
    } else {
      options.push(lookbook)
    }
  }

  // Sort options by section then name so the pages flow left-to-right
  // in the right order.
  options.sort((a, b) => a.section_sort - b.section_sort || (a.name ?? '').localeCompare(b.name ?? ''))

  const customerFullName = quote.lead?.customer?.full_name ?? null
  const customerFirstName = customerFullName ? customerFullName.split(/\s+/)[0] : null

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
    tier,
    options,
    tyres,
    wheel_options: wheelOptions,
    customer: (quote.lead?.customer ?? null) as CustomerLike | null,
    customer_first_name: customerFirstName,
    theme_words: quote.theme_words,
    vehicle_colour: quote.vehicle_colour,
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
