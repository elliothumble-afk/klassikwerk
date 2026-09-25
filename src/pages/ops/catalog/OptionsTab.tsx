import { useState, useRef } from 'react'
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
  ToggleLeft, ToggleRight, Upload, Image,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { CatalogOption, Tier, Platform, OptionGroup } from '@/types/database'
import { catalogOptionSchema, type CatalogOptionForm } from '@/schemas/catalog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Spinner } from '@/components/ui/Spinner'

const OPTIONS_KEY = ['catalog', 'options']
const TIERS_KEY = ['catalog', 'tiers']
const PLATFORMS_KEY = ['catalog', 'platforms']
const GROUPS_KEY = ['catalog', 'option-groups']

type OptionWithPlatforms = CatalogOption & { platform_ids: string[] }

function useOptions() {
  return useQuery({
    queryKey: OPTIONS_KEY,
    queryFn: async () => {
      const { data: options, error: optErr } = await supabase
        .from('catalog_options')
        .select('*')
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

function useTiers() {
  return useQuery({
    queryKey: TIERS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_tiers').select('*').order('sort')
      if (error) throw error
      return data as Tier[]
    },
  })
}

function usePlatforms() {
  return useQuery({
    queryKey: PLATFORMS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_platforms').select('*').order('sort')
      if (error) throw error
      return data as Platform[]
    },
  })
}

function useOptionGroups() {
  return useQuery({
    queryKey: GROUPS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_option_groups')
        .select('*')
        .order('sort')
      if (error) throw error
      return data as OptionGroup[]
    },
  })
}

function formatPrice(cents: number) {
  if (cents === 0) return 'Included'
  return `+$${(cents / 100).toLocaleString()}`
}

interface SwatchUploadProps {
  optionId: string
  currentUrl: string | null
  onUpload: (url: string) => void
}

function SwatchUpload({ optionId, currentUrl, onUpload }: SwatchUploadProps) {
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
      {currentUrl ? (
        <img
          src={currentUrl}
          alt="Swatch"
          className="w-8 h-8 rounded object-cover border border-[var(--color-border)]"
        />
      ) : (
        <div className="w-8 h-8 rounded bg-[var(--color-surface-raised)] border border-[var(--color-border)] flex items-center justify-center">
          <Image size={14} className="text-[var(--color-muted)]" />
        </div>
      )}
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

interface OptionRowProps {
  option: OptionWithPlatforms
  tiers: Tier[]
  platforms: Platform[]
  onEdit: (o: OptionWithPlatforms) => void
  onToggleActive: (o: OptionWithPlatforms) => void
  onSwatchUpload: (id: string, url: string) => void
}

function OptionRow({ option, tiers, platforms, onEdit, onToggleActive, onSwatchUpload }: OptionRowProps) {
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

      {/* Swatch */}
      <td className="py-3 pr-3 w-12">
        <SwatchUpload
          optionId={option.id}
          currentUrl={option.swatch_image_url}
          onUpload={url => onSwatchUpload(option.id, url)}
        />
      </td>

      <td className="py-3 pr-3 text-sm font-medium">{option.name}</td>
      <td className="py-3 pr-3 text-sm text-[var(--color-muted)] font-mono text-xs">{option.code ?? '—'}</td>
      <td className="py-3 pr-3 text-sm text-[var(--color-muted)]">{formatPrice(option.price_cents)}</td>

      {/* Included-in tier checkboxes (read-only display) */}
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

      {/* Platform restriction chips */}
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

interface EditFormProps {
  option?: OptionWithPlatforms
  groupId: string
  tiers: Tier[]
  platforms: Platform[]
  onSave: (data: CatalogOptionForm, platformIds: string[], id?: string) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function OptionEditForm({ option, tiers, platforms, onSave, onCancel, saving }: EditFormProps) {
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
          price_cents: option.price_cents,
          included_in_tier_ids: option.included_in_tier_ids,
          sort: option.sort,
          active: option.active,
        }
      : { price_cents: 0, included_in_tier_ids: [], sort: 0, active: true },
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
      <td colSpan={9} className="py-4 px-4">
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
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Price (cents)</label>
              <input {...register('price_cents')} type="number" className={inputClass} />
              {errors.price_cents && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.price_cents.message}</p>}
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

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input {...register('active')} type="checkbox" className="rounded" />
              Active
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

interface GroupSectionProps {
  group: OptionGroup
  options: OptionWithPlatforms[]
  tiers: Tier[]
  platforms: Platform[]
  editingId: string | 'new' | null
  setEditingId: (id: string | 'new' | null) => void
  saving: boolean
  onSave: (data: CatalogOptionForm, platformIds: string[], id?: string, groupId?: string) => Promise<void>
  onToggleActive: (o: OptionWithPlatforms) => void
  onDragEnd: (event: DragEndEvent, groupId: string) => void
  onSwatchUpload: (id: string, url: string) => void
}

function GroupSection({
  group, options, tiers, platforms,
  editingId, setEditingId, saving, onSave, onToggleActive, onDragEnd, onSwatchUpload,
}: GroupSectionProps) {
  const sensors = useSensors(useSensor(PointerSensor))
  const addingToThisGroup = editingId === `new-${group.id}`

  return (
    <div className="mb-6 bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div>
          <span className="text-sm font-medium">{group.name}</span>
          <span className="ml-2 text-xs text-[var(--color-muted)]">
            {group.selection} · {group.required ? 'required' : 'optional'}
          </span>
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
                <th className="text-left py-2 pr-2 w-12 text-xs font-medium text-[var(--color-muted)]">Swatch</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Name</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Code</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Price</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Included in</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Platforms</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--color-muted)]">Status</th>
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
                        onEdit={o => setEditingId(o.id)}
                        onToggleActive={onToggleActive}
                        onSwatchUpload={onSwatchUpload}
                      />
                    )
                  )}
                  {addingToThisGroup && (
                    <OptionEditForm
                      groupId={group.id}
                      tiers={tiers}
                      platforms={platforms}
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

export function OptionsTab() {
  const qc = useQueryClient()
  const { data: options, isLoading: loadingOptions, error: optionsError, refetch } = useOptions()
  const { data: tiers = [], isLoading: loadingTiers } = useTiers()
  const { data: platforms = [], isLoading: loadingPlatforms } = usePlatforms()
  const { data: groups = [], isLoading: loadingGroups } = useOptionGroups()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const isLoading = loadingOptions || loadingTiers || loadingPlatforms || loadingGroups

  const saveMutation = useMutation({
    mutationFn: async ({
      data,
      platformIds,
      id,
      groupId,
    }: {
      data: CatalogOptionForm
      platformIds: string[]
      id?: string
      groupId?: string
    }) => {
      if (id) {
        const { error } = await supabase.from('catalog_options').update(data).eq('id', id)
        if (error) throw error

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
          .insert({ ...data, group_id: groupId })
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
    await saveMutation.mutateAsync({ data, platformIds, id, groupId })
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

  return (
    <div>
      {groups.map(group => (
        <GroupSection
          key={group.id}
          group={group}
          options={(options ?? []).filter(o => o.group_id === group.id)}
          tiers={tiers}
          platforms={platforms}
          editingId={editingId}
          setEditingId={setEditingId}
          saving={saving}
          onSave={handleSave}
          onToggleActive={o => toggleMutation.mutate(o)}
          onDragEnd={handleDragEnd}
          onSwatchUpload={handleSwatchUpload}
        />
      ))}

      {groups.length === 0 && (
        <EmptyState
          title="No option groups"
          description="Option groups are seeded automatically."
        />
      )}
    </div>
  )
}
