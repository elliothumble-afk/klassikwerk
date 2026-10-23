import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical, Plus, Pencil, Check, X,
  ToggleLeft, ToggleRight, Upload, Image, DollarSign,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { CatalogOption, Tier, Platform, OptionGroup, CatalogCategory, Origin, BuilderTerms } from '@/types/database'
import { catalogOptionSchema, type CatalogOptionForm } from '@/schemas/catalog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Spinner } from '@/components/ui/Spinner'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'

const optionsKey = (builderId?: string) => ['catalog', 'options', builderId ?? 'none']
const tiersKey = (builderId?: string) => ['catalog', 'tiers', builderId ?? 'none']
const platformsKey = (builderId?: string) => ['catalog', 'platforms', builderId ?? 'none']
const groupsKey = (builderId?: string) => ['catalog', 'option-groups', builderId ?? 'none']

type OptionWithPlatforms = CatalogOption & { platform_ids: string[] }

function useOptions(builderId?: string) {
  return useQuery({
    queryKey: optionsKey(builderId),
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data: options, error: optErr } = await supabase
        .from('catalog_options')
        .select('*')
        .eq('builder_id', builderId!)
        .order('sort')
      if (optErr) throw optErr

      const { data: opPlats, error: opPlatsErr } = await supabase
        .from('catalog_option_platforms')
        .select('option_id, platform_id')
      if (opPlatsErr) throw opPlatsErr

      const platMap = new Map<string, string[]>()
      for (const r of opPlats ?? []) {
        const arr = platMap.get(r.option_id) ?? []
        arr.push(r.platform_id)
        platMap.set(r.option_id, arr)
      }

      return (options ?? []).map(o => ({
        ...(o as CatalogOption),
        platform_ids: platMap.get(o.id) ?? [],
      })) as OptionWithPlatforms[]
    },
  })
}

function useTiers(builderId?: string) {
  return useQuery({
    queryKey: tiersKey(builderId),
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_tiers')
        .select('*')
        .eq('builder_id', builderId!)
        .order('sort')
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
      const { data, error } = await supabase
        .from('catalog_platforms')
        .select('*')
        .eq('builder_id', builderId!)
        .order('sort')
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
      const { data, error } = await supabase
        .from('catalog_option_groups')
        .select('*')
        .eq('builder_id', builderId!)
        .order('sort')
      if (error) throw error
      return data as OptionGroup[]
    },
  })
}

function useCategories(builderId?: string) {
  return useQuery({
    queryKey: ['catalog', 'categories', builderId ?? 'none'],
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_categories')
        .select('*')
        .eq('builder_id', builderId!)
        .order('sort')
      if (error) throw error
      return data as CatalogCategory[]
    },
  })
}

function useBuilderTerms(builderId?: string) {
  return useQuery({
    queryKey: ['builder-terms', builderId ?? 'none'],
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data, error } = await supabase.from('builder_terms')
        .select('*').eq('builder_id', builderId!).maybeSingle()
      if (error) throw error
      return data as BuilderTerms | null
    },
  })
}

function useOrigins(builderId?: string) {
  return useQuery({
    queryKey: ['catalog', 'origins', builderId ?? 'none'],
    enabled: Boolean(builderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('origins')
        .select('*')
        .eq('builder_id', builderId!)
        .order('sort')
      if (error) throw error
      return data as Origin[]
    },
  })
}

// ─── Cost drawer ──────────────────────────────────────────────────────────────
// Per-option breakdown for cost_based builders. Mirrors the Catalog
// sheet in docs/seeds/CTC-Build-House-Costing.xlsx row-for-row so an
// ops user can audit how the final price was reached.

interface CostDrawerProps {
  option: CatalogOption
  category: CatalogCategory | null
  origin: Origin | null
  terms: BuilderTerms
  onClose: () => void
}

function CostDrawer({ option, category, origin, terms, onClose }: CostDrawerProps) {
  const money = (c: number) => `$${c.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const pct = (p: number) => `${(p * 100).toFixed(2)}%`

  const webPriceGbp = (option.web_price_cents ?? 0) / 100
  const retail = webPriceGbp * Number(terms.fx_rate)
  const kitCost = retail * (1 - Number(terms.trade_discount_pct))
  const freight = (category?.freight_cents ?? 0) / 100
  const dutyPct = Number(category?.hts_duty_pct ?? 0)
  const duty = kitCost * dutyPct
  const tariffPct = Number(origin?.tariff_pct ?? 0)
  const tariff = kitCost * tariffPct
  const s232Pct = Number(origin?.s232_aluminium_pct ?? 0)
  const isWheels = category?.name === 'Alloy wheels'
  const s232 = isWheels ? kitCost * Number(terms.aluminium_share_pct) * s232Pct : 0
  const mpf = kitCost * Number(terms.mpf_pct)
  const brokeragePer = (terms.brokerage_cents / 100) / Math.max(1, terms.items_per_shipment)
  const fees = mpf + brokeragePer
  const landed = kitCost + freight + duty + tariff + s232 + fees
  const partsSell = retail + freight + duty + tariff + s232 + fees
  const installH = Number(category?.install_hours ?? 0)
  const paintH = Number(category?.paint_hours ?? 0)
  const labour = installH * (terms.labour_rate_cents / 100) + paintH * (terms.paint_rate_cents / 100)
  const materials = (category?.paint_materials_cents ?? 0) / 100
  const install = labour + materials
  const total = partsSell + install

  const rows: { label: string; detail?: string; value: string; strong?: boolean; muted?: boolean }[] = [
    { label: 'Web price', detail: `£${webPriceGbp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, value: `× fx ${terms.fx_rate}`, muted: true },
    { label: 'Retail USD', value: money(retail) },
    { label: 'Kit cost', detail: `× (1 − ${pct(Number(terms.trade_discount_pct))})`, value: money(kitCost) },
    { label: 'Freight', detail: category?.name ?? '—', value: money(freight) },
    { label: 'HTS duty', detail: pct(dutyPct), value: money(duty) },
    { label: 'Tariff', detail: `${origin?.name ?? '—'} · ${pct(tariffPct)}`, value: money(tariff) },
    {
      label: 'Section 232 (aluminium)',
      detail: isWheels ? `${pct(Number(terms.aluminium_share_pct))} × ${pct(s232Pct)}` : 'wheels only',
      value: money(s232),
      muted: !isWheels,
    },
    { label: 'MPF + brokerage', detail: `MPF ${pct(Number(terms.mpf_pct))} + $${brokeragePer.toFixed(2)}/item`, value: money(fees) },
    { label: 'Landed cost', detail: 'kit + freight + duty + tariff + 232 + fees', value: money(landed), strong: true },
    { label: 'Parts sell', detail: 'retail + landing', value: money(partsSell), strong: true },
    { label: 'Labour', detail: `${installH}h × $${terms.labour_rate_cents/100} + ${paintH}h × $${terms.paint_rate_cents/100}`, value: money(labour) },
    { label: 'Paint materials', value: money(materials) },
    { label: 'Install price', detail: 'labour + materials', value: money(install), strong: true },
    { label: 'Final price', detail: 'parts sell + install', value: money(total), strong: true },
  ]

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={`Cost breakdown for ${option.name}`}
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
            No category assigned — set one in the option's edit form.
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.label}
                  className={`border-b border-[var(--color-border)] last:border-0 ${
                    r.strong ? 'bg-[var(--color-surface-raised)]' : ''
                  }`}
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

function formatPrice(cents: number) {
  if (cents === 0) return 'Included'
  return `+$${(cents / 100).toLocaleString()}`
}

// Convert CatalogOptionForm dollars → DB cents payload. Mark
// category_locked whenever ops picks a category explicitly, so the
// next sync won't overwrite it.
function optionFormToDb(data: CatalogOptionForm, builderId: string, originalCategoryId: string | null | undefined) {
  const categoryChanged = (data.category_id ?? null) !== (originalCategoryId ?? null)
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
    category_id: data.category_id,
    origin_id: data.origin_id,
    category_locked: categoryChanged || (data.category_id != null),
  }
}

// ─── Swatch thumbnail + lightbox ─────────────────────────────────────────────

interface SwatchThumbnailProps {
  url: string
  name: string
}

function SwatchThumbnail({ url, name }: SwatchThumbnailProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="block w-10 h-10 rounded-md overflow-hidden border border-[var(--color-border)] hover:ring-2 hover:ring-[var(--color-accent)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        title="View full image"
        aria-label={`View swatch for ${name}`}
      >
        <img src={url} alt={name} className="w-full h-full object-cover" />
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal
          aria-label={`Swatch: ${name}`}
        >
          <div className="relative max-w-lg max-h-[80vh] p-2" onClick={e => e.stopPropagation()}>
            <img
              src={url}
              alt={name}
              className="max-w-full max-h-[75vh] rounded-lg shadow-2xl object-contain"
            />
            <p className="mt-2 text-center text-sm text-white/80">{name}</p>
            <button
              onClick={() => setOpen(false)}
              className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-white text-black flex items-center justify-center shadow hover:bg-gray-100 transition"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

function SwatchPlaceholder() {
  return (
    <div className="w-10 h-10 rounded-md bg-[var(--color-surface-raised)] border border-[var(--color-border)] flex items-center justify-center">
      <Image size={15} className="text-[var(--color-muted)]" strokeWidth={1.5} />
    </div>
  )
}

interface SwatchUploadProps {
  optionId: string
  optionName: string
  currentUrl: string | null
  onUpload: (url: string) => void
}

function SwatchUpload({ optionId, optionName, currentUrl, onUpload }: SwatchUploadProps) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `swatch/${optionId}.${ext}`

    const { error: upErr } = await supabase.storage
      .from('media')
      .upload(path, file, { upsert: true })

    if (upErr) {
      console.error(upErr)
      setUploading(false)
      return
    }

    // getPublicUrl returns the canonical public URL for this bucket path
    const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(path)

    const { error: dbErr } = await supabase
      .from('catalog_options')
      .update({ swatch_image_url: publicUrl })
      .eq('id', optionId)

    if (!dbErr) onUpload(publicUrl)
    setUploading(false)
  }

  return (
    <div className="flex items-center gap-2">
      {currentUrl
        ? <SwatchThumbnail url={currentUrl} name={optionName} />
        : <SwatchPlaceholder />
      }
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition disabled:opacity-50"
        title="Upload swatch image"
      >
        {uploading ? <Spinner size={12} /> : <Upload size={12} />}
        {uploading ? 'Uploading…' : 'Upload'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// ─── Option row ───────────────────────────────────────────────────────────────

interface OptionRowProps {
  option: OptionWithPlatforms
  tiers: Tier[]
  platforms: Platform[]
  costBased: boolean
  onEdit: (o: OptionWithPlatforms) => void
  onToggleActive: (o: OptionWithPlatforms) => void
  onSwatchUpload: (id: string, url: string) => void
  onOpenCost: (o: OptionWithPlatforms) => void
}

function OptionRow({ option, tiers, platforms, costBased, onEdit, onToggleActive, onSwatchUpload, onOpenCost }: OptionRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: option.id })

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-b border-[var(--color-border)] last:border-0 ${isDragging ? 'opacity-50' : ''}`}
    >
      <td className="py-3 pr-3 pl-4 w-8">
        <button
          {...attributes}
          {...listeners}
          className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
      </td>

      <td className="py-3 pr-3 w-14">
        <SwatchUpload
          optionId={option.id}
          optionName={option.name}
          currentUrl={option.swatch_image_url}
          onUpload={url => onSwatchUpload(option.id, url)}
        />
      </td>

      <td className="py-3 pr-3 text-sm font-medium">{option.name}</td>
      <td className="py-3 pr-3 text-sm text-[var(--color-muted)] font-mono text-xs">{option.code ?? '—'}</td>
      <td className="py-3 pr-3 text-sm text-[var(--color-muted)]">{formatPrice(option.price_cents)}</td>

      <td className="py-3 pr-3">
        <div className="flex gap-1.5 flex-wrap">
          {tiers.map(tier => {
            const included = option.included_in_tier_ids.includes(tier.id)
            return (
              <span
                key={tier.id}
                className={`px-1.5 py-0.5 rounded text-xs ${
                  included
                    ? 'bg-[var(--color-accent-light)] text-[var(--color-accent)] font-medium'
                    : 'bg-[var(--color-surface-raised)] text-[var(--color-muted)]'
                }`}
              >
                {tier.name}
              </span>
            )
          })}
        </div>
      </td>

      <td className="py-3 pr-3">
        {option.platform_ids.length === 0 ? (
          <span className="text-xs text-[var(--color-muted)]">All</span>
        ) : (
          <div className="flex gap-1 flex-wrap">
            {option.platform_ids.map(pid => {
              const pl = platforms.find(p => p.id === pid)
              return pl ? (
                <span key={pid} className="px-1.5 py-0.5 rounded text-xs bg-[var(--color-surface-raised)] text-[var(--color-foreground)]">
                  {pl.chassis}
                </span>
              ) : null
            })}
          </div>
        )}
      </td>

      <td className="py-3 pr-3">
        <button
          onClick={() => onToggleActive(option)}
          className={`flex items-center gap-1 text-xs transition ${
            option.active ? 'text-[var(--color-success)]' : 'text-[var(--color-muted)]'
          }`}
        >
          {option.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          {option.active ? 'Active' : 'Off'}
        </button>
      </td>

      <td className="py-3 pr-2 w-8">
        {costBased && (
          <button
            onClick={() => onOpenCost(option)}
            className="text-[var(--color-muted)] hover:text-[var(--color-accent)] transition"
            aria-label="Cost breakdown"
            title="Cost breakdown"
          >
            <DollarSign size={13} />
          </button>
        )}
      </td>

      <td className="py-3 pr-4 w-8">
        <button
          onClick={() => onEdit(option)}
          className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition"
          aria-label="Edit"
        >
          <Pencil size={13} />
        </button>
      </td>
    </tr>
  )
}

// ─── Edit form ────────────────────────────────────────────────────────────────

interface EditFormProps {
  option?: OptionWithPlatforms
  groupId: string
  tiers: Tier[]
  platforms: Platform[]
  categories: CatalogCategory[]
  origins: Origin[]
  onSave: (data: CatalogOptionForm, platformIds: string[], id?: string) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function OptionEditForm({ option, tiers, platforms, categories, origins, onSave, onCancel, saving }: EditFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CatalogOptionForm>({
    resolver: zodResolver(catalogOptionSchema),
    defaultValues: option
      ? {
          slug: option.slug,
          name: option.name,
          code: option.code ?? '',
          price: option.price_cents / 100,
          included_in_tier_ids: option.included_in_tier_ids,
          sort: option.sort,
          active: option.active,
          sold_as_set: option.sold_as_set ?? false,
          category_id: option.category_id ?? '',
          origin_id: option.origin_id ?? '',
        }
      : { price: 0, included_in_tier_ids: [], sort: 0, active: true, sold_as_set: false, category_id: '', origin_id: '' },
  })

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(
    option?.platform_ids ?? []
  )

  const includedTierIds = watch('included_in_tier_ids')

  function toggleTier(id: string) {
    const current = includedTierIds ?? []
    setValue(
      'included_in_tier_ids',
      current.includes(id) ? current.filter(t => t !== id) : [...current, id]
    )
  }

  function togglePlatform(id: string) {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  const inputClass = `
    h-9 px-3 w-full rounded-[var(--radius-sm)]
    border border-[var(--color-border)] bg-[var(--color-surface)]
    text-sm text-[var(--color-foreground)]
    focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] focus:border-transparent
    transition
  `

  return (
    <tr className="border-b border-[var(--color-border)] bg-[var(--color-accent-light)]">
      <td colSpan={10} className="py-4 px-4">
        <form
          onSubmit={handleSubmit(d => onSave(d, selectedPlatforms, option?.id))}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
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
              <input {...register('code')} className={inputClass} placeholder="MB-359" />
            </div>
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Price</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)] pointer-events-none select-none">
                  $
                </span>
                <input
                  {...register('price')}
                  type="number"
                  step="0.01"
                  min="0"
                  className={`${inputClass} pl-7`}
                  placeholder="0"
                />
              </div>
              {errors.price && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.price.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-[var(--color-muted)] mb-1.5">Included in tiers</p>
              <div className="flex gap-2 flex-wrap">
                {tiers.map(tier => (
                  <button
                    key={tier.id}
                    type="button"
                    onClick={() => toggleTier(tier.id)}
                    className={`px-2.5 py-1 rounded text-xs transition ${
                      includedTierIds?.includes(tier.id)
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    {tier.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-[var(--color-muted)] mb-1.5">Platform restriction (empty = all)</p>
              <div className="flex gap-2 flex-wrap">
                {platforms.map(platform => (
                  <button
                    key={platform.id}
                    type="button"
                    onClick={() => togglePlatform(platform.id)}
                    className={`px-2.5 py-1 rounded text-xs transition ${
                      selectedPlatforms.includes(platform.id)
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    {platform.chassis}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {categories.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[var(--color-muted)] mb-1 block">Category</label>
                <select {...register('category_id')} className={inputClass}>
                  <option value="">— uncategorised —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--color-muted)] mb-1 block">Origin override (optional)</label>
                <select {...register('origin_id')} className={inputClass}>
                  <option value="">— use category default —</option>
                  {origins.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input {...register('active')} type="checkbox" className="rounded" />
              Active
            </label>
            <label
              className="flex items-center gap-2 text-sm cursor-pointer"
              title="Price IS the price of a set of 4 — do not multiply by qty"
            >
              <input {...register('sold_as_set')} type="checkbox" className="rounded" />
              Sold as set of 4
            </label>
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Sort</label>
              <input {...register('sort')} type="number" className={`${inputClass} w-20`} />
            </div>
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={onCancel}
                className="flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] text-sm text-[var(--color-muted)] hover:bg-[var(--color-border)] transition"
              >
                <X size={13} /> Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition"
              >
                {saving ? <Spinner size={13} /> : <Check size={13} />}
                Save
              </button>
            </div>
          </div>
        </form>
      </td>
    </tr>
  )
}

// ─── Group section ────────────────────────────────────────────────────────────

interface GroupSectionProps {
  group: OptionGroup
  options: OptionWithPlatforms[]
  tiers: Tier[]
  platforms: Platform[]
  categories: CatalogCategory[]
  origins: Origin[]
  costBased: boolean
  editingId: string | 'new' | null
  setEditingId: (id: string | 'new' | null) => void
  saving: boolean
  onSave: (data: CatalogOptionForm, platformIds: string[], id?: string, groupId?: string) => Promise<void>
  onToggleActive: (o: OptionWithPlatforms) => void
  onToggleAllowQuantity: (g: OptionGroup) => void
  onDragEnd: (event: DragEndEvent, groupId: string) => void
  onSwatchUpload: (id: string, url: string) => void
  onOpenCost: (o: OptionWithPlatforms) => void
}

function GroupSection({
  group, options, tiers, platforms, categories, origins, costBased,
  editingId, setEditingId, saving, onSave, onToggleActive, onToggleAllowQuantity, onDragEnd, onSwatchUpload, onOpenCost,
}: GroupSectionProps) {
  const sensors = useSensors(useSensor(PointerSensor))
  const addingToThisGroup = editingId === `new-${group.id}`

  return (
    <div className="mb-6 bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{group.name}</span>
          <span className="text-xs text-[var(--color-muted)]">
            {group.selection} · {group.required ? 'required' : 'optional'}
          </span>
          <button
            onClick={() => onToggleAllowQuantity(group)}
            disabled={group.synced}
            title={
              group.synced
                ? 'Synced groups: quantity is managed by the sync'
                : group.allow_quantity
                  ? 'Click to disable Set of 4 / Set of 5 chooser'
                  : 'Click to enable Set of 4 / Set of 5 chooser (for wheels etc.)'
            }
            className={`flex items-center gap-1 text-xs transition disabled:opacity-50 disabled:cursor-not-allowed ${
              group.allow_quantity ? 'text-[var(--color-success)]' : 'text-[var(--color-muted)]'
            } hover:text-[var(--color-foreground)]`}
          >
            {group.allow_quantity ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            Set-of qty
          </button>
        </div>
        <button
          onClick={() => setEditingId(`new-${group.id}`)}
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-sm)] bg-[var(--color-accent-light)] text-[var(--color-accent)] text-xs hover:bg-[var(--color-accent)] hover:text-white transition"
        >
          <Plus size={12} /> Add option
        </button>
      </div>

      {options.length === 0 && !addingToThisGroup ? (
        <EmptyState
          title={`No ${group.name.toLowerCase()} options`}
          description="Add the first option in this group."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-2 pr-2 pl-4 w-8" />
                <th className="text-left py-2 pr-2 w-14 text-xs font-medium text-[var(--color-muted)]">Swatch</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Name</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Code</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Price</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Included in</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Platforms</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Status</th>
                <th className="text-left py-2 pr-2 w-8" />
                <th className="text-left py-2 pr-4 w-8" />
              </tr>
            </thead>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={e => onDragEnd(e, group.id)}
            >
              <SortableContext
                items={options.map(o => o.id)}
                strategy={verticalListSortingStrategy}
              >
                <tbody>
                  {options.map(option =>
                    editingId === option.id ? (
                      <OptionEditForm
                        key={option.id}
                        option={option}
                        groupId={group.id}
                        tiers={tiers}
                        platforms={platforms}
                        categories={categories}
                        origins={origins}
                        onSave={onSave}
                        onCancel={() => setEditingId(null)}
                        saving={saving}
                      />
                    ) : (
                      <OptionRow
                        key={option.id}
                        option={option}
                        tiers={tiers}
                        platforms={platforms}
                        costBased={costBased}
                        onEdit={o => setEditingId(o.id)}
                        onToggleActive={onToggleActive}
                        onSwatchUpload={onSwatchUpload}
                        onOpenCost={onOpenCost}
                      />
                    )
                  )}
                  {addingToThisGroup && (
                    <OptionEditForm
                      groupId={group.id}
                      tiers={tiers}
                      platforms={platforms}
                      categories={categories}
                      origins={origins}
                      onSave={(data, platIds, id) => onSave(data, platIds, id, group.id)}
                      onCancel={() => setEditingId(null)}
                      saving={saving}
                    />
                  )}
                </tbody>
              </SortableContext>
            </DndContext>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Tab root ─────────────────────────────────────────────────────────────────

export function OptionsTab() {
  const qc = useQueryClient()
  const { selected } = useOpsBuilderSelection()
  const OPTIONS_KEY = optionsKey(selected?.id)
  const { data: options, isLoading: loadingOptions, error: optionsError, refetch } = useOptions(selected?.id)
  const { data: tiers = [], isLoading: loadingTiers } = useTiers(selected?.id)
  const { data: platforms = [], isLoading: loadingPlatforms } = usePlatforms(selected?.id)
  const { data: groups = [], isLoading: loadingGroups } = useOptionGroups(selected?.id)
  const { data: categories = [] } = useCategories(selected?.id)
  const { data: origins = [] } = useOrigins(selected?.id)
  const { data: terms } = useBuilderTerms(selected?.id)
  const costBased = terms?.pricing_mode === 'cost_based'

  const [editingId, setEditingId] = useState<string | null>(null)
  const [costOptionId, setCostOptionId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const isLoading = loadingOptions || loadingTiers || loadingPlatforms || loadingGroups

  const saveMutation = useMutation({
    mutationFn: async ({
      data,
      platformIds,
      id,
      groupId,
      originalCategoryId,
    }: {
      data: CatalogOptionForm
      platformIds: string[]
      id?: string
      groupId?: string
      originalCategoryId?: string | null
    }) => {
      if (!selected) throw new Error('No builder selected')
      const payload = optionFormToDb(data, selected.id, originalCategoryId)
      if (id) {
        const { builder_id: _bid, ...update } = payload
        const { error } = await supabase.from('catalog_options').update(update).eq('id', id)
        if (error) throw error
        // Trigger a reprice so the editor reflects the new category/
        // origin immediately for cost_based builders.
        await supabase.rpc('reprice_builder', { target_builder: selected.id })

        await supabase.from('catalog_option_platforms').delete().eq('option_id', id)
        if (platformIds.length > 0) {
          const { error: pe } = await supabase.from('catalog_option_platforms').insert(
            platformIds.map(pid => ({ option_id: id, platform_id: pid }))
          )
          if (pe) throw pe
        }
      } else {
        if (!groupId) throw new Error('groupId required for new options')
        const { data: inserted, error } = await supabase
          .from('catalog_options')
          .insert({ ...payload, group_id: groupId })
          .select()
          .single()
        if (error) throw error

        if (platformIds.length > 0) {
          const { error: pe } = await supabase.from('catalog_option_platforms').insert(
            platformIds.map(pid => ({ option_id: inserted.id, platform_id: pid }))
          )
          if (pe) throw pe
        }
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: OPTIONS_KEY }),
  })

  const GROUPS_KEY = groupsKey(selected?.id)
  const allowQuantityMutation = useMutation({
    mutationFn: async (group: OptionGroup) => {
      const { error } = await supabase
        .from('catalog_option_groups')
        .update({ allow_quantity: !group.allow_quantity })
        .eq('id', group.id)
      if (error) throw error
    },
    onMutate: async (group) => {
      await qc.cancelQueries({ queryKey: GROUPS_KEY })
      const prev = qc.getQueryData<OptionGroup[]>(GROUPS_KEY)
      qc.setQueryData<OptionGroup[]>(GROUPS_KEY, old =>
        old?.map(g => g.id === group.id ? { ...g, allow_quantity: !g.allow_quantity } : g)
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(GROUPS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: GROUPS_KEY }),
  })

  const toggleMutation = useMutation({
    mutationFn: async (option: OptionWithPlatforms) => {
      const { error } = await supabase
        .from('catalog_options')
        .update({ active: !option.active })
        .eq('id', option.id)
      if (error) throw error
    },
    onMutate: async (option) => {
      await qc.cancelQueries({ queryKey: OPTIONS_KEY })
      const prev = qc.getQueryData<OptionWithPlatforms[]>(OPTIONS_KEY)
      qc.setQueryData<OptionWithPlatforms[]>(OPTIONS_KEY, old =>
        old?.map(o => o.id === option.id ? { ...o, active: !o.active } : o)
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(OPTIONS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: OPTIONS_KEY }),
  })

  function handleSwatchUpload(optionId: string, url: string) {
    qc.setQueryData<OptionWithPlatforms[]>(OPTIONS_KEY, old =>
      old?.map(o => o.id === optionId ? { ...o, swatch_image_url: url } : o)
    )
  }

  async function handleDragEnd(event: DragEndEvent, groupId: string) {
    const { active, over } = event
    if (!over || active.id === over.id || !options) return

    const groupOptions = options.filter(o => o.group_id === groupId)
    const oldIndex = groupOptions.findIndex(o => o.id === active.id)
    const newIndex = groupOptions.findIndex(o => o.id === over.id)
    const reordered = arrayMove(groupOptions, oldIndex, newIndex)

    qc.setQueryData<OptionWithPlatforms[]>(OPTIONS_KEY, old => {
      if (!old) return old
      const others = old.filter(o => o.group_id !== groupId)
      return [...others, ...reordered]
    })

    await Promise.all(
      reordered.map((o, i) =>
        supabase.from('catalog_options').update({ sort: i + 1 }).eq('id', o.id)
      )
    )
    qc.invalidateQueries({ queryKey: OPTIONS_KEY })
  }

  async function handleSave(
    data: CatalogOptionForm,
    platformIds: string[],
    id?: string,
    groupId?: string
  ) {
    setSaving(true)
    const original = id ? options?.find(o => o.id === id)?.category_id ?? null : null
    await saveMutation.mutateAsync({ data, platformIds, id, groupId, originalCategoryId: original })
    setSaving(false)
    setEditingId(null)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size={20} className="text-[var(--color-muted)]" />
      </div>
    )
  }

  if (optionsError) {
    return <ErrorState message={(optionsError as Error).message} retry={refetch} />
  }

  const costOption = costOptionId
    ? (options ?? []).find(o => o.id === costOptionId) ?? null
    : null

  return (
    <div>
      {groups.map(group => (
        <GroupSection
          key={group.id}
          group={group}
          options={(options ?? []).filter(o => o.group_id === group.id)}
          tiers={tiers}
          platforms={platforms}
          categories={categories}
          origins={origins}
          costBased={costBased}
          editingId={editingId}
          setEditingId={setEditingId}
          saving={saving}
          onSave={handleSave}
          onToggleActive={o => toggleMutation.mutate(o)}
          onToggleAllowQuantity={g => allowQuantityMutation.mutate(g)}
          onDragEnd={handleDragEnd}
          onSwatchUpload={handleSwatchUpload}
          onOpenCost={o => setCostOptionId(o.id)}
        />
      ))}

      {groups.length === 0 && (
        <EmptyState
          title="No option groups"
          description="Option groups are seeded automatically."
        />
      )}

      {costOption && terms && (
        <CostDrawer
          option={costOption}
          category={categories.find(c => c.id === costOption.category_id) ?? null}
          origin={
            origins.find(o => o.id === costOption.origin_id) ??
            (costOption.category_id
              ? origins.find(o => o.id === categories.find(c => c.id === costOption.category_id)?.default_origin_id) ?? null
              : null)
          }
          terms={terms}
          onClose={() => setCostOptionId(null)}
        />
      )}
    </div>
  )
}
