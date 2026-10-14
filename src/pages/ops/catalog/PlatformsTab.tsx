import { useState } from 'react'
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
import { GripVertical, Plus, Pencil, Check, X, ToggleLeft, ToggleRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Platform } from '@/types/database'
import { platformSchema, type PlatformForm } from '@/schemas/catalog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Spinner } from '@/components/ui/Spinner'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'
import { PlatformCloneDialog } from './PlatformCloneDialog'

function platformsQueryKey(builderId: string | undefined) {
  return ['catalog', 'platforms', builderId ?? 'none']
}

function usePlatforms(builderId: string | undefined) {
  return useQuery({
    queryKey: platformsQueryKey(builderId),
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

interface RowProps {
  platform: Platform
  onEdit: (p: Platform) => void
  onToggleActive: (p: Platform) => void
}

function PlatformRow({ platform, onEdit, onToggleActive }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: platform.id })

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-b border-[var(--color-border)] last:border-0 ${isDragging ? 'opacity-50' : ''}`}
    >
      <td className="py-3 pr-3 w-8">
        <button
          {...attributes}
          {...listeners}
          className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical size={15} />
        </button>
      </td>
      <td className="py-3 pr-4 text-sm font-medium">{platform.name}</td>
      <td className="py-3 pr-4 text-sm text-[var(--color-muted)]">{platform.chassis}</td>
      <td className="py-3 pr-4 text-sm text-[var(--color-muted)]">{platform.years}</td>
      <td className="py-3 pr-4">
        <button
          onClick={() => onToggleActive(platform)}
          className={`flex items-center gap-1.5 text-xs transition ${
            platform.active ? 'text-[var(--color-success)]' : 'text-[var(--color-muted)]'
          }`}
          title={platform.active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
        >
          {platform.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          {platform.active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td className="py-3 w-8">
        <button
          onClick={() => onEdit(platform)}
          className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition"
          aria-label="Edit"
        >
          <Pencil size={14} />
        </button>
      </td>
    </tr>
  )
}

interface EditFormProps {
  platform?: Platform
  onSave: (data: PlatformForm, id?: string) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function PlatformForm({ platform, onSave, onCancel, saving }: EditFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PlatformForm>({
    resolver: zodResolver(platformSchema),
    defaultValues: platform
      ? {
          slug: platform.slug,
          name: platform.name,
          chassis: platform.chassis,
          years: platform.years,
          hero_image_url: platform.hero_image_url ?? '',
          sort: platform.sort,
          active: platform.active,
        }
      : { sort: 0, active: true },
  })

  const inputClass = `
    h-9 px-3 w-full rounded-[var(--radius-sm)]
    border border-[var(--color-border)] bg-[var(--color-surface)]
    text-sm text-[var(--color-foreground)]
    focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] focus:border-transparent
    transition
  `

  return (
    <tr className="border-b border-[var(--color-border)] bg-[var(--color-accent-light)]">
      <td colSpan={6} className="py-4 px-4">
        <form onSubmit={handleSubmit(d => onSave(d, platform?.id))} className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Name *</label>
              <input {...register('name')} className={inputClass} placeholder="Platform name" />
              {errors.name && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Slug *</label>
              <input {...register('slug')} className={inputClass} placeholder="platform-slug" />
              {errors.slug && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.slug.message}</p>}
            </div>
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Chassis *</label>
              <input {...register('chassis')} className={inputClass} placeholder="Chassis code" />
              {errors.chassis && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.chassis.message}</p>}
            </div>
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Years *</label>
              <input {...register('years')} className={inputClass} placeholder="1999–2006" />
              {errors.years && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.years.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Hero image URL</label>
              <input {...register('hero_image_url')} className={inputClass} placeholder="https://…" />
              {errors.hero_image_url && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.hero_image_url.message}</p>}
            </div>
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Sort order</label>
              <input {...register('sort')} type="number" className={inputClass} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input {...register('active')} type="checkbox" className="rounded" />
              Active
            </label>
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

export function PlatformsTab() {
  const qc = useQueryClient()
  const { selected } = useOpsBuilderSelection()
  const QUERY_KEY = platformsQueryKey(selected?.id)
  const { data: platforms, isLoading, error, refetch } = usePlatforms(selected?.id)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const [showClone, setShowClone] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor))

  const saveMutation = useMutation({
    mutationFn: async ({ data, id }: { data: PlatformForm; id?: string }) => {
      if (!selected) throw new Error('No builder selected')
      if (id) {
        const { error } = await supabase.from('catalog_platforms').update(data).eq('id', id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('catalog_platforms').insert({ ...data, builder_id: selected.id })
        if (error) throw error
      }
    },
    onMutate: async ({ data, id }) => {
      if (!selected) return { prev: undefined }
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData<Platform[]>(QUERY_KEY)
      if (prev) {
        qc.setQueryData<Platform[]>(QUERY_KEY, old => {
          if (!old) return old
          if (id) return old.map(p => p.id === id ? { ...p, ...data } : p)
          return [...old, { ...data, builder_id: selected.id, id: crypto.randomUUID(), created_at: '', updated_at: '' }]
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async (platform: Platform) => {
      const { error } = await supabase
        .from('catalog_platforms')
        .update({ active: !platform.active })
        .eq('id', platform.id)
      if (error) throw error
    },
    onMutate: async (platform) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData<Platform[]>(QUERY_KEY)
      qc.setQueryData<Platform[]>(QUERY_KEY, old =>
        old?.map(p => p.id === platform.id ? { ...p, active: !p.active } : p)
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || !platforms) return

    const oldIndex = platforms.findIndex(p => p.id === active.id)
    const newIndex = platforms.findIndex(p => p.id === over.id)
    const reordered = arrayMove(platforms, oldIndex, newIndex)

    qc.setQueryData<Platform[]>(QUERY_KEY, reordered)

    await Promise.all(
      reordered.map((p, i) =>
        supabase.from('catalog_platforms').update({ sort: i + 1 }).eq('id', p.id)
      )
    )
    qc.invalidateQueries({ queryKey: QUERY_KEY })
  }

  async function handleSave(data: PlatformForm, id?: string) {
    setSaving(true)
    await saveMutation.mutateAsync({ data, id })
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

  if (error) {
    return <ErrorState message={(error as Error).message} retry={refetch} />
  }

  return (
    <div className="bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
        <h2 className="text-sm font-medium">Platforms ({platforms?.length ?? 0})</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowClone(true)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm hover:bg-[var(--color-surface-raised)] transition"
          >
            Copy from builder…
          </button>
          <button
            onClick={() => setEditingId('new')}
            className="flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:bg-[var(--color-accent-hover)] transition"
          >
            <Plus size={14} /> Add platform
          </button>
        </div>
      </div>
      {showClone && selected && (
        <PlatformCloneDialog
          targetBuilder={selected}
          onClose={() => setShowClone(false)}
          onCloned={() => {
            setShowClone(false)
            qc.invalidateQueries({ queryKey: QUERY_KEY })
          }}
        />
      )}

      {(!platforms || platforms.length === 0) && editingId !== 'new' ? (
        <EmptyState
          title="No platforms yet"
          description="Add your first restoration platform."
          action={
            <button
              onClick={() => setEditingId('new')}
              className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] underline underline-offset-2"
            >
              Add platform
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-2.5 pr-3 pl-5 w-8" />
                <th className="text-left py-2.5 pr-4 text-xs font-medium text-[var(--color-muted)]">Name</th>
                <th className="text-left py-2.5 pr-4 text-xs font-medium text-[var(--color-muted)]">Chassis</th>
                <th className="text-left py-2.5 pr-4 text-xs font-medium text-[var(--color-muted)]">Years</th>
                <th className="text-left py-2.5 pr-4 text-xs font-medium text-[var(--color-muted)]">Status</th>
                <th className="text-left py-2.5 pr-5 w-8" />
              </tr>
            </thead>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={platforms?.map(p => p.id) ?? []}
                strategy={verticalListSortingStrategy}
              >
                <tbody className="divide-y divide-[var(--color-border)]">
                  {platforms?.map(platform =>
                    editingId === platform.id ? (
                      <PlatformForm
                        key={platform.id}
                        platform={platform}
                        onSave={handleSave}
                        onCancel={() => setEditingId(null)}
                        saving={saving}
                      />
                    ) : (
                      <PlatformRow
                        key={platform.id}
                        platform={platform}
                        onEdit={p => setEditingId(p.id)}
                        onToggleActive={p => toggleMutation.mutate(p)}
                      />
                    )
                  )}
                  {editingId === 'new' && (
                    <PlatformForm
                      onSave={handleSave}
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
