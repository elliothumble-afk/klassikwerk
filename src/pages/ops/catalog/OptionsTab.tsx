import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { List } from 'react-window'
import {
  Pencil, Check, X, ToggleLeft, ToggleRight, Upload, Image,
  ChevronDown, ChevronRight, Search, Plus, DollarSign,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { CatalogOption, Tier, Platform, OptionGroup, BuilderTerms, CatalogCategory, Origin } from '@/types/database'
import { catalogOptionSchema, type CatalogOptionForm } from '@/schemas/catalog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Spinner } from '@/components/ui/Spinner'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'

const optionsKey = (builderId?: string) => ['catalog', 'options', builderId ?? 'none']
const tiersKey = (builderId?: string) => ['catalog', 'tiers', builderId ?? 'none']
const platformsKey = (builderId?: string) => ['catalog', 'platforms', builderId ?? 'none']
const groupsKey = (builderId?: string) => ['catalog', 'option-groups', builderId ?? 'none']
const termsKey = (builderId?: string) => ['catalog', 'builder-terms', builderId ?? 'none']

type OptionWithPlatforms = CatalogOption & { platform_ids: string[] }

// ─── Data hooks ───────────────────────────────────────────────────────────────

function useOptions(builderId?: string) {
  return useQuery({
    queryKey: optionsKey(builderId),
    enabled: Boolean(builderId),
    queryFn: async () => {
      // PostgREST caps at 1000 rows per request. CTC crosses that on
      // the synced catalog, so page through with .range() until we hit
      // a short batch.
      const PAGE = 1000
      const out: CatalogOption[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('catalog_options')
          .select('*').eq('builder_id', builderId!)
          .order('sort').range(from, from + PAGE - 1)
        if (error) throw error
        const batch = (data ?? []) as CatalogOption[]
        out.push(...batch)
        if (batch.length < PAGE) break
      }
      // Platform-link join, also paged.
      const links: { option_id: string; platform_id: string }[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('catalog_option_platforms')
          .select('option_id, platform_id').range(from, from + PAGE - 1)
        if (error) throw error
        const batch = (data ?? []) as typeof links
        links.push(...batch)
        if (batch.length < PAGE) break
      }
      const platMap = new Map<string, string[]>()
      for (const r of links) {
        const arr = platMap.get(r.option_id) ?? []
        arr.push(r.platform_id)
        platMap.set(r.option_id, arr)
      }
      return out.map(o => ({ ...o, platform_ids: platMap.get(o.id) ?? [] })) as OptionWithPlatforms[]
    },
  })
}

function useTiers(builderId?: string) {
  return useQuery({
    queryKey: tiersKey(builderId),
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_tiers')
        .select('*').eq('builder_id', builderId!).order('sort')
      if (error) throw error
      return data as Tier[]
    },
  })
}

function usePlatforms(builderId?: string) {
  return useQuery({
    queryKey: platformsKey(builderId),
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_platforms')
        .select('*').eq('builder_id', builderId!).order('sort')
      if (error) throw error
      return data as Platform[]
    },
  })
}

function useOptionGroups(builderId?: string) {
  return useQuery({
    queryKey: groupsKey(builderId),
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_option_groups')
        .select('*').eq('builder_id', builderId!).order('sort')
      if (error) throw error
      return data as OptionGroup[]
    },
  })
}

function useBuilderTerms(builderId?: string) {
  return useQuery({
    queryKey: termsKey(builderId),
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data, error } = await supabase.from('builder_terms')
        .select('*').eq('builder_id', builderId!).maybeSingle()
      if (error) throw error
      return data as BuilderTerms | null
    },
  })
}

function useCategories(builderId?: string) {
  return useQuery({
    queryKey: ['catalog', 'categories', builderId ?? 'none'],
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_categories')
        .select('*').eq('builder_id', builderId!).order('sort')
      if (error) throw error
      return data as CatalogCategory[]
    },
  })
}

function useOrigins(builderId?: string) {
  return useQuery({
    queryKey: ['catalog', 'origins', builderId ?? 'none'],
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data, error } = await supabase.from('origins')
        .select('*').eq('builder_id', builderId!).order('sort')
      if (error) throw error
      return data as Origin[]
    },
  })
}

// ─── Price helpers ────────────────────────────────────────────────────────────

function money(cents: number): string {
  if (cents === 0) return 'Set a price'
  return `$${(cents / 100).toLocaleString('en-US')}`
}

// Everything the form writes except the price fields; the three
// pricing branches below layer on top.
function baseFormDb(data: CatalogOptionForm, builderId: string) {
  return {
    builder_id: builderId,
    slug: data.slug,
    name: data.name,
    code: data.code ?? null,
    included_in_tier_ids: data.included_in_tier_ids,
    sort: data.sort,
    active: data.active,
    sold_as_set: data.sold_as_set,
    description: data.description,
    lead_image_url: data.lead_image_url,
  }
}

// Form → DB payload. Pricing semantics branch on builder mode and
// whether the option is manual or synced:
//   - cost_based manual : write manual_parts_sell_cents + cost_cents.
//                         Never price_cents — reprice_builder owns it.
//   - cost_based synced : don't touch price fields; the sync + reprice
//                         own them.
//   - simple-mode       : write price_cents (manual & synced).
function optionFormToDb(
  data: CatalogOptionForm,
  builderId: string,
  mode: 'cost_based_manual' | 'cost_based_synced' | 'simple',
) {
  const base = baseFormDb(data, builderId)
  if (mode === 'cost_based_manual') {
    return {
      ...base,
      manual_parts_sell_cents: Math.round(data.price * 100),
      cost_cents: data.cost == null ? null : Math.round(data.cost * 100),
    }
  }
  if (mode === 'cost_based_synced') return base
  return { ...base, price_cents: Math.round(data.price * 100) }
}

// ─── Swatch (thumbnail + lightbox) ───────────────────────────────────────────

function SwatchThumb({ url, name }: { url: string | null; name: string }) {
  const [open, setOpen] = useState(false)
  if (!url) {
    return (
      <div className="w-9 h-9 rounded-sm bg-[var(--color-surface-raised)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
        <Image size={13} className="text-[var(--color-muted)]" strokeWidth={1.5} />
      </div>
    )
  }
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="block w-9 h-9 rounded-sm overflow-hidden border border-[var(--color-border)] shrink-0 hover:ring-2 hover:ring-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] transition"
        title={`View ${name}`}
        aria-label={`View swatch for ${name}`}
      >
        <img src={url} alt={name} className="w-full h-full object-cover" />
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)} role="dialog" aria-modal aria-label={name}
        >
          <div className="relative max-w-lg max-h-[80vh] p-2" onClick={e => e.stopPropagation()}>
            <img src={url} alt={name} className="max-w-full max-h-[75vh] rounded-lg shadow-2xl object-contain" />
            <p className="mt-2 text-center text-sm text-white/80">{name}</p>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function SwatchUploadButton({ optionId, onUpload }: { optionId: string; onUpload: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  async function handleFile(file: File) {
    setUploading(true)
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `swatch/${optionId}.${ext}`
    const up = await supabase.storage.from('media').upload(path, file, { upsert: true })
    if (up.error) { setUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(path)
    await supabase.from('catalog_options').update({ swatch_image_url: publicUrl }).eq('id', optionId)
    onUpload(publicUrl)
    setUploading(false)
  }
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()} disabled={uploading}
        className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition disabled:opacity-50"
        title="Upload swatch"
      >
        {uploading ? <Spinner size={12} /> : <Upload size={12} />}
      </button>
      <input
        ref={inputRef} type="file" accept="image/*" className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
    </>
  )
}

// ─── Platform count + hover list ─────────────────────────────────────────────

function PlatformsCell({ ids, platforms }: { ids: string[]; platforms: Platform[] }) {
  const named = ids.map(id => platforms.find(p => p.id === id)?.chassis).filter((v): v is string => !!v)
  if (named.length === 0) return <span className="text-[var(--color-muted)]">All</span>
  return (
    <div className="relative group inline-flex items-center">
      <span className="text-[var(--color-foreground)] cursor-help underline decoration-dotted underline-offset-2">
        {named.length === 1 ? named[0] : `${named.length} platforms`}
      </span>
      {named.length > 1 && (
        <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-foreground)] text-[var(--color-background)] text-xs px-2 py-1.5 shadow-lg">
          {named.join(' · ')}
        </div>
      )}
    </div>
  )
}

// ─── Cost drawer ─────────────────────────────────────────────────────────────
// Mirrors the Catalog sheet in the costing workbook: web price →
// retail → kit cost → freight / duty / tariff / s232 / fees → landed
// + parts sell → labour / materials / install → final. Computes the
// intermediates client-side from the option + category + origin +
// terms; the stored parts_sell / landed / install / price are shown
// as the strong rows so a mismatch between client math and the DB
// surfaces visually.

interface CostDrawerProps {
  option: CatalogOption
  category: CatalogCategory | null
  origin: Origin | null
  terms: BuilderTerms
  onClose: () => void
}

function CostDrawer({ option, category, origin, terms, onClose }: CostDrawerProps) {
  const d = (c: number) => `$${c.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const pct = (p: number) => `${(p * 100).toFixed(2)}%`

  const isManual = !option.synced
  const webGbp = (option.web_price_cents ?? 0) / 100
  const retail = isManual
    ? (option.manual_parts_sell_cents ?? 0) / 100
    : webGbp * Number(terms.fx_rate)
  const kitCost = isManual ? retail : retail * (1 - Number(terms.trade_discount_pct))
  const freight = isManual ? 0 : (category?.freight_cents ?? 0) / 100
  const dutyPct = isManual ? 0 : Number(category?.hts_duty_pct ?? 0)
  const duty = kitCost * dutyPct
  const tariffPct = isManual ? 0 : Number(origin?.tariff_pct ?? 0)
  const tariff = kitCost * tariffPct
  const isWheels = category?.name === 'Alloy wheels'
  const s232Pct = isManual ? 0 : Number(origin?.s232_aluminium_pct ?? 0)
  const s232 = !isManual && isWheels ? kitCost * Number(terms.aluminium_share_pct) * s232Pct : 0
  const mpf = isManual ? 0 : kitCost * Number(terms.mpf_pct)
  const brokeragePer = isManual ? 0 : (terms.brokerage_cents / 100) / Math.max(1, terms.items_per_shipment)
  const fees = mpf + brokeragePer
  const landed = (option.landed_cost_cents ?? 0) / 100
  const partsSell = (option.parts_sell_cents ?? 0) / 100
  const installH = Number(category?.install_hours ?? 0)
  const paintH = Number(category?.paint_hours ?? 0)
  const labour = installH * (terms.labour_rate_cents / 100) + paintH * (terms.paint_rate_cents / 100)
  const materials = (category?.paint_materials_cents ?? 0) / 100
  const install = (option.install_price_cents ?? 0) / 100
  const total = (option.price_cents ?? 0) / 100

  interface DrawerRow { label: string; detail?: string; value: string; strong?: boolean; muted?: boolean }
  const rows: DrawerRow[] = isManual
    ? [
        { label: 'Parts sell (manual)', value: d(partsSell), strong: true },
        { label: 'Labour', detail: `${installH}h × $${terms.labour_rate_cents/100} + ${paintH}h × $${terms.paint_rate_cents/100}`, value: d(labour) },
        { label: 'Paint materials', value: d(materials) },
        { label: 'Install price', detail: 'labour + materials', value: d(install), strong: true },
        { label: 'Final price', detail: 'parts sell + install', value: d(total), strong: true },
      ]
    : [
        { label: 'Web price', detail: `£${webGbp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, value: `× fx ${terms.fx_rate}`, muted: true },
        { label: 'Retail USD', value: d(retail) },
        { label: 'Kit cost', detail: `× (1 − ${pct(Number(terms.trade_discount_pct))})`, value: d(kitCost) },
        { label: 'Freight', detail: category?.name ?? '—', value: d(freight) },
        { label: 'HTS duty', detail: pct(dutyPct), value: d(duty) },
        { label: 'Tariff', detail: `${origin?.name ?? '—'} · ${pct(tariffPct)}`, value: d(tariff) },
        { label: 'Section 232 (aluminium)', detail: isWheels ? `${pct(Number(terms.aluminium_share_pct))} × ${pct(s232Pct)}` : 'wheels only', value: d(s232), muted: !isWheels },
        { label: 'MPF + brokerage', detail: `MPF ${pct(Number(terms.mpf_pct))} + $${brokeragePer.toFixed(2)}/item`, value: d(fees) },
        { label: 'Landed cost', detail: 'kit + freight + duty + tariff + 232 + fees', value: d(landed), strong: true },
        { label: 'Parts sell', detail: 'retail + landing', value: d(partsSell), strong: true },
        { label: 'Labour', detail: `${installH}h × $${terms.labour_rate_cents/100} + ${paintH}h × $${terms.paint_rate_cents/100}`, value: d(labour) },
        { label: 'Paint materials', value: d(materials) },
        { label: 'Install price', detail: 'labour + materials', value: d(install), strong: true },
        { label: 'Final price', detail: 'parts sell + install', value: d(total), strong: true },
      ]

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose} role="dialog" aria-modal aria-label={`Cost breakdown for ${option.name}`}
    >
      <div
        className="w-full sm:w-[480px] h-full bg-[var(--color-surface)] shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Cost breakdown</div>
            <div className="text-sm font-medium mt-0.5">{option.name}</div>
            <div className="text-xs text-[var(--color-muted)] font-mono">{option.code ?? '—'}</div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-full hover:bg-[var(--color-border)] inline-flex items-center justify-center"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        {!category ? (
          <div className="p-5 text-sm text-[var(--color-muted)]">
            No category assigned — set one in the row dropdown.
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.label}
                  className={`border-b border-[var(--color-border)] last:border-0 ${r.strong ? 'bg-[var(--color-surface-raised)]' : ''}`}
                >
                  <td className={`py-2 pl-5 pr-2 ${r.muted ? 'text-[var(--color-muted)]' : ''}`}>
                    <div className={r.strong ? 'font-medium' : ''}>{r.label}</div>
                    {r.detail && <div className="text-[11px] text-[var(--color-muted)] mt-0.5">{r.detail}</div>}
                  </td>
                  <td className={`py-2 pr-5 text-right font-mono tabular-nums ${r.strong ? 'font-medium' : r.muted ? 'text-[var(--color-muted)]' : ''}`}>
                    {r.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ─── Column header row ──────────────────────────────────────────────────────
// Lives above the virtualized list, inside the bordered container.
// Mirrors every width in OptionRow so columns line up with the data
// below. "Parts sell" labels the price column on cost_based builders;
// simple-mode gets a plain "Price" label.

function ColumnHeader({ costBased, showTierChips }: { costBased: boolean; showTierChips: boolean }) {
  const cls = 'text-[10px] uppercase tracking-wide text-[var(--color-muted)] font-medium'
  return (
    <div className="flex items-center gap-3 px-4 h-9 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]/60">
      {/* Thumbnail slot */}
      <div className="w-9 shrink-0" />
      {/* Option name + SKU */}
      <div className={`min-w-0 flex-1 ${cls}`}>Option</div>
      {costBased && <div className={`w-40 shrink-0 ${cls}`}>Category</div>}
      <div className={`w-32 shrink-0 ${cls}`}>Platforms</div>
      <div className={`w-28 shrink-0 text-right ${cls}`}>{costBased ? 'Parts sell' : 'Price'}</div>
      {costBased && <div className={`w-24 shrink-0 text-right ${cls}`}>Cost</div>}
      {showTierChips && <div className={`w-40 shrink-0 ${cls}`}>Tiers</div>}
      <div className={`w-4 shrink-0 ${cls}`}>Active</div>
      {/* Actions column — intentionally blank per the spec. */}
      {costBased && <div className="w-[13px] shrink-0" />}
      <div className="w-[13px] shrink-0" />
    </div>
  )
}

// ─── Virtualized list items ──────────────────────────────────────────────────

type ListItem =
  | { kind: 'header'; group: OptionGroup; count: number }
  | { kind: 'row'; option: OptionWithPlatforms; group: OptionGroup }

const HEADER_HEIGHT = 48
const ROW_HEIGHT = 56

interface RowProps {
  items: ListItem[]
  platforms: Platform[]
  tiers: Tier[]
  categories: CatalogCategory[]
  costBased: boolean
  showTierChips: boolean
  collapsed: Record<string, boolean>
  toggleCollapse: (groupId: string) => void
  onEdit: (o: OptionWithPlatforms) => void
  onToggleActive: (o: OptionWithPlatforms) => void
  onSwatchUpload: (id: string, url: string) => void
  savePrice: (optionId: string, cents: number) => void
  saveCategory: (optionId: string, categoryId: string | null) => void
  onOpenCost: (option: OptionWithPlatforms) => void
}

interface RowRenderProps extends RowProps { index: number; style: React.CSSProperties }
function Row(props: RowRenderProps) {
  const { items, platforms, tiers, showTierChips, collapsed, toggleCollapse,
          onEdit, onToggleActive, onSwatchUpload, savePrice, index, style } = props
  const it = items[index]
  if (!it) return null

  if (it.kind === 'header') {
    const isCollapsed = collapsed[it.group.id] ?? false
    return (
      <div
        style={style}
        className="flex items-center gap-2 px-4 bg-[var(--color-surface)] border-b border-[var(--color-border)] sticky top-0"
      >
        <button
          onClick={() => toggleCollapse(it.group.id)}
          className="flex items-center gap-1.5 text-sm font-medium hover:text-[var(--color-accent)] transition"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          {it.group.name}
          <span className="text-xs text-[var(--color-muted)] font-normal ml-1">
            {it.count}
          </span>
        </button>
      </div>
    )
  }

  const { categories, costBased, saveCategory, onOpenCost } = props as RowRenderProps
  // Option row — single line.
  return (
    <OptionRow
      style={style}
      option={it.option}
      group={it.group}
      platforms={platforms}
      tiers={tiers}
      categories={categories}
      costBased={costBased}
      showTierChips={showTierChips}
      onEdit={onEdit}
      onToggleActive={onToggleActive}
      onSwatchUpload={onSwatchUpload}
      savePrice={savePrice}
      saveCategory={saveCategory}
      onOpenCost={onOpenCost}
    />
  )
}

interface OptionRowStandaloneProps {
  style: React.CSSProperties
  option: OptionWithPlatforms
  group: OptionGroup
  platforms: Platform[]
  tiers: Tier[]
  categories: CatalogCategory[]
  costBased: boolean
  showTierChips: boolean
  onEdit: (o: OptionWithPlatforms) => void
  onToggleActive: (o: OptionWithPlatforms) => void
  onSwatchUpload: (id: string, url: string) => void
  savePrice: (optionId: string, cents: number) => void
  saveCategory: (optionId: string, categoryId: string | null) => void
  onOpenCost: (option: OptionWithPlatforms) => void
}

function OptionRow({
  style, option, platforms, tiers, categories, costBased, showTierChips,
  onEdit, onToggleActive, onSwatchUpload, savePrice, saveCategory, onOpenCost,
}: OptionRowStandaloneProps) {
  const isManual = !option.synced
  const kitSku = option.code ?? null
  const costCents = option.cost_cents ?? null

  return (
    <div
      style={style}
      className="flex items-center gap-3 px-4 border-b border-[var(--color-border)] text-sm hover:bg-[var(--color-surface-raised)]/40"
    >
      <SwatchThumb url={option.swatch_image_url} name={option.name} />

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{option.name}</div>
        <div className="text-[11px] text-[var(--color-muted)] flex items-center gap-2 mt-0.5">
          <span className="font-mono truncate max-w-[180px]">{kitSku ?? '—'}</span>
          {isManual && <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-raised)] text-[10px] uppercase tracking-wide">Manual</span>}
          <SwatchUploadButton optionId={option.id} onUpload={url => onSwatchUpload(option.id, url)} />
        </div>
      </div>

      {/* Category dropdown — cost_based builders only. Pre-Phase 5
          simple-mode builders don't have categories, so skip. */}
      {costBased && (
        <div className="w-40 shrink-0">
          <select
            value={option.category_id ?? ''}
            onChange={e => saveCategory(option.id, e.target.value || null)}
            className="h-7 w-full px-1.5 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] text-xs"
          >
            <option value="">— uncategorised —</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="w-32 shrink-0 text-xs">
        <PlatformsCell ids={option.platform_ids} platforms={platforms} />
      </div>

      {/* Inline-editable Price. For cost_based builders the row shows
          parts_sell_cents (set by reprice) read-only on synced rows,
          and manual rows edit manual_parts_sell_cents directly. For
          simple-mode this is the plain price_cents field. */}
      <div className="w-28 shrink-0 text-right">
        {isManual ? (
          <InlinePriceEdit
            value={costBased ? (option.manual_parts_sell_cents ?? 0) : option.price_cents}
            onSave={cents => savePrice(option.id, cents)}
          />
        ) : (
          <span className="text-sm">{money(costBased ? (option.parts_sell_cents ?? option.price_cents) : option.price_cents)}</span>
        )}
      </div>

      {/* Cost column — only on cost_based builders. Manual rows show
          the operator cost (or an em-dash when blank); synced rows
          leave the cell empty since cost is derived server-side. */}
      {costBased && (
        <div className="w-24 shrink-0 text-right text-sm text-[var(--color-muted)]">
          {isManual
            ? (costCents == null ? '—' : `$${(costCents / 100).toLocaleString('en-US')}`)
            : ''}
        </div>
      )}

      {/* Tier chips only when option_mode is included_only. */}
      {showTierChips && (
        <div className="w-40 shrink-0 flex gap-1 flex-wrap">
          {tiers.map(tier => {
            const included = option.included_in_tier_ids.includes(tier.id)
            if (!included) return null
            return (
              <span key={tier.id} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-accent-light)] text-[var(--color-accent)]">
                {tier.name}
              </span>
            )
          })}
        </div>
      )}

      <button
        onClick={() => onToggleActive(option)}
        className={`shrink-0 inline-flex items-center gap-1 text-xs ${
          option.active ? 'text-[var(--color-success)]' : 'text-[var(--color-muted)]'
        }`}
        title={option.active ? 'Active' : 'Inactive'}
      >
        {option.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
      </button>

      {costBased && (
        <button
          onClick={() => onOpenCost(option)}
          className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-accent)] transition"
          aria-label="Cost breakdown"
          title="Cost breakdown"
        >
          <DollarSign size={13} />
        </button>
      )}

      <button
        onClick={() => onEdit(option)}
        className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition"
        aria-label="Edit"
      >
        <Pencil size={13} />
      </button>
    </div>
  )
}

// ─── Inline price editor ─────────────────────────────────────────────────────

function InlinePriceEdit({ value, onSave }: { value: number; onSave: (cents: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => (value === 0 ? '' : (value / 100).toString()))
  useEffect(() => {
    if (!editing) setDraft(value === 0 ? '' : (value / 100).toString())
  }, [value, editing])

  function commit() {
    const n = Number(draft)
    const cents = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0
    if (cents !== value) onSave(cents)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`text-sm hover:underline ${value === 0 ? 'text-[var(--color-danger)]' : ''}`}
      >
        {money(value)}
      </button>
    )
  }
  return (
    <div className="relative inline-flex items-center">
      <span className="absolute left-2 text-xs text-[var(--color-muted)]">$</span>
      <input
        type="number" step="0.01" min="0" autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') setEditing(false)
        }}
        className="h-7 w-24 pl-5 pr-2 text-right rounded-sm border border-[var(--color-accent)] bg-[var(--color-surface)] text-sm"
      />
    </div>
  )
}

// ─── Lead image picker (Lookbook PDF hero) ──────────────────────────────────
//
// Reads catalog_option_images for one option and shows a grid of
// thumbnails. Clicking a thumbnail stores its URL as the override;
// clicking the current pick clears it (fall back to the first by sort).

function LeadImagePicker({
  optionId, swatchUrl, value, onPick,
}: {
  optionId: string
  swatchUrl: string | null
  value: string
  onPick: (url: string) => void
}) {
  const { data: images = [] } = useQuery({
    queryKey: ['catalog', 'option-images', optionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_option_images')
        .select('url, sort')
        .eq('option_id', optionId)
        .order('sort', { ascending: true })
      if (error) throw error
      return data as { url: string; sort: number }[]
    },
  })

  const defaultUrl = images[0]?.url ?? swatchUrl ?? null
  const effective = value || defaultUrl

  if (images.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs text-[var(--color-muted)]">
          Lead image <span className="text-[var(--color-muted)]">(Lookbook hero · {images.length} available)</span>
        </p>
        {value && (
          <button
            type="button"
            onClick={() => onPick('')}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            Clear override
          </button>
        )}
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {images.map(img => {
          const picked = img.url === effective
          return (
            <button
              key={img.url}
              type="button"
              onClick={() => onPick(img.url)}
              className={`relative aspect-square rounded-sm overflow-hidden border transition ${
                picked
                  ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
              }`}
              title={img.url}
            >
              <img src={img.url} alt="" className="w-full h-full object-cover" />
              {picked && (
                <span className="absolute inset-x-0 bottom-0 bg-[var(--color-accent)] text-white text-[9px] uppercase tracking-wide text-center py-0.5">
                  Lead
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Full edit form (modal / inline for new) ─────────────────────────────────

interface EditFormProps {
  option?: OptionWithPlatforms
  groupId: string
  tiers: Tier[]
  platforms: Platform[]
  costBased: boolean
  showTierChips: boolean
  onSave: (data: CatalogOptionForm, platformIds: string[], id?: string, groupId?: string) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function OptionEditForm({ option, groupId, tiers, platforms, costBased, showTierChips, onSave, onCancel, saving }: EditFormProps) {
  const isSynced = !!option?.synced
  const isManual = !isSynced
  // Which column the `price` field is bound to in the DB.
  // cost_based manual → manual_parts_sell_cents (parts sell input).
  // simple-mode manual/synced → price_cents (plain price).
  // cost_based synced → form hides the field; sync + reprice own it.
  const priceCentsForForm = (() => {
    if (!option) return 0
    if (costBased && isManual) return option.manual_parts_sell_cents ?? 0
    return option.price_cents
  })()

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<CatalogOptionForm>({
    resolver: zodResolver(catalogOptionSchema),
    defaultValues: option
      ? {
          slug: option.slug, name: option.name, code: option.code ?? '',
          price: priceCentsForForm / 100,
          included_in_tier_ids: option.included_in_tier_ids,
          sort: option.sort, active: option.active, sold_as_set: option.sold_as_set ?? false,
          category_id: option.category_id ?? '',
          origin_id: option.origin_id ?? '',
          cost: option.cost_cents == null ? null : option.cost_cents / 100,
          description: option.description ?? '',
          lead_image_url: option.lead_image_url ?? '',
        }
      : { price: 0, included_in_tier_ids: [], sort: 0, active: true, sold_as_set: false,
          category_id: '', origin_id: '', cost: null, description: '', lead_image_url: '' },
  })

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(option?.platform_ids ?? [])
  const includedTierIds = watch('included_in_tier_ids')

  const inputClass = 'h-9 px-3 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] focus:border-transparent transition'

  return createPortal(
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
         onClick={onCancel} role="dialog" aria-modal>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit(d => onSave(d, selectedPlatforms, option?.id, groupId))}
        className="w-full max-w-2xl bg-[var(--color-surface)] rounded-[var(--radius-md)] shadow-2xl p-5 space-y-3"
      >
        <div className="flex items-center justify-between pb-2 border-b border-[var(--color-border)]">
          <h3 className="text-sm font-medium">{option ? 'Edit option' : 'New option'}</h3>
          <button type="button" onClick={onCancel} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="text-xs text-[var(--color-muted)] mb-1 block">Name *</label>
            <input {...register('name')} className={inputClass} />
            {errors.name && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="text-xs text-[var(--color-muted)] mb-1 block">Slug *</label>
            <input {...register('slug')} className={inputClass} />
            {errors.slug && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.slug.message}</p>}
          </div>
          <div>
            <label className="text-xs text-[var(--color-muted)] mb-1 block">Code</label>
            <input {...register('code')} className={inputClass} />
          </div>

          {/* Price UI branches on pricing mode and synced-ness.
              cost_based manual : Parts sell + Cost (both editable),
                                  computed price shown read-only below.
              cost_based synced : the sync + reprice own both numbers;
                                  the form has nothing to say.
              simple-mode      : plain Price field (manual + synced). */}
          {costBased && isManual && (
            <>
              <div>
                <label className="text-xs text-[var(--color-muted)] mb-1 block">Parts sell $</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">$</span>
                  <input {...register('price')} type="number" step="0.01" min="0" className={`${inputClass} pl-7`} />
                </div>
              </div>
              <div>
                <label
                  className="text-xs text-[var(--color-muted)] mb-1 block"
                  title="Operator cost per unit. Blank = assume cost equals sell (zero margin on parts)."
                >
                  Cost $ (optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">$</span>
                  <input {...register('cost')} type="number" step="0.01" min="0" className={`${inputClass} pl-7`} placeholder="(blank)" />
                </div>
              </div>
            </>
          )}
          {!costBased && (
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Price</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">$</span>
                <input {...register('price')} type="number" step="0.01" min="0" className={`${inputClass} pl-7`} />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-[var(--color-muted)] mb-1 block">Sort</label>
            <input {...register('sort')} type="number" className={inputClass} />
          </div>
          <label className="flex items-end gap-2 text-sm pb-2">
            <input {...register('active')} type="checkbox" /> Active
          </label>
          <label className="flex items-end gap-2 text-sm pb-2">
            <input {...register('sold_as_set')} type="checkbox" /> Sold as set of 4
          </label>
        </div>

        {costBased && option && (
          <div className="text-xs text-[var(--color-muted)]">
            {isSynced
              ? <>Price set by sync; reprice recalculates when terms, categories or origins change.</>
              : <>Price incl. fitting: <span className="text-[var(--color-foreground)] font-medium">{money(option.price_cents)}</span></>}
          </div>
        )}

        {showTierChips && (
          <div>
            <p className="text-xs text-[var(--color-muted)] mb-1.5">Included in tiers</p>
            <div className="flex gap-2 flex-wrap">
              {tiers.map(tier => {
                const on = (includedTierIds ?? []).includes(tier.id)
                return (
                  <button key={tier.id} type="button"
                    onClick={() => {
                      const cur = includedTierIds ?? []
                      setValue('included_in_tier_ids', on ? cur.filter(t => t !== tier.id) : [...cur, tier.id])
                    }}
                    className={`px-2.5 py-1 rounded text-xs transition ${on ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-border)] text-[var(--color-muted)]'}`}
                  >
                    {tier.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs text-[var(--color-muted)] mb-1.5">Platform restriction (empty = all)</p>
          <div className="flex gap-2 flex-wrap">
            {platforms.map(p => {
              const on = selectedPlatforms.includes(p.id)
              return (
                <button key={p.id} type="button"
                  onClick={() => setSelectedPlatforms(prev => on ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                  className={`px-2.5 py-1 rounded text-xs transition ${on ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-border)] text-[var(--color-muted)]'}`}
                >
                  {p.chassis}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="text-xs text-[var(--color-muted)] mb-1 block">
            Description <span className="text-[var(--color-muted)]">(Lookbook PDF)</span>
          </label>
          <textarea
            {...register('description')}
            rows={3}
            placeholder="Shopify body copy, first two sentences. Edit to override."
            className={`${inputClass} h-auto py-2 resize-y`}
          />
        </div>

        {option && (
          <LeadImagePicker
            optionId={option.id}
            swatchUrl={option.swatch_image_url}
            value={watch('lead_image_url') ?? ''}
            onPick={url => setValue('lead_image_url', url, { shouldDirty: true })}
          />
        )}

        <div className="flex gap-2 justify-end pt-2 border-t border-[var(--color-border)]">
          <button type="button" onClick={onCancel}
            className="h-9 px-4 rounded-[var(--radius-sm)] text-sm text-[var(--color-muted)] hover:bg-[var(--color-border)]">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <Spinner size={13} /> : <Check size={13} />} Save
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

// ─── Filter bar ──────────────────────────────────────────────────────────────

interface Filters {
  platformId: string
  groupId: string
  search: string
  activeOnly: boolean
  manualOnly: boolean
  missingPriceOnly: boolean
}

function FilterBar({
  platforms, groups, filters, setFilters, resultCount, onAdd,
}: {
  platforms: Platform[]
  groups: OptionGroup[]
  filters: Filters
  setFilters: React.Dispatch<React.SetStateAction<Filters>>
  resultCount: number
  onAdd: () => void
}) {
  return (
    <div className="sticky top-0 z-20 bg-[var(--color-background)] border-b border-[var(--color-border)] py-3 mb-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            type="text"
            placeholder="Search name or SKU…"
            value={filters.search}
            onChange={e => setFilters(prev => ({ ...prev, search: e.target.value }))}
            className="h-8 pl-7 pr-3 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm"
          />
        </div>

        <select
          value={filters.platformId}
          onChange={e => setFilters(prev => ({ ...prev, platformId: e.target.value }))}
          className="h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm"
        >
          <option value="">All platforms</option>
          {platforms.map(p => <option key={p.id} value={p.id}>{p.chassis}</option>)}
        </select>

        <select
          value={filters.groupId}
          onChange={e => setFilters(prev => ({ ...prev, groupId: e.target.value }))}
          className="h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm"
        >
          <option value="">All groups</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        <Toggle
          on={filters.activeOnly}
          onChange={v => setFilters(prev => ({ ...prev, activeOnly: v }))}
          label="Active only"
        />
        <Toggle
          on={filters.manualOnly}
          onChange={v => setFilters(prev => ({ ...prev, manualOnly: v }))}
          label="Manual only"
        />
        <Toggle
          on={filters.missingPriceOnly}
          onChange={v => setFilters(prev => ({ ...prev, missingPriceOnly: v }))}
          label="Missing price"
        />

        <span className="text-xs text-[var(--color-muted)] ml-2">{resultCount} shown</span>

        <button
          onClick={onAdd}
          className="ml-auto h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-xs inline-flex items-center gap-1.5 hover:opacity-90"
        >
          <Plus size={12} /> New option
        </button>
      </div>
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`h-8 px-2.5 rounded-[var(--radius-sm)] border text-xs inline-flex items-center gap-1.5 transition ${
        on
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
          : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)]'
      }`}
    >
      {label}
    </button>
  )
}

// ─── Group collapse persistence ──────────────────────────────────────────────

function useCollapseState(builderId?: string) {
  const key = `catalog-collapse-${builderId ?? 'none'}`
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(window.localStorage.getItem(key) ?? '{}') } catch { return {} }
  })
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(collapsed)) } catch { /* noop */ }
  }, [key, collapsed])
  function toggle(groupId: string) {
    setCollapsed(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }
  return { collapsed, toggle }
}

// ─── Tab root ────────────────────────────────────────────────────────────────

export function OptionsTab() {
  const qc = useQueryClient()
  const { selected } = useOpsBuilderSelection()
  const OPTIONS_KEY = optionsKey(selected?.id)

  const { data: options, isLoading: loadingOptions, error: optionsError, refetch } = useOptions(selected?.id)
  const { data: tiers = [] } = useTiers(selected?.id)
  const { data: platforms = [] } = usePlatforms(selected?.id)
  const { data: groups = [] } = useOptionGroups(selected?.id)
  const { data: terms } = useBuilderTerms(selected?.id)
  const costBased = terms?.pricing_mode === 'cost_based'
  const { data: categories = [] } = useCategories(costBased ? selected?.id : undefined)
  const { data: origins = [] } = useOrigins(costBased ? selected?.id : undefined)

  const showTierChips = terms?.option_mode === 'included_only'
  const [costOptionId, setCostOptionId] = useState<string | null>(null)

  const [filters, setFilters] = useState<Filters>({
    platformId: '', groupId: '', search: '', activeOnly: true, manualOnly: false, missingPriceOnly: false,
  })
  const { collapsed, toggle: toggleCollapse } = useCollapseState(selected?.id)

  const [editing, setEditing] = useState<{ option?: OptionWithPlatforms; groupId: string } | null>(null)
  const [saving, setSaving] = useState(false)

  // Filtering happens in-memory. For 1k rows it's trivial.
  const filtered = useMemo(() => {
    const needle = filters.search.trim().toLowerCase()
    return (options ?? []).filter(o => {
      if (filters.activeOnly && !o.active) return false
      if (filters.manualOnly && o.synced) return false
      if (filters.missingPriceOnly && o.price_cents > 0) return false
      if (filters.platformId) {
        // Strict: only options with a link row to the selected
        // platform match. "Universal" (no-link) rows show up only
        // under "All platforms" so stale orphans can't impersonate
        // a universal row.
        if (!o.platform_ids.includes(filters.platformId)) return false
      }
      if (filters.groupId && o.group_id !== filters.groupId) return false
      if (needle) {
        const code = (o as { kit_sku?: string | null }).kit_sku ?? o.code ?? ''
        const hay = `${o.name} ${code}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [options, filters])

  // Build the flat list of ListItem (header + rows).
  const items: ListItem[] = useMemo(() => {
    const out: ListItem[] = []
    const byGroup = new Map<string, OptionWithPlatforms[]>()
    for (const o of filtered) {
      const arr = byGroup.get(o.group_id) ?? []
      arr.push(o)
      byGroup.set(o.group_id, arr)
    }
    for (const g of groups) {
      const inGroup = byGroup.get(g.id) ?? []
      // When a group filter is active, skip other groups entirely.
      // When no group filter: show the header even if empty-after-filter,
      // but only when some unfiltered options exist in that group.
      if (filters.groupId && filters.groupId !== g.id) continue
      if (inGroup.length === 0) continue
      out.push({ kind: 'header', group: g, count: inGroup.length })
      if (!collapsed[g.id]) {
        for (const o of inGroup) out.push({ kind: 'row', option: o, group: g })
      }
    }
    return out
  }, [filtered, groups, collapsed, filters.groupId])

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async ({ data, platformIds, id, groupId }: {
      data: CatalogOptionForm; platformIds: string[]; id?: string; groupId?: string
    }) => {
      if (!selected) throw new Error('No builder selected')
      // Determine pricing mode for this specific row. New options are
      // treated as manual (sync is the only thing that writes synced=true).
      const existing = id ? (options ?? []).find(o => o.id === id) : null
      const isSyncedRow = !!existing?.synced
      const mode: 'cost_based_manual' | 'cost_based_synced' | 'simple' = costBased
        ? (isSyncedRow ? 'cost_based_synced' : 'cost_based_manual')
        : 'simple'
      const payload = optionFormToDb(data, selected.id, mode)
      if (id) {
        const { builder_id: _bid, ...update } = payload
        // When ops edits the description, flip description_locked so
        // the next sync doesn't overwrite the override with Shopify
        // body_html. Only flip when the value actually changed.
        const descriptionChanged = existing && (update.description ?? null) !== (existing.description ?? null)
        const updateWithLocks = descriptionChanged
          ? { ...update, description_locked: (update.description ?? null) !== null }
          : update
        const { error } = await supabase.from('catalog_options').update(updateWithLocks).eq('id', id)
        if (error) throw error
        await supabase.from('catalog_option_platforms').delete().eq('option_id', id)
        if (platformIds.length > 0) {
          const pe = await supabase.from('catalog_option_platforms').insert(
            platformIds.map(pid => ({ option_id: id, platform_id: pid })),
          )
          if (pe.error) throw pe.error
        }
      } else {
        if (!groupId) throw new Error('groupId required')
        const ins = await supabase.from('catalog_options').insert({ ...payload, group_id: groupId }).select().single()
        if (ins.error) throw ins.error
        if (platformIds.length > 0) {
          const pe = await supabase.from('catalog_option_platforms').insert(
            platformIds.map(pid => ({ option_id: ins.data.id as string, platform_id: pid })),
          )
          if (pe.error) throw pe.error
        }
      }
      // Reprice so the computed price_cents / parts_sell / landed
      // refresh immediately after a cost_based save.
      if (costBased) {
        await supabase.rpc('reprice_builder', { target_builder: selected.id })
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: OPTIONS_KEY }),
  })

  const toggleActiveMut = useMutation({
    mutationFn: async (o: OptionWithPlatforms) => {
      const { error } = await supabase.from('catalog_options').update({ active: !o.active }).eq('id', o.id)
      if (error) throw error
    },
    onMutate: async (o) => {
      await qc.cancelQueries({ queryKey: OPTIONS_KEY })
      const prev = qc.getQueryData<OptionWithPlatforms[]>(OPTIONS_KEY)
      qc.setQueryData<OptionWithPlatforms[]>(OPTIONS_KEY, old => old?.map(x => x.id === o.id ? { ...x, active: !x.active } : x))
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(OPTIONS_KEY, ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: OPTIONS_KEY }),
  })

  const priceMut = useMutation({
    mutationFn: async ({ id, cents, isManual }: { id: string; cents: number; isManual: boolean }) => {
      // For cost_based manual options, the row's Price is the parts-
      // sell input (manual_parts_sell_cents). reprice recomputes
      // price_cents on top of category labour. For everyone else
      // (synced + simple-mode) write price_cents directly.
      if (costBased && isManual) {
        const { error } = await supabase.from('catalog_options').update({ manual_parts_sell_cents: cents }).eq('id', id)
        if (error) throw error
        await supabase.rpc('reprice_builder', { target_builder: selected!.id })
      } else {
        const { error } = await supabase.from('catalog_options').update({ price_cents: cents }).eq('id', id)
        if (error) throw error
      }
    },
    onMutate: async ({ id, cents, isManual }) => {
      await qc.cancelQueries({ queryKey: OPTIONS_KEY })
      const prev = qc.getQueryData<OptionWithPlatforms[]>(OPTIONS_KEY)
      qc.setQueryData<OptionWithPlatforms[]>(OPTIONS_KEY, old => old?.map(x => {
        if (x.id !== id) return x
        return costBased && isManual
          ? { ...x, manual_parts_sell_cents: cents }
          : { ...x, price_cents: cents }
      }))
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(OPTIONS_KEY, ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: OPTIONS_KEY }),
  })

  const categoryMut = useMutation({
    mutationFn: async ({ id, categoryId }: { id: string; categoryId: string | null }) => {
      const { error } = await supabase.from('catalog_options')
        .update({ category_id: categoryId, category_locked: categoryId != null })
        .eq('id', id)
      if (error) throw error
      await supabase.rpc('reprice_builder', { target_builder: selected!.id })
    },
    onMutate: async ({ id, categoryId }) => {
      await qc.cancelQueries({ queryKey: OPTIONS_KEY })
      const prev = qc.getQueryData<OptionWithPlatforms[]>(OPTIONS_KEY)
      qc.setQueryData<OptionWithPlatforms[]>(OPTIONS_KEY, old => old?.map(x =>
        x.id === id ? { ...x, category_id: categoryId, category_locked: categoryId != null } : x,
      ))
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(OPTIONS_KEY, ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: OPTIONS_KEY }),
  })

  function handleSwatchUpload(optionId: string, url: string) {
    qc.setQueryData<OptionWithPlatforms[]>(OPTIONS_KEY, old => old?.map(x => x.id === optionId ? { ...x, swatch_image_url: url } : x))
  }

  async function handleSave(data: CatalogOptionForm, platformIds: string[], id?: string, groupId?: string) {
    setSaving(true)
    await saveMutation.mutateAsync({ data, platformIds, id, groupId })
    setSaving(false)
    setEditing(null)
  }

  if (loadingOptions && !options) {
    return <div className="flex items-center justify-center py-16"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }
  if (optionsError) {
    return <ErrorState message={(optionsError as Error).message} retry={refetch} />
  }

  // Variable row height: headers 48, data rows 56. react-window supports
  // both via a function.
  function rowHeight(idx: number): number {
    const it = items[idx]
    return it?.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <FilterBar
        platforms={platforms}
        groups={groups}
        filters={filters}
        setFilters={setFilters}
        resultCount={filtered.length}
        onAdd={() => {
          const first = (filters.groupId ? groups.find(g => g.id === filters.groupId) : groups[0])
          if (first) setEditing({ groupId: first.id })
        }}
      />

      {items.length === 0 ? (
        <EmptyState title="No options match these filters" description="Clear the filters above to see more." />
      ) : (
        <div className="flex-1 min-h-0 border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden mt-3 flex flex-col">
          <ColumnHeader
            costBased={costBased}
            showTierChips={showTierChips}
          />
          <div className="flex-1 min-h-0">
          <List
            rowCount={items.length}
            rowHeight={rowHeight}
            defaultHeight={600}
            // The react-window v2 generics are strict about the row
            // component shape; our Row takes the row-props we care
            // about plus the index/style the virtualizer injects.
            // Cast once at the use site rather than fight the generic.
            rowComponent={Row as unknown as never}
            rowProps={{
              items, platforms, tiers, categories, costBased, showTierChips, collapsed,
              toggleCollapse,
              onEdit: (o: OptionWithPlatforms) => setEditing({ option: o, groupId: o.group_id }),
              onToggleActive: (o: OptionWithPlatforms) => toggleActiveMut.mutate(o),
              onSwatchUpload: handleSwatchUpload,
              savePrice: (id: string, cents: number) => {
                const opt = (options ?? []).find(x => x.id === id)
                priceMut.mutate({ id, cents, isManual: !opt?.synced })
              },
              saveCategory: (id: string, categoryId: string | null) => categoryMut.mutate({ id, categoryId }),
              onOpenCost: (o: OptionWithPlatforms) => setCostOptionId(o.id),
            }}
          />
          </div>
        </div>
      )}

      {editing && (
        <OptionEditForm
          option={editing.option}
          groupId={editing.groupId}
          tiers={tiers}
          platforms={platforms}
          costBased={costBased}
          showTierChips={showTierChips}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          saving={saving}
        />
      )}

      {costOptionId && terms && costBased && (() => {
        const opt = (options ?? []).find(x => x.id === costOptionId)
        if (!opt) return null
        const cat = opt.category_id ? categories.find(c => c.id === opt.category_id) ?? null : null
        const originId = opt.origin_id ?? cat?.default_origin_id ?? null
        const origin = originId ? origins.find(o => o.id === originId) ?? null : null
        return (
          <CostDrawer
            option={opt}
            category={cat}
            origin={origin}
            terms={terms}
            onClose={() => setCostOptionId(null)}
          />
        )
      })()}
    </div>
  )
}
