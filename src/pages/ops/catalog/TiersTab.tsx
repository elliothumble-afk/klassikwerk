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
import { GripVertical, Plus, Pencil, Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Tier } from '@/types/database'
import { tierSchema, type TierForm } from '@/schemas/catalog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Spinner } from '@/components/ui/Spinner'

const QUERY_KEY = ['catalog', 'tiers']

function useTiers() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_tiers')
        .select('*')
        .order('sort')
      if (error) throw error
      return data as Tier[]
    },
  })
}

function formatPrice(cents: number | null) {
  if (cents == null) return '—'
  return `$${(cents / 100).toLocaleString()}`
}

// Convert TierForm dollars → DB cents payload
function tierFormToDb(data: TierForm) {
  return {
    slug: data.slug,
    name: data.name,
    base_price_cents: data.base_price != null ? Math.round(data.base_price * 100) : null,
    lead_time_weeks: data.lead_time_weeks ?? null,
    description: data.description ?? null,
    quote_only: data.quote_only,
    sort: data.sort,
  }
}

interface RowProps {
  tier: Tier
  onEdit: (t: Tier) => void
}

function TierRow({ tier, onEdit }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tier.id })

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-b border-[var(--color-border)] last:border-0 ${isDragging ? 'opacity-50' : ''}`}
    >
      <td className="py-3 pr-3 pl-5 w-8">
        <button
          {...attributes}
          {...listeners}
          className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical size={15} />
        </button>
      </td>
      <td className="py-3 pr-4 text-sm font-medium">{tier.name}</td>
      <td className="py-3 pr-4 text-sm text-[var(--color-muted)]">
        {tier.quote_only ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-[var(--color-surface-raised)] text-[var(--color-muted)]">
            Quote only
          </span>
        ) : formatPrice(tier.base_price_cents)}
      </td>
      <td className="py-3 pr-4 text-sm text-[var(--color-muted)]">
        {tier.lead_time_weeks ? `${tier.lead_time_weeks} wk` : '—'}
      </td>
      <td className="py-3 pr-5 w-8">
        <button
          onClick={() => onEdit(tier)}
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
  tier?: Tier
  onSave: (data: TierForm, id?: string) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function TierEditForm({ tier, onSave, onCancel, saving }: EditFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<TierForm>({
    resolver: zodResolver(tierSchema),
    defaultValues: tier
      ? {
          slug: tier.slug,
          name: tier.name,
          base_price: tier.base_price_cents != null ? tier.base_price_cents / 100 : undefined,
          lead_time_weeks: tier.lead_time_weeks ?? undefined,
          description: tier.description ?? '',
          quote_only: tier.quote_only,
          sort: tier.sort,
        }
      : { sort: 0, quote_only: false },
  })

  const quoteOnly = watch('quote_only')

  const inputClass = `
    h-9 px-3 w-full rounded-[var(--radius-sm)]
    border border-[var(--color-border)] bg-[var(--color-surface)]
    text-sm text-[var(--color-foreground)]
    focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] focus:border-transparent
    transition disabled:opacity-50
  `

  return (
    <tr className="border-b border-[var(--color-border)] bg-[var(--color-accent-light)]">
      <td colSpan={5} className="py-4 px-4">
        <form onSubmit={handleSubmit(d => onSave(d, tier?.id))} className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Name *</label>
              <input {...register('name')} className={inputClass} placeholder="Klassik" />
              {errors.name && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Slug *</label>
              <input {...register('slug')} className={inputClass} placeholder="klassik" />
              {errors.slug && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.slug.message}</p>}
            </div>
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Base price</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)] pointer-events-none select-none">
                  $
                </span>
                <input
                  {...register('base_price')}
                  type="number"
                  step="0.01"
                  min="0"
                  className={`${inputClass} pl-7`}
                  disabled={quoteOnly}
                  placeholder="70,000"
                />
              </div>
              {errors.base_price && <p className="text-xs text-[var(--color-danger)] mt-1">{errors.base_price.message}</p>}
            </div>
            <div>
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Lead time (weeks)</label>
              <input
                {...register('lead_time_weeks')}
                type="number"
                className={inputClass}
                disabled={quoteOnly}
                placeholder="12"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--color-muted)] mb-1 block">Description</label>
            <textarea
              {...register('description')}
              rows={2}
              className={`${inputClass} h-auto py-2 resize-none`}
              placeholder="Optional tier description"
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input {...register('quote_only')} type="checkbox" className="rounded" />
              Quote only
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

export function TiersTab() {
  const qc = useQueryClient()
  const { data: tiers, isLoading, error, refetch } = useTiers()
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor))

  const saveMutation = useMutation({
    mutationFn: async ({ data, id }: { data: TierForm; id?: string }) => {
      const payload = tierFormToDb(data)
      if (id) {
        const { error } = await supabase.from('catalog_tiers').update(payload).eq('id', id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('catalog_tiers').insert(payload)
        if (error) throw error
      }
    },
    onMutate: async ({ data, id }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData<Tier[]>(QUERY_KEY)
      const payload = tierFormToDb(data)
      qc.setQueryData<Tier[]>(QUERY_KEY, old => {
        if (!old) return old
        if (id) return old.map(t => t.id === id ? { ...t, ...payload } : t)
        return [...old, { ...payload, id: crypto.randomUUID(), created_at: '', updated_at: '' }]
      })
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || !tiers) return

    const oldIndex = tiers.findIndex(t => t.id === active.id)
    const newIndex = tiers.findIndex(t => t.id === over.id)
    const reordered = arrayMove(tiers, oldIndex, newIndex)

    qc.setQueryData<Tier[]>(QUERY_KEY, reordered)
    await Promise.all(
      reordered.map((t, i) =>
        supabase.from('catalog_tiers').update({ sort: i + 1 }).eq('id', t.id)
      )
    )
    qc.invalidateQueries({ queryKey: QUERY_KEY })
  }

  async function handleSave(data: TierForm, id?: string) {
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

  if (error) return <ErrorState message={(error as Error).message} retry={refetch} />

  return (
    <div className="bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
        <h2 className="text-sm font-medium">Tiers ({tiers?.length ?? 0})</h2>
        <button
          onClick={() => setEditingId('new')}
          className="flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:bg-[var(--color-accent-hover)] transition"
        >
          <Plus size={14} /> Add tier
        </button>
      </div>

      {(!tiers || tiers.length === 0) && editingId !== 'new' ? (
        <EmptyState
          title="No tiers yet"
          description="Add your first service tier."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-2.5 pr-3 pl-5 w-8" />
                <th className="text-left py-2.5 pr-4 text-xs font-medium text-[var(--color-muted)]">Name</th>
                <th className="text-left py-2.5 pr-4 text-xs font-medium text-[var(--color-muted)]">Price</th>
                <th className="text-left py-2.5 pr-4 text-xs font-medium text-[var(--color-muted)]">Lead time</th>
                <th className="text-left py-2.5 pr-5 w-8" />
              </tr>
            </thead>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={tiers?.map(t => t.id) ?? []} strategy={verticalListSortingStrategy}>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {tiers?.map(tier =>
                    editingId === tier.id ? (
                      <TierEditForm
                        key={tier.id}
                        tier={tier}
                        onSave={handleSave}
                        onCancel={() => setEditingId(null)}
                        saving={saving}
                      />
                    ) : (
                      <TierRow key={tier.id} tier={tier} onEdit={t => setEditingId(t.id)} />
                    )
                  )}
                  {editingId === 'new' && (
                    <TierEditForm
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
