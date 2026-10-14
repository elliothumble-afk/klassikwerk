import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import type {
  Builder,
  CatalogOption,
  OptionGroup,
  Platform,
} from '@/types/database'

interface Props {
  targetBuilder: Builder
  onClose: () => void
  onCloned: () => void
}

export function PlatformCloneDialog({ targetBuilder, onClose, onCloned }: Props) {
  const [sourceBuilderId, setSourceBuilderId] = useState<string>('')
  const [sourcePlatformId, setSourcePlatformId] = useState<string>('')
  const [newSlug, setNewSlug] = useState<string>('')
  const [cloning, setCloning] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data: otherBuilders } = useQuery({
    queryKey: ['clone', 'builders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('builders').select('*').order('sort')
      if (error) throw error
      return ((data ?? []) as Builder[]).filter(b => b.id !== targetBuilder.id)
    },
  })

  const { data: sourcePlatforms } = useQuery({
    queryKey: ['clone', 'platforms', sourceBuilderId],
    enabled: Boolean(sourceBuilderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_platforms')
        .select('*')
        .eq('builder_id', sourceBuilderId)
        .order('sort')
      if (error) throw error
      return (data ?? []) as Platform[]
    },
  })

  async function performClone() {
    if (!sourcePlatformId) return
    setCloning(true)
    setErr(null)
    try {
      // Load source platform, option groups bound to it (and global groups),
      // and all options under those groups.
      const platformRes = await supabase
        .from('catalog_platforms')
        .select('*')
        .eq('id', sourcePlatformId)
        .single()
      if (platformRes.error) throw platformRes.error
      const srcPlatform = platformRes.data as Platform

      const groupsRes = await supabase
        .from('catalog_option_groups')
        .select('*')
        .eq('builder_id', srcPlatform.builder_id)
      if (groupsRes.error) throw groupsRes.error
      const srcGroups = ((groupsRes.data ?? []) as OptionGroup[]).filter(
        g => g.platform_id === null || g.platform_id === srcPlatform.id
      )

      const optionsRes = await supabase
        .from('catalog_options')
        .select('*')
        .in('group_id', srcGroups.map(g => g.id))
      if (optionsRes.error) throw optionsRes.error
      const srcOptions = (optionsRes.data ?? []) as CatalogOption[]

      // Insert new platform
      const slug = newSlug || `${srcPlatform.slug}-copy`
      const newPlatformIns = await supabase
        .from('catalog_platforms')
        .insert({
          builder_id: targetBuilder.id,
          slug,
          name: srcPlatform.name,
          chassis: srcPlatform.chassis,
          years: srcPlatform.years,
          hero_image_url: srcPlatform.hero_image_url,
          sort: srcPlatform.sort,
          active: srcPlatform.active,
        })
        .select('*')
        .single()
      if (newPlatformIns.error) throw newPlatformIns.error
      const newPlatform = newPlatformIns.data as Platform

      // Insert groups
      const groupIdMap = new Map<string, string>()
      for (const g of srcGroups) {
        const insGrp = await supabase
          .from('catalog_option_groups')
          .insert({
            builder_id: targetBuilder.id,
            platform_id: g.platform_id ? newPlatform.id : null,
            slug: `${g.slug}`,
            name: g.name,
            selection: g.selection,
            required: g.required,
            sort: g.sort,
          })
          .select('*')
          .single()
        if (insGrp.error) throw insGrp.error
        groupIdMap.set(g.id, (insGrp.data as OptionGroup).id)
      }

      // Insert options (included_in_tier_ids are left empty; tier IDs are per-builder)
      for (const o of srcOptions) {
        const newGroupId = groupIdMap.get(o.group_id)
        if (!newGroupId) continue
        const insOpt = await supabase
          .from('catalog_options')
          .insert({
            builder_id: targetBuilder.id,
            group_id: newGroupId,
            slug: o.slug,
            name: o.name,
            code: o.code,
            price_cents: o.price_cents,
            included_in_tier_ids: [],
            swatch_image_url: o.swatch_image_url,
            sort: o.sort,
            active: o.active,
          })
        if (insOpt.error) throw insOpt.error
      }

      onCloned()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setCloning(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-6">
      <div className="bg-[var(--color-surface)] rounded-[var(--radius-lg)] max-w-md w-full p-6 border border-[var(--color-border)]">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-medium">Copy platform</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-[var(--color-muted)] mb-4">
          Clones the platform, its option groups, and their options into
          <strong className="text-[var(--color-foreground)]"> {targetBuilder.name}</strong>.
          Tier includes are reset because tier ids differ per builder.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-[var(--color-muted)] block mb-1">Source builder</label>
            <select
              value={sourceBuilderId}
              onChange={e => { setSourceBuilderId(e.target.value); setSourcePlatformId('') }}
              className="h-9 w-full px-2 border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-background)] text-sm"
            >
              <option value="">Select builder…</option>
              {(otherBuilders ?? []).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-muted)] block mb-1">Platform</label>
            <select
              value={sourcePlatformId}
              onChange={e => setSourcePlatformId(e.target.value)}
              disabled={!sourceBuilderId}
              className="h-9 w-full px-2 border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-background)] text-sm disabled:opacity-50"
            >
              <option value="">Select platform…</option>
              {(sourcePlatforms ?? []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-muted)] block mb-1">New slug (optional)</label>
            <input
              value={newSlug}
              onChange={e => setNewSlug(e.target.value)}
              placeholder="defaults to source slug + -copy"
              className="h-9 w-full px-2 border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-background)] text-sm"
            />
          </div>
          {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="h-8 px-3 text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
            Cancel
          </button>
          <button
            onClick={performClone}
            disabled={!sourcePlatformId || cloning}
            className="h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            {cloning && <Spinner size={13} />}
            Clone
          </button>
        </div>
      </div>
    </div>
  )
}
