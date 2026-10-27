import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { List } from 'react-window'
import {
  Pencil, Check, X, ToggleLeft, ToggleRight, Upload, Image,
  ChevronDown, ChevronRight, Search, Plus,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { CatalogOption, Tier, Platform, OptionGroup, BuilderTerms } from '@/types/database'
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

// ─── Price helpers ────────────────────────────────────────────────────────────

function money(cents: number): string {
  if (cents === 0) return 'Set a price'
  return `$${(cents / 100).toLocaleString('en-US')}`
}

function optionFormToDb(data: CatalogOptionForm, builderId: string) {
  return {
    builder_id: builderId,
    slug: data.slug,
    name: data.name,
    code: data.code ?? null,
    price_cents: Math.round(data.price * 100),
    included_in_tier_ids: data.included_in_tier_ids,
    sort: data.sort,
    active: data.active,
    sold_as_set: data.sold_as_set,
  }
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
  showTierChips: boolean
  collapsed: Record<string, boolean>
  toggleCollapse: (groupId: string) => void
  onEdit: (o: OptionWithPlatforms) => void
  onToggleActive: (o: OptionWithPlatforms) => void
  onSwatchUpload: (id: string, url: string) => void
  savePrice: (optionId: string, cents: number) => void
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

  // Option row — single line.
  return (
    <OptionRow
      style={style}
      option={it.option}
      group={it.group}
      platforms={platforms}
      tiers={tiers}
      showTierChips={showTierChips}
      onEdit={onEdit}
      onToggleActive={onToggleActive}
      onSwatchUpload={onSwatchUpload}
      savePrice={savePrice}
    />
  )
}

interface OptionRowStandaloneProps {
  style: React.CSSProperties
  option: OptionWithPlatforms
  group: OptionGroup
  platforms: Platform[]
  tiers: Tier[]
  showTierChips: boolean
  onEdit: (o: OptionWithPlatforms) => void
  onToggleActive: (o: OptionWithPlatforms) => void
  onSwatchUpload: (id: string, url: string) => void
  savePrice: (optionId: string, cents: number) => void
}

function OptionRow({
  style, option, platforms, tiers, showTierChips,
  onEdit, onToggleActive, onSwatchUpload, savePrice,
}: OptionRowStandaloneProps) {
  const isManual = !option.synced
  const kitSku = (option as { kit_sku?: string | null }).kit_sku ?? option.code
  // category_id / cost_cents land in Phase 5. Feature-detect so this
  // UX works both pre- and post-merge.
  const costCents = (option as { cost_cents?: number | null }).cost_cents ?? null

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

      <div className="w-32 shrink-0 text-xs">
        <PlatformsCell ids={option.platform_ids} platforms={platforms} />
      </div>

      {/* Inline-editable Price (manual only). Synced price is read-only. */}
      <div className="w-28 shrink-0 text-right">
        {isManual ? (
          <InlinePriceEdit
            value={option.price_cents}
            onSave={cents => savePrice(option.id, cents)}
          />
        ) : (
          <span className="text-sm">{money(option.price_cents)}</span>
        )}
      </div>

      {/* Cost column slot — populated when catalog_options.cost_cents
          exists (Phase 5+). On main we render nothing. */}
      {costCents != null && (
        <div className="w-24 shrink-0 text-right text-sm text-[var(--color-muted)]">
          ${(costCents / 100).toLocaleString('en-US')}
        </div>
      )}

      {/* Tier chips only when option_mode is included_only. CTC's
          "priced" mode hides them for a cleaner one-line row. */}
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

// ─── Full edit form (modal / inline for new) ─────────────────────────────────

interface EditFormProps {
  option?: OptionWithPlatforms
  groupId: string
  tiers: Tier[]
  platforms: Platform[]
  showTierChips: boolean
  onSave: (data: CatalogOptionForm, platformIds: string[], id?: string, groupId?: string) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function OptionEditForm({ option, groupId, tiers, platforms, showTierChips, onSave, onCancel, saving }: EditFormProps) {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<CatalogOptionForm>({
    resolver: zodResolver(catalogOptionSchema),
    defaultValues: option
      ? {
          slug: option.slug, name: option.name, code: option.code ?? '',
          price: option.price_cents / 100,
          included_in_tier_ids: option.included_in_tier_ids,
          sort: option.sort, active: option.active, sold_as_set: option.sold_as_set ?? false,
        }
      : { price: 0, included_in_tier_ids: [], sort: 0, active: true, sold_as_set: false },
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
          <div>
            <label className="text-xs text-[var(--color-muted)] mb-1 block">Price</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">$</span>
              <input {...register('price')} type="number" step="0.01" min="0" className={`${inputClass} pl-7`} />
            </div>
          </div>
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

  const showTierChips = terms?.option_mode === 'included_only'

  const [filters, setFilters] = useState<Filters>({
    platformId: '', groupId: '', search: '', activeOnly: false, manualOnly: false, missingPriceOnly: false,
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
        if (o.platform_ids.length > 0 && !o.platform_ids.includes(filters.platformId)) return false
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
      const payload = optionFormToDb(data, selected.id)
      if (id) {
        const { builder_id: _bid, ...update } = payload
        const { error } = await supabase.from('catalog_options').update(update).eq('id', id)
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
    mutationFn: async ({ id, cents }: { id: string; cents: number }) => {
      const { error } = await supabase.from('catalog_options').update({ price_cents: cents }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, cents }) => {
      await qc.cancelQueries({ queryKey: OPTIONS_KEY })
      const prev = qc.getQueryData<OptionWithPlatforms[]>(OPTIONS_KEY)
      qc.setQueryData<OptionWithPlatforms[]>(OPTIONS_KEY, old => old?.map(x => x.id === id ? { ...x, price_cents: cents } : x))
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
        <div className="flex-1 min-h-0 border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden mt-3">
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
              items, platforms, tiers, showTierChips, collapsed,
              toggleCollapse,
              onEdit: (o: OptionWithPlatforms) => setEditing({ option: o, groupId: o.group_id }),
              onToggleActive: (o: OptionWithPlatforms) => toggleActiveMut.mutate(o),
              onSwatchUpload: handleSwatchUpload,
              savePrice: (id: string, cents: number) => priceMut.mutate({ id, cents }),
            }}
          />
        </div>
      )}

      {editing && (
        <OptionEditForm
          option={editing.option}
          groupId={editing.groupId}
          tiers={tiers}
          platforms={platforms}
          showTierChips={showTierChips}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          saving={saving}
        />
      )}
    </div>
  )
}
