import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router'
import { FileText, Send, Save, Copy, Hammer, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFn } from '@/lib/fnInvoke'
import { renderQuotePdfToStorage } from '@/lib/pdf/renderPdf'
import { Spinner } from '@/components/ui/Spinner'
import type {
  BuilderTerms, CatalogOption, OptionGroup, Platform, Tier, Quote, QuoteOption,
} from '@/types/database'

interface Selection { [groupId: string]: string[] }

interface LeadLite {
  id: string
  builder_id: string
  stage: string
  platform_interest_id: string | null
  customer: { full_name: string | null; email: string | null } | null
}

export function QuoteEditor() {
  const { id: existingQuoteId } = useParams<{ id?: string }>()
  const [search] = useSearchParams()
  const leadIdFromQuery = search.get('lead')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // ---------- Load existing quote (if editing) ----------
  const { data: existing } = useQuery({
    queryKey: ['quote-edit', existingQuoteId],
    enabled: Boolean(existingQuoteId),
    queryFn: async () => {
      const q = await supabase
        .from('quotes')
        .select('*, quote_options(*, quote_option_finishes(finish_set_id, finish_id))')
        .eq('id', existingQuoteId!)
        .single()
      if (q.error) throw q.error
      return q.data as unknown as Quote & { quote_options: (QuoteOption & { quote_option_finishes: { finish_set_id: string; finish_id: string }[] })[] }
    },
  })

  // Lead id for new or existing
  const leadId = existing?.lead_id ?? leadIdFromQuery
  const { data: lead } = useQuery({
    queryKey: ['quote-lead', leadId],
    enabled: Boolean(leadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, builder_id, stage, platform_interest_id, customer:customers(full_name, email)')
        .eq('id', leadId!)
        .single()
      if (error) throw error
      return data as unknown as LeadLite
    },
  })

  // Catalog scoped by builder
  const { data: catalog } = useQuery({
    queryKey: ['quote-catalog', lead?.builder_id],
    enabled: Boolean(lead?.builder_id),
    queryFn: async () => {
      const builderId = lead!.builder_id
      const [plat, tie, grp, opt, terms] = await Promise.all([
        supabase.from('catalog_platforms').select('*').eq('builder_id', builderId).eq('active', true).order('sort'),
        supabase.from('catalog_tiers').select('*').eq('builder_id', builderId).eq('active', true).order('sort'),
        // Explicit column list (including allow_quantity) so a lagging
        // PostgREST schema cache can't silently drop the field and let
        // the editor fall back to qty 1. Only strictly-declared columns
        // are listed — the Phase-4 sync extras (synced/external_id/
        // active) deliberately aren't in the Database TS type.
        supabase.from('catalog_option_groups')
          .select('id, builder_id, platform_id, slug, name, selection, required, sort, allow_quantity, created_at, updated_at')
          .eq('builder_id', builderId).order('sort'),
        supabase.from('catalog_options').select('*').eq('builder_id', builderId).eq('active', true).order('sort'),
        supabase.from('builder_terms')
          .select('option_mode, pricing_mode, partner_shop_rate_cents, in_house_labour_cost_cents, default_labour_source, hh_fee_pct, labour_rate_cents, paint_rate_cents')
          .eq('builder_id', builderId).maybeSingle(),
      ])
      if (plat.error) throw plat.error
      if (tie.error) throw tie.error
      if (grp.error) throw grp.error
      if (opt.error) throw opt.error
      if (terms.error) throw terms.error

      // Scope the restriction fetch to THIS builder's active options
      // so cross-builder link rows can't leak into the filter.
      const builderOptionIds = (opt.data ?? []).map(o => o.id)
      let optionPlatforms: { option_id: string; platform_id: string }[] = []
      if (builderOptionIds.length > 0) {
        const op = await supabase
          .from('catalog_option_platforms')
          .select('option_id, platform_id')
          .in('option_id', builderOptionIds)
        if (op.error) throw op.error
        optionPlatforms = (op.data ?? []) as typeof optionPlatforms
      }

      const tData = terms.data as (Pick<BuilderTerms, 'option_mode' | 'pricing_mode' | 'partner_shop_rate_cents' | 'in_house_labour_cost_cents' | 'default_labour_source' | 'hh_fee_pct' | 'labour_rate_cents' | 'paint_rate_cents'> | null)
      const optionMode = tData?.option_mode ?? 'priced'
      const pricingMode = tData?.pricing_mode ?? 'simple'

      // Cost model inputs needed for the ops Margin panel.
      let categories: { id: string; install_hours: number; paint_hours: number; paint_materials_cents: number }[] = []
      let finishSets: { id: string; name: string; applies_to_category_ids: string[]; sort: number }[] = []
      let finishes: { id: string; finish_set_id: string; name: string; paint_hours_override: number | null; materials_cents_override: number | null; sort: number; active: boolean }[] = []
      if (pricingMode === 'cost_based') {
        const [cr, fsr, fr] = await Promise.all([
          supabase.from('catalog_categories').select('id, install_hours, paint_hours, paint_materials_cents').eq('builder_id', builderId),
          supabase.from('catalog_finish_sets').select('id, name, applies_to_category_ids, sort').eq('builder_id', builderId).order('sort'),
          supabase.from('catalog_finishes').select('id, finish_set_id, name, paint_hours_override, materials_cents_override, sort, active').eq('active', true).order('sort'),
        ])
        if (cr.error) throw cr.error
        if (fsr.error) throw fsr.error
        if (fr.error) throw fr.error
        categories = (cr.data ?? []) as typeof categories
        finishSets = (fsr.data ?? []) as typeof finishSets
        finishes = (fr.data ?? []) as typeof finishes
      }

      return {
        platforms: (plat.data ?? []) as Platform[],
        tiers: (tie.data ?? []) as Tier[],
        groups: (grp.data ?? []) as OptionGroup[],
        options: (opt.data ?? []) as CatalogOption[],
        optionPlatforms,
        optionMode: optionMode as 'included_only' | 'priced',
        pricingMode: pricingMode as 'simple' | 'cost_based',
        partnerShopRateCents: tData?.partner_shop_rate_cents ?? 11000,
        inHouseLabourCostCents: tData?.in_house_labour_cost_cents ?? 6500,
        defaultLabourSource: (tData?.default_labour_source ?? 'partner_shop') as 'in_house' | 'partner_shop',
        labourRateCents: tData?.labour_rate_cents ?? 20000,
        paintRateCents: tData?.paint_rate_cents ?? 20000,
        hhFeePct: Number(tData?.hh_fee_pct ?? 0.05),
        categories,
        finishSets,
        finishes,
      }
    },
  })

  const [platformId, setPlatformId] = useState<string>('')
  const [tierId, setTierId] = useState<string>('')
  const [selection, setSelection] = useState<Selection>({})
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  // optionId → setId → finishId. One finish per applicable set.
  const [finishByOption, setFinishByOption] = useState<Record<string, Record<string, string>>>({})
  const [finishNoteByOption, setFinishNoteByOption] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<string>('')
  // Lookbook PDF (cost_based builders) consumes these two.
  // theme_words: short tag line on the cover ("Carbon · Bronze · All-Terrain").
  // vehicle_colour: the customer's existing paint — we don't repaint,
  //   but the Lookbook renders a swatch of it on page 2.
  const [themeWords, setThemeWords] = useState<string>('')
  const [vehicleColour, setVehicleColour] = useState<string>('')
  const [vehicleYear, setVehicleYear] = useState<string>('')
  const [vehiclePhotoUrl, setVehiclePhotoUrl] = useState<string>('')
  const [vehiclePhotoUploading, setVehiclePhotoUploading] = useState(false)
  // Labour source for the margin panel. Default = builder_terms
  // default_labour_source; overridden by quote.labour_source once a
  // quote has been saved. Explicit state here so a flip in the editor
  // immediately updates the margin numbers and the save flow.
  const [labourSource, setLabourSource] = useState<'in_house' | 'partner_shop' | null>(null)

  useEffect(() => {
    if (existing) {
      setPlatformId(existing.platform_id)
      setTierId(existing.tier_id)
      setNotes(existing.notes ?? '')
      const sel: Selection = {}
      const qty: Record<string, number> = {}
      const fin: Record<string, Record<string, string>> = {}
      const finNote: Record<string, string> = {}
      // Need to map option_id → group_id; done once catalog is loaded
      if (catalog) {
        for (const qo of existing.quote_options) {
          const opt = catalog.options.find(o => o.id === qo.option_id)
          if (!opt) continue
          sel[opt.group_id] = [...(sel[opt.group_id] ?? []), qo.option_id]
          qty[qo.option_id] = qo.quantity ?? 1
          for (const row of qo.quote_option_finishes ?? []) {
            fin[qo.option_id] = { ...(fin[qo.option_id] ?? {}), [row.finish_set_id]: row.finish_id }
          }
          if (qo.finish_note) finNote[qo.option_id] = qo.finish_note
        }
        setSelection(sel)
        setQuantities(qty)
        setFinishByOption(fin)
        setFinishNoteByOption(finNote)
      }
      if (existing.labour_source) setLabourSource(existing.labour_source)
      setThemeWords(existing.theme_words ?? '')
      setVehicleColour(existing.vehicle_colour ?? '')
      setVehicleYear(existing.vehicle_year == null ? '' : String(existing.vehicle_year))
      setVehiclePhotoUrl(existing.vehicle_photo_url ?? '')
    } else if (lead?.platform_interest_id && !platformId) {
      setPlatformId(lead.platform_interest_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, catalog, lead?.platform_interest_id])

  const platform = useMemo(() => catalog?.platforms.find(p => p.id === platformId) ?? null, [catalog, platformId])
  const tier = useMemo(() => catalog?.tiers.find(t => t.id === tierId) ?? null, [catalog, tierId])

  // Effective labour source for margin calc + snapshot. State wins
  // if the operator has picked one; otherwise fall back to the quote
  // record (loaded above) or the builder default.
  const effectiveLabourSource: 'in_house' | 'partner_shop' =
    labourSource ?? existing?.labour_source ?? catalog?.defaultLabourSource ?? 'partner_shop'

  const includedOnly = catalog?.optionMode === 'included_only'

  const platformGroups = useMemo(
    () => (catalog?.groups ?? []).filter(g => g.platform_id === null || g.platform_id === platform?.id),
    [catalog, platform]
  )

  /** Map option_id → set of platform_ids it's restricted to. Options
   *  without any rows are universal (allowed on every platform). */
  const optionPlatformMap = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const op of catalog?.optionPlatforms ?? []) {
      if (!m.has(op.option_id)) m.set(op.option_id, new Set())
      m.get(op.option_id)!.add(op.platform_id)
    }
    return m
  }, [catalog])

  /** All options visible for the current platform + tier, respecting
   *  option_mode and catalog_option_platforms restrictions. */
  const visibleOptionsByGroup = useMemo(() => {
    const by = new Map<string, CatalogOption[]>()
    if (!catalog) return by
    // Nothing shows until a platform is chosen — options are platform-
    // scoped, and without a platform we can't tell which to render.
    if (!platform) return by
    for (const o of catalog.options) {
      if (includedOnly && tier && !o.included_in_tier_ids.includes(tier.id)) continue
      const restricted = optionPlatformMap.get(o.id)
      const isUniversal = !restricted || restricted.size === 0
      const linkedToCurrent = restricted?.has(platform.id) ?? false
      // Keep when the option is universal OR explicitly linked to the
      // chosen platform. Hide only when restricted to OTHER platforms.
      if (!isUniversal && !linkedToCurrent) continue
      if (!by.has(o.group_id)) by.set(o.group_id, [])
      by.get(o.group_id)!.push(o)
    }
    return by
  }, [catalog, includedOnly, tier, platform, optionPlatformMap])

  /** Groups with at least one visible option — empties are hidden. */
  const availableGroups = useMemo(
    () => platformGroups.filter(g => (visibleOptionsByGroup.get(g.id)?.length ?? 0) > 0),
    [platformGroups, visibleOptionsByGroup]
  )

  const groupById = useMemo(() => {
    const m = new Map<string, OptionGroup>()
    for (const g of catalog?.groups ?? []) m.set(g.id, g)
    return m
  }, [catalog])

  // Three cases:
  //  - sold_as_set wheels (kit SKUs): price is the kit price → qty 1
  //  - ordinary wheels in an allow_quantity group → 4 default, 5 w/ spare
  //  - everything else → qty 1
  function qtyFor(optionId: string): number {
    const opt = catalog?.options.find(o => o.id === optionId)
    if (!opt) return 1
    if (opt.sold_as_set) return 1
    const g = groupById.get(opt.group_id)
    if (!g?.allow_quantity) return 1
    return quantities[optionId] ?? 4
  }

  // Finish set that applies to this option (via its category), if any.
  // Finishes[] filtered to the set, sorted. The first finish is the
  // default when nothing has been picked.
  type FinishSetEntry = { set: NonNullable<typeof catalog>['finishSets'][number]; finishes: NonNullable<typeof catalog>['finishes'] }
  // category id → every finish set that applies, in sort order.
  const finishSetsByCategoryId = useMemo(() => {
    const m = new Map<string, FinishSetEntry[]>()
    if (!catalog) return m
    const sortedSets = [...catalog.finishSets].sort((a, b) => a.sort - b.sort)
    for (const fs of sortedSets) {
      const members = catalog.finishes
        .filter(f => f.finish_set_id === fs.id)
        .sort((a, b) => a.sort - b.sort)
      for (const catId of fs.applies_to_category_ids) {
        const list = m.get(catId) ?? []
        list.push({ set: fs, finishes: members })
        m.set(catId, list)
      }
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog])

  // All applicable finish sets for an option, with the current pick
  // (either the operator's choice or the first-sorted finish as the
  // default). Empty array if the option's category has no sets.
  function finishesForOption(opt: CatalogOption) {
    if (!opt.category_id) return []
    const entries = finishSetsByCategoryId.get(opt.category_id) ?? []
    const perOption = finishByOption[opt.id] ?? {}
    return entries
      .filter(e => e.finishes.length > 0)
      .map(e => {
        const pickedId = perOption[e.set.id]
        const match = pickedId ? e.finishes.find(f => f.id === pickedId) : undefined
        return { set: e.set, finishes: e.finishes, current: match ?? e.finishes[0] }
      })
  }

  // Resolve the effective paint hours / materials for an option by
  // walking every applicable finish set and taking the first non-null
  // override across them (sets in sort order). If no finish overrides
  // either field, fall back to the category default.
  function effectivePaintAndMaterials(opt: CatalogOption) {
    const cat = opt.category_id ? catalog?.categories.find(c => c.id === opt.category_id) : null
    const applied = finishesForOption(opt)
    let paintH: number | null = null
    let materials: number | null = null
    for (const a of applied) {
      if (paintH == null && a.current.paint_hours_override != null) paintH = a.current.paint_hours_override
      if (materials == null && a.current.materials_cents_override != null) materials = a.current.materials_cents_override
    }
    return {
      paintHours: paintH ?? Number(cat?.paint_hours ?? 0),
      materialsCents: materials ?? (cat?.paint_materials_cents ?? 0),
      installHours: Number(cat?.install_hours ?? 0),
    }
  }

  // Install price for a given option with the current finishes applied.
  // Null-safe for simple-mode builders.
  function installPriceForOption(opt: CatalogOption): number {
    if (catalog?.pricingMode !== 'cost_based' || opt.install_price_cents == null) {
      return opt.install_price_cents ?? 0
    }
    const applied = finishesForOption(opt)
    if (applied.length === 0) return opt.install_price_cents
    const { installHours, paintHours, materialsCents } = effectivePaintAndMaterials(opt)
    const labour = installHours * catalog.labourRateCents
      + paintHours * catalog.paintRateCents
    return Math.round(labour + materialsCents)
  }

  // Per-line cost snapshot. Captures the cost model at save time so a
  // sent quote never reprices when Terms or Categories change later.
  // Returns zeros when the builder isn't cost_based or data is missing
  // (snapshot columns are nullable).
  function snapshotFor(optionId: string, qty: number) {
    const opt = catalog?.options.find(o => o.id === optionId)
    if (!opt || catalog?.pricingMode !== 'cost_based') {
      return { parts_sell_cents: null, landed_cost_cents: null, labour_cents: null, materials_cents: null, partner_cost_cents: null }
    }
    const { installHours, paintHours, materialsCents } = effectivePaintAndMaterials(opt)
    const partsSell = (opt.parts_sell_cents ?? 0) * qty
    const landed    = (opt.landed_cost_cents ?? 0) * qty
    const labour = Math.round(
      installHours * catalog.labourRateCents
      + paintHours * catalog.paintRateCents
    )
    // partner_cost_cents holds the operator's labour cost at the
    // chosen source rate — single column so dashboard math doesn't
    // need to know which rate was picked. The quote's labour_source
    // documents the pick.
    const sourceRate = effectiveLabourSource === 'in_house'
      ? catalog.inHouseLabourCostCents
      : catalog.partnerShopRateCents
    const partnerCost = Math.round((installHours + paintHours) * sourceRate)
    return {
      parts_sell_cents: partsSell,
      landed_cost_cents: landed,
      labour_cents: labour,
      materials_cents: materialsCents,
      partner_cost_cents: partnerCost,
    }
  }

  // Per-line price in cents. For cost_based builders, quantity
  // multiplies parts but NOT labour (install_price_cents, with any
  // finish override applied). Everyone else keeps the legacy behaviour
  // where price_cents × qty is the line price.
  function lineCents(opt: CatalogOption, qty: number): number {
    if (catalog?.pricingMode === 'cost_based' && opt.parts_sell_cents != null) {
      return opt.parts_sell_cents * qty + installPriceForOption(opt)
    }
    return opt.price_cents * qty
  }

  const total = useMemo(() => {
    if (!tier || !catalog) return 0
    const base = tier.base_price_cents ?? 0
    if (includedOnly) return base
    const addons = Object.values(selection).flat().reduce((sum, optId) => {
      const opt = catalog.options.find(o => o.id === optId)
      if (!opt) return sum
      if (opt.included_in_tier_ids.includes(tier.id)) return sum
      return sum + lineCents(opt, qtyFor(optId))
    }, 0)
    return base + addons
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, quantities, catalog, tier, includedOnly])

  // Margin (ops only, cost_based builders): landed + partner labour +
  // materials + HH fee. Everything per-line, with quantity multiplying
  // landed parts but not labour/materials. Only renders when the
  // snapshot columns are present.
  const marginSummary = useMemo(() => {
    if (!tier || !catalog || catalog.pricingMode !== 'cost_based') return null
    const categoryById = new Map(catalog.categories.map(c => [c.id, c]))
    let landed = 0, labour = 0, materials = 0
    const sourceRate = effectiveLabourSource === 'in_house'
      ? catalog.inHouseLabourCostCents
      : catalog.partnerShopRateCents
    for (const optId of Object.values(selection).flat()) {
      const opt = catalog.options.find(o => o.id === optId)
      if (!opt) continue
      const qty = qtyFor(optId)
      landed += (opt.landed_cost_cents ?? 0) * qty
      if (opt.category_id && categoryById.has(opt.category_id)) {
        const { installHours, paintHours, materialsCents } = effectivePaintAndMaterials(opt)
        labour    += (installHours + paintHours) * sourceRate
        materials += materialsCents
      }
    }
    const sale = total
    const hhFee = Math.round(sale * catalog.hhFeePct)
    const grossBefore = sale - landed - labour - materials
    const grossAfter = grossBefore - hhFee
    const marginPct = sale > 0 ? grossAfter / sale : 0
    return { sale, landed, labour, materials, hhFee, grossBefore, grossAfter, marginPct }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, quantities, finishByOption, catalog, tier, total, effectiveLabourSource])

  // Options that get added to the quote automatically when any option
  // in the referenced group is selected on the current platform. Right
  // now this is the Grenadier BFG and Defender Pirelli tyres linked to
  // the Alloy wheels group; the editor swaps them in without ops action.
  function autoAddTargetsForGroup(groupId: string): CatalogOption[] {
    if (!catalog || !platform) return []
    return catalog.options.filter(o => {
      if (o.auto_add_with_group_id !== groupId) return false
      // Platform eligibility matches the general visibility rule.
      const restricted = optionPlatformMap.get(o.id)
      const isUniversal = !restricted || restricted.size === 0
      return isUniversal || restricted!.has(platform.id)
    })
  }

  function toggleOption(group: OptionGroup, optionId: string) {
    const wasSelected = (selection[group.id] ?? []).includes(optionId)
    const addingNew = !wasSelected
    setSelection(prev => {
      const current = prev[group.id] ?? []
      const next = { ...prev }
      if (group.selection === 'single') {
        next[group.id] = current[0] === optionId ? [] : [optionId]
      } else {
        next[group.id] = current.includes(optionId)
          ? current.filter(id => id !== optionId)
          : [...current, optionId]
      }
      // Auto-add: when a NEW option in a group with auto-add targets
      // is selected, drop the target into its own group's slot.
      // Respects the target group's selection mode (single = swap).
      if (addingNew) {
        for (const t of autoAddTargetsForGroup(group.id)) {
          const tGroup = catalog!.groups.find(g => g.id === t.group_id)
          if (!tGroup) continue
          const tCurrent = next[tGroup.id] ?? []
          if (tCurrent.includes(t.id)) continue
          next[tGroup.id] = tGroup.selection === 'single'
            // Single-select: only populate the empty slot. If the
            // operator has already picked a different tyre in this
            // slot, respect it — swapping would surprise them.
            ? (tCurrent.length === 0 ? [t.id] : tCurrent)
            : [...tCurrent, t.id]
        }
      }
      return next
    })
    setQuantities(prev => {
      const next = { ...prev }
      if (wasSelected) {
        delete next[optionId]
      } else if (addingNew) {
        // Mirror the triggering option's qty onto any auto-added
        // targets so a Set-of-5 wheel pulls a Set-of-5 tyre.
        const triggerQty = prev[optionId] ?? 4
        for (const t of autoAddTargetsForGroup(group.id)) {
          next[t.id] = triggerQty
        }
      }
      return next
    })
  }

  // Wraps setQuantities so a wheel chip click mirrors onto the auto-
  // added tyre line. Qty updates on the tyre tile itself are not
  // mirrored back onto the wheel — the ops user is the source of truth.
  function setQtyWithMirror(opt: CatalogOption, n: number) {
    setQuantities(prev => {
      const next = { ...prev, [opt.id]: n }
      for (const other of catalog?.options ?? []) {
        if (other.auto_add_with_group_id !== opt.group_id) continue
        if (!Object.values(selection).flat().includes(other.id)) continue
        next[other.id] = n
      }
      return next
    })
  }

  // True when the given option is currently in the quote because of
  // an auto-add link to a selected wheel (used to render the badge).
  function isAutoAdded(opt: CatalogOption): boolean {
    if (!opt.auto_add_with_group_id) return false
    const trigger = selection[opt.auto_add_with_group_id] ?? []
    return trigger.length > 0
  }

  // Insert quote_options for every selected option and link the
  // picked finishes via quote_option_finishes. Shared between the
  // new-quote and the existing-quote resave paths.
  async function writeOptionsAndFinishes(quoteId: string, tierIdNow: string) {
    const rows = Object.values(selection).flat().map(optionId => {
      const opt = catalog!.options.find(o => o.id === optionId)!
      const included = opt.included_in_tier_ids.includes(tierIdNow)
      const qty = qtyFor(optionId)
      return {
        quote_id: quoteId,
        option_id: optionId,
        price_cents_at_selection: included ? 0 : opt.price_cents,
        quantity: qty,
        finish_note: finishNoteByOption[optionId]?.trim() || null,
        ...snapshotFor(optionId, qty),
      }
    })
    if (rows.length === 0) return
    const ins = await supabase.from('quote_options').insert(rows).select('id, option_id')
    if (ins.error) throw ins.error
    const idByOption = new Map<string, string>((ins.data as { id: string; option_id: string }[]).map(r => [r.option_id, r.id]))
    const links: { quote_option_id: string; finish_set_id: string; finish_id: string }[] = []
    for (const optionId of Object.values(selection).flat()) {
      const opt = catalog!.options.find(o => o.id === optionId)!
      const applied = finishesForOption(opt)
      const qoId = idByOption.get(optionId)
      if (!qoId) continue
      for (const a of applied) {
        links.push({ quote_option_id: qoId, finish_set_id: a.set.id, finish_id: a.current.id })
      }
    }
    if (links.length) {
      const lr = await supabase.from('quote_option_finishes').insert(links)
      if (lr.error) throw lr.error
    }
  }

  // ---------- Save / revise / send / create contract ----------
  const save = useMutation({
    mutationFn: async () => {
      if (!lead || !platformId || !tierId) throw new Error('Pick a platform and tier')
      if (existing) {
        const { error: upErr } = await supabase
          .from('quotes')
          .update({
            platform_id: platformId, tier_id: tierId, price_cents: total, notes,
            labour_source: effectiveLabourSource,
            theme_words: themeWords.trim() || null,
            vehicle_colour: vehicleColour.trim() || null,
            vehicle_year: vehicleYear.trim() ? Number(vehicleYear) : null,
            vehicle_photo_url: vehiclePhotoUrl.trim() || null,
          })
          .eq('id', existing.id)
        if (upErr) throw upErr
        await supabase.from('quote_options').delete().eq('quote_id', existing.id)
        await writeOptionsAndFinishes(existing.id, tierId)
        return existing.id
      }
      // New: find next version
      const vRes = await supabase
        .from('quotes')
        .select('version')
        .eq('lead_id', lead.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextVersion = ((vRes.data as { version?: number } | null)?.version ?? 0) + 1
      const q = await supabase.from('quotes').insert({
        lead_id: lead.id,
        builder_id: lead.builder_id,
        version: nextVersion,
        platform_id: platformId,
        tier_id: tierId,
        price_cents: total,
        status: 'draft',
        notes,
        labour_source: effectiveLabourSource,
        theme_words: themeWords.trim() || null,
        vehicle_colour: vehicleColour.trim() || null,
        vehicle_year: vehicleYear.trim() ? Number(vehicleYear) : null,
        vehicle_photo_url: vehiclePhotoUrl.trim() || null,
      }).select('id').single()
      if (q.error) throw q.error
      const quoteId = (q.data as { id: string }).id

      await writeOptionsAndFinishes(quoteId, tierId)
      await supabase.from('quote_events').insert({ quote_id: quoteId, kind: 'created' })
      await supabase.from('leads').update({ stage: 'quoting' }).eq('id', lead.id)
      return quoteId
    },
    onSuccess: (quoteId) => {
      setStatus('Saved'); setErr(null)
      qc.invalidateQueries({ queryKey: ['quotes'] })
      qc.invalidateQueries({ queryKey: ['lead'] })
      if (!existingQuoteId) navigate(`/ops/quotes/${quoteId}`, { replace: true })
    },
    onError: e => setErr((e as Error).message),
  })

  const generatePdf = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error('Save the quote first')
      return await renderQuotePdfToStorage(existing.id)
    },
    onSuccess: url => {
      setStatus(`PDF ready: ${url}`)
      qc.invalidateQueries({ queryKey: ['quote-edit', existingQuoteId] })
    },
    onError: e => setErr((e as Error).message),
  })

  const send = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error('Save the quote first')
      await invokeFn('send-quote', { quote_id: existing.id })
    },
    onSuccess: () => {
      setStatus('Sent')
      qc.invalidateQueries({ queryKey: ['quote-edit', existingQuoteId] })
      qc.invalidateQueries({ queryKey: ['lead'] })
    },
    onError: e => setErr((e as Error).message),
  })

  const revise = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error('Save the quote first')
      // Mark current superseded + bump lead to revising
      await supabase.from('quotes').update({ status: 'superseded' }).eq('id', existing.id)
      await supabase.from('leads').update({ stage: 'revising' }).eq('id', existing.lead_id)
      // Clone to new version
      const nextVersion = existing.version + 1
      const insQuote = await supabase.from('quotes').insert({
        lead_id: existing.lead_id,
        builder_id: existing.builder_id,
        version: nextVersion,
        platform_id: existing.platform_id,
        tier_id: existing.tier_id,
        price_cents: existing.price_cents,
        status: 'draft',
        notes: existing.notes,
        labour_source: existing.labour_source,
      }).select('id').single()
      if (insQuote.error) throw insQuote.error
      const newQuoteId = (insQuote.data as { id: string }).id
      // Copy options — preserve the original snapshot. A revise is
      // still the same price-at-the-time; a resave rewrites the
      // snapshot via the regular save flow.
      const copies = existing.quote_options.map(qo => ({
        quote_id: newQuoteId,
        option_id: qo.option_id,
        price_cents_at_selection: qo.price_cents_at_selection,
        quantity: qo.quantity ?? 1,
        parts_sell_cents: qo.parts_sell_cents ?? null,
        landed_cost_cents: qo.landed_cost_cents ?? null,
        labour_cents: qo.labour_cents ?? null,
        materials_cents: qo.materials_cents ?? null,
        partner_cost_cents: qo.partner_cost_cents ?? null,
        finish_note: qo.finish_note ?? null,
      }))
      if (copies.length) {
        const ir = await supabase.from('quote_options').insert(copies).select('id, option_id')
        if (ir.error) throw ir.error
        // Carry finish picks forward on the clone.
        const newIdByOption = new Map<string, string>((ir.data as { id: string; option_id: string }[]).map(r => [r.option_id, r.id]))
        const finishRows: { quote_option_id: string; finish_set_id: string; finish_id: string }[] = []
        for (const qo of existing.quote_options) {
          const newId = newIdByOption.get(qo.option_id)
          if (!newId) continue
          for (const row of qo.quote_option_finishes ?? []) {
            finishRows.push({ quote_option_id: newId, finish_set_id: row.finish_set_id, finish_id: row.finish_id })
          }
        }
        if (finishRows.length) {
          const fr = await supabase.from('quote_option_finishes').insert(finishRows)
          if (fr.error) throw fr.error
        }
      }
      await supabase.from('quote_events').insert({ quote_id: newQuoteId, kind: 'revised' })
      return newQuoteId
    },
    onSuccess: (newQuoteId) => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      navigate(`/ops/quotes/${newQuoteId}`, { replace: true })
    },
    onError: e => setErr((e as Error).message),
  })

  const createContract = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error('Save the quote first')
      if (existing.status !== 'approved') throw new Error('Only approved quotes convert to builds')
      // Load lead → customer link
      const leadRes = await supabase.from('leads').select('customer_id').eq('id', existing.lead_id).single()
      if (leadRes.error) throw leadRes.error
      // Build row
      const slotYear = new Date().getUTCFullYear()
      const maxRes = await supabase
        .from('builds')
        .select('slot_number')
        .eq('builder_id', existing.builder_id)
        .eq('slot_year', slotYear)
        .order('slot_number', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      const slotNumber = ((maxRes.data as { slot_number?: number } | null)?.slot_number ?? 0) + 1
      const buildIns = await supabase.from('builds').insert({
        builder_id: existing.builder_id,
        customer_id: (leadRes.data as { customer_id: string }).customer_id,
        platform_id: existing.platform_id,
        tier_id: existing.tier_id,
        stage: 'contract',
        slot_year: slotYear,
        slot_number: slotNumber,
        price_cents: existing.price_cents,
        quote_id: existing.id,
      }).select('id').single()
      if (buildIns.error) throw buildIns.error
      const buildId = (buildIns.data as { id: string }).id
      // Copy options to build_options
      const rows = existing.quote_options.map(qo => ({
        build_id: buildId,
        option_id: qo.option_id,
        price_cents_at_selection: qo.price_cents_at_selection,
        quantity: qo.quantity ?? 1,
      }))
      if (rows.length) await supabase.from('build_options').insert(rows)
      await supabase.from('build_stage_events').insert({
        build_id: buildId, from_stage: null, to_stage: 'contract', note: 'Created from quote',
      })
      await supabase.from('leads').update({ stage: 'contract_sent' }).eq('id', existing.lead_id)
      return buildId
    },
    onSuccess: buildId => navigate(`/ops/builds/${buildId}`),
    onError: e => setErr((e as Error).message),
  })

  // Latest builder_push_log for this quote
  const { data: lastPush, refetch: refetchPush } = useQuery({
    queryKey: ['builder-push-log', existing?.id],
    enabled: Boolean(existing?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('builder_push_log')
        .select('status, error, http_status, created_at')
        .eq('quote_id', existing!.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as {
        status: 'success' | 'error' | 'pending'
        error: string | null
        http_status: number | null
        created_at: string
      } | null
    },
    refetchInterval: 5000,
  })

  const retryPush = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error('Save the quote first')
      await invokeFn('push-quote-to-builder', { quote_id: existing.id })
    },
    onSuccess: () => { setStatus('Pushed to builder'); refetchPush() },
    onError: e => setErr((e as Error).message),
  })

  if (leadId && !lead) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }
  if (!catalog) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }

  const customer = lead?.customer
  const readOnly = existing?.status === 'superseded' || existing?.status === 'approved'

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <Link to={lead ? `/ops/leads/${lead.id}` : '/ops/leads'} className="text-xs text-[var(--color-muted)] hover:underline">
              ← {lead ? 'Lead' : 'Leads'}
            </Link>
            <h1 className="text-2xl mt-2" style={{ fontFamily: 'var(--font-display)' }}>
              {existing ? `Quote v${existing.version}` : 'New quote'}
              {existing?.status && (
                <span className="ml-3 text-xs font-normal px-2 py-1 rounded bg-[var(--color-surface-raised)] text-[var(--color-muted)] uppercase">
                  {existing.status}
                </span>
              )}
            </h1>
            <p className="text-sm text-[var(--color-muted)] mt-1">
              {customer?.full_name ?? customer?.email ?? '—'}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-[var(--color-muted)]">Total</div>
            <div className="text-3xl" style={{ fontFamily: 'var(--font-display)' }}>
              ${(total / 100).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Step: Platform */}
        <Step label="Platform">
          <div className="grid gap-3 sm:grid-cols-3">
            {catalog.platforms.map(p => (
              <button
                key={p.id}
                disabled={readOnly}
                onClick={() => setPlatformId(p.id)}
                className={`text-left rounded-[var(--radius-md)] border px-4 py-3 transition ${
                  platformId === p.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                } disabled:opacity-50`}
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-[var(--color-muted)] mt-0.5">{p.chassis} · {p.years}</div>
              </button>
            ))}
          </div>
        </Step>

        {platformId && (
          <Step label="Tier">
            <div className="grid gap-3 sm:grid-cols-3">
              {catalog.tiers.map(t => (
                <button
                  key={t.id}
                  disabled={readOnly}
                  onClick={() => setTierId(t.id)}
                  className={`text-left rounded-[var(--radius-md)] border px-4 py-3 transition ${
                    tierId === t.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface)]'
                      : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                  } disabled:opacity-50`}
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-[var(--color-muted)] mt-0.5">
                    {t.quote_only ? 'By quote' : t.base_price_cents != null ? `$${(t.base_price_cents / 100).toLocaleString()}` : '—'}
                  </div>
                </button>
              ))}
            </div>
          </Step>
        )}

        {platformId && tier && (
          <Step label="Options">
            <div className="space-y-5">
              {availableGroups.map(group => {
                const opts = visibleOptionsByGroup.get(group.id) ?? []
                const chosen = new Set(selection[group.id] ?? [])
                return (
                  <div key={group.id}>
                    <h3 className="text-sm font-medium mb-2">{group.name}
                      <span className="ml-2 text-xs text-[var(--color-muted)] uppercase">
                        {group.selection}
                      </span>
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {opts.map(opt => {
                        const included = opt.included_in_tier_ids.includes(tier.id)
                        const active = chosen.has(opt.id)
                        const priceMissing = !includedOnly && !included && opt.price_cents === 0
                        const q = qtyFor(opt.id)
                        const extendedCents = included ? 0 : lineCents(opt, q)
                        return (
                          <div key={opt.id} className="space-y-1.5">
                            <button
                              disabled={readOnly}
                              onClick={() => toggleOption(group, opt.id)}
                              className={`w-full flex items-center justify-between gap-3 text-left rounded-[var(--radius-sm)] border px-3 py-2 transition ${
                                active
                                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)]'
                                  : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                              } disabled:opacity-50`}
                              title={priceMissing ? `Set a price on ${opt.name} in Catalog → Options` : undefined}
                            >
                              <div className="flex items-center gap-3">
                                {opt.swatch_image_url ? (
                                  <img src={opt.swatch_image_url} alt="" className="h-8 w-8 rounded-sm object-cover" />
                                ) : (
                                  <div className="h-8 w-8 rounded-sm bg-[var(--color-surface-raised)]" />
                                )}
                                <div>
                                  <div className="text-sm">{opt.name}</div>
                                  {opt.code && <div className="text-xs text-[var(--color-muted)]">{opt.code}</div>}
                                  {opt.sold_as_set && active && (
                                    <div className="text-xs text-[var(--color-accent)]">Set of 4</div>
                                  )}
                                  {active && isAutoAdded(opt) && (
                                    <div className="text-xs text-[var(--color-muted)] italic">Added with wheels</div>
                                  )}
                                </div>
                              </div>
                              {!includedOnly && (
                                <div className="text-xs shrink-0 text-right">
                                  {included ? (
                                    <span className="text-[var(--color-muted)]">Included</span>
                                  ) : (
                                    <>
                                      <span className={priceMissing ? 'text-[var(--color-danger)]' : 'text-[var(--color-muted)]'}>
                                        +${(extendedCents / 100).toLocaleString()}
                                      </span>
                                      {priceMissing && (
                                        <div className="text-[10px] text-[var(--color-danger)] mt-0.5">
                                          Set a price
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </button>
                            {active && group.allow_quantity && !opt.sold_as_set && (
                              <div className="flex gap-1.5 pl-11">
                                {[4, 5].map(n => (
                                  <button
                                    key={n}
                                    type="button"
                                    disabled={readOnly}
                                    onClick={() => setQtyWithMirror(opt, n)}
                                    className={`text-[11px] px-2 py-1 rounded-[var(--radius-sm)] border transition ${
                                      q === n
                                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                                        : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)]'
                                    } disabled:opacity-50`}
                                  >
                                    {n === 4 ? 'Set of 4' : 'Set of 4 + matching spare'}
                                  </button>
                                ))}
                              </div>
                            )}
                            {active && (() => {
                              const applied = finishesForOption(opt)
                              if (applied.length === 0) return null
                              return (
                                <div className="pl-11 space-y-2">
                                  {applied.map(a => {
                                    const currentId = finishByOption[opt.id]?.[a.set.id] ?? a.current.id
                                    return (
                                      <div key={a.set.id} className="space-y-1">
                                        <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                                          {a.set.name}
                                        </div>
                                        <div className="flex gap-1.5 flex-wrap">
                                          {a.finishes.map(f => (
                                            <button
                                              key={f.id}
                                              type="button"
                                              disabled={readOnly}
                                              onClick={() => setFinishByOption(prev => ({
                                                ...prev,
                                                [opt.id]: { ...(prev[opt.id] ?? {}), [a.set.id]: f.id },
                                              }))}
                                              className={`text-[11px] px-2 py-1 rounded-[var(--radius-sm)] border transition ${
                                                currentId === f.id
                                                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                                                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)]'
                                              } disabled:opacity-50`}
                                            >
                                              {f.name}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )
                                  })}
                                  <input
                                    type="text"
                                    disabled={readOnly}
                                    value={finishNoteByOption[opt.id] ?? ''}
                                    onChange={e => setFinishNoteByOption(prev => ({ ...prev, [opt.id]: e.target.value }))}
                                    placeholder="Note (paint code, custom detail, …)"
                                    className="h-7 w-full max-w-xs text-[11px] px-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] disabled:opacity-50"
                                  />
                                </div>
                              )
                            })()}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </Step>
        )}

        {catalog?.pricingMode === 'cost_based' && (
          <Step label="Vehicle">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-[var(--color-muted)] mb-1 block">Theme words</label>
                <input
                  value={themeWords}
                  onChange={e => setThemeWords(e.target.value)}
                  disabled={readOnly}
                  placeholder="Carbon · Bronze · All-Terrain"
                  className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--color-muted)] mb-1 block">Vehicle year</label>
                <input
                  type="number"
                  min={1950}
                  max={2100}
                  value={vehicleYear}
                  onChange={e => setVehicleYear(e.target.value)}
                  disabled={readOnly}
                  placeholder="2024"
                  className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm disabled:opacity-50"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-[var(--color-muted)] mb-1 block">Vehicle colour</label>
                <input
                  value={vehicleColour}
                  onChange={e => setVehicleColour(e.target.value)}
                  disabled={readOnly}
                  placeholder="Carpathian Grey"
                  className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm disabled:opacity-50"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-[var(--color-muted)] mb-1 block">Vehicle photo (optional)</label>
                <div className="flex items-start gap-3">
                  {vehiclePhotoUrl ? (
                    <img src={vehiclePhotoUrl} alt="Vehicle" className="w-32 h-20 object-cover rounded-[var(--radius-sm)] border border-[var(--color-border)]" />
                  ) : (
                    <div className="w-32 h-20 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-center text-xs text-[var(--color-muted)]">
                      No photo
                    </div>
                  )}
                  <div className="flex-1 flex flex-col gap-1.5">
                    <input
                      type="file"
                      accept="image/*"
                      disabled={readOnly || vehiclePhotoUploading}
                      onChange={async e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        setVehiclePhotoUploading(true); setErr(null)
                        try {
                          const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
                          const path = `vehicles/quote-${existing?.id ?? lead?.id ?? Date.now()}-${Date.now()}.${ext}`
                          const up = await supabase.storage.from('media').upload(path, file, { upsert: true, contentType: file.type })
                          if (up.error) throw up.error
                          const { data: pub } = supabase.storage.from('media').getPublicUrl(path)
                          setVehiclePhotoUrl(pub.publicUrl)
                        } catch (err) {
                          setErr((err as Error).message)
                        } finally {
                          setVehiclePhotoUploading(false)
                        }
                      }}
                      className="text-xs"
                    />
                    {vehiclePhotoUrl && !readOnly && (
                      <button
                        type="button"
                        onClick={() => setVehiclePhotoUrl('')}
                        className="self-start text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                      >
                        Remove photo
                      </button>
                    )}
                    {vehiclePhotoUploading && <span className="text-xs text-[var(--color-muted)]">Uploading…</span>}
                  </div>
                </div>
              </div>
            </div>
          </Step>
        )}

        <Step label="Notes">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            disabled={readOnly}
            placeholder="Internal notes (do not appear on the PDF)"
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm disabled:opacity-50"
          />
        </Step>

        <div className="flex flex-wrap gap-2 items-center mt-6">
          {!readOnly && (
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {save.isPending ? <Spinner size={13} /> : <Save size={13} />}
              Save draft
            </button>
          )}
          {existing && (
            <>
              <button
                onClick={() => generatePdf.mutate()}
                disabled={generatePdf.isPending}
                className="h-9 px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {generatePdf.isPending ? <Spinner size={13} /> : <FileText size={13} />}
                Generate PDF
              </button>
              <button
                onClick={() => send.mutate()}
                disabled={send.isPending || existing.status === 'approved' || existing.status === 'superseded'}
                className="h-9 px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {send.isPending ? <Spinner size={13} /> : <Send size={13} />}
                Send
              </button>
              <button
                onClick={() => revise.mutate()}
                disabled={revise.isPending || existing.status === 'superseded'}
                className="h-9 px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {revise.isPending ? <Spinner size={13} /> : <Copy size={13} />}
                Revise
              </button>
              <button
                onClick={() => createContract.mutate()}
                disabled={createContract.isPending || existing.status !== 'approved'}
                className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                title={existing.status !== 'approved' ? 'Only approved quotes convert to builds' : undefined}
              >
                {createContract.isPending ? <Spinner size={13} /> : <Hammer size={13} />}
                Create contract
              </button>
              {existing.pdf_url && (
                <a
                  href={existing.pdf_url}
                  target="_blank"
                  rel="noreferrer"
                  className="h-9 px-3 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
                >
                  Open PDF <ExternalLink size={11} />
                </a>
              )}
              <Link
                to={`/q/${existing.token}`}
                target="_blank"
                rel="noreferrer"
                className="h-9 px-3 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
              >
                Public preview <ExternalLink size={11} />
              </Link>
            </>
          )}
          {status && <span className="text-xs text-[var(--color-success)]">{status}</span>}
          {err && <span className="text-xs text-[var(--color-danger)]">{err}</span>}
        </div>

        {marginSummary && (() => {
          const m = marginSummary
          const pct = m.marginPct * 100
          const colour = pct < 20 ? 'text-[var(--color-danger)]'
            : pct < 25 ? 'text-amber-600'
            : 'text-[var(--color-success)]'
          const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          return (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Margin · ops only</div>
                <div className="flex gap-1" role="group" aria-label="Labour source">
                  {(['in_house','partner_shop'] as const).map(src => (
                    <button
                      key={src}
                      type="button"
                      disabled={readOnly}
                      onClick={() => setLabourSource(src)}
                      className={`text-[11px] px-2 py-1 rounded border transition ${
                        effectiveLabourSource === src
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                          : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)]'
                      } disabled:opacity-50`}
                    >
                      {src === 'in_house' ? 'In-house' : 'Partner shop'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div><div className="text-[var(--color-muted)]">Sale price</div><div className="text-sm">{money(m.sale)}</div></div>
                <div><div className="text-[var(--color-muted)]">Parts landed</div><div className="text-sm">{money(m.landed)}</div></div>
                <div>
                  <div className="text-[var(--color-muted)]">
                    Labour cost + materials {effectiveLabourSource === 'in_house' ? '(in-house)' : '(partner shop)'}
                  </div>
                  <div className="text-sm">{money(m.labour + m.materials)}</div>
                </div>
                <div><div className="text-[var(--color-muted)]">HH fee</div><div className="text-sm">{money(m.hhFee)}</div></div>
              </div>
              <div className="mt-3 flex items-end justify-between pt-3 border-t border-[var(--color-border)]">
                <div>
                  <div className="text-xs text-[var(--color-muted)]">Gross margin after HH</div>
                  <div className={`text-lg ${colour}`}>{money(m.grossAfter)}</div>
                </div>
                <div className={`text-2xl font-mono ${colour}`}>{pct.toFixed(1)}%</div>
              </div>
            </div>
          )
        })()}

        {existing && lastPush && (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs uppercase tracking-wide text-[var(--color-muted)] mr-2">Builder push</span>
                <span className={lastPush.status === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-foreground)]'}>
                  {lastPush.status}
                  {lastPush.http_status != null ? ` · HTTP ${lastPush.http_status}` : ''}
                  {lastPush.error ? ` — ${lastPush.error}` : ''}
                </span>
                <span className="ml-2 text-xs text-[var(--color-muted)]">
                  {new Date(lastPush.created_at).toLocaleString()}
                </span>
              </div>
              {lastPush.status === 'error' && (
                <button
                  onClick={() => retryPush.mutate()}
                  disabled={retryPush.isPending}
                  className="h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-xs inline-flex items-center gap-1.5 hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
                >
                  {retryPush.isPending && <Spinner size={11} />}
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Step({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">{label}</h2>
      {children}
    </div>
  )
}
