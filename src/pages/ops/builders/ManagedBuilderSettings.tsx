import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import { BrandEdit } from './BrandEdit'
import { WebhookPanel } from './TermsEdit'
import { ScheduledJobsPanel } from './ScheduledJobsPanel'
import type { Builder } from '@/types/database'

// Settings page for externally-managed builders (ECD). Collapses the
// pieces HH needs to keep working into one scroll: brand on top,
// webhook + scheduled jobs underneath, platform aliases at the end
// so the webhook's platform_name resolver has somewhere to look.
export function ManagedBuilderSettings() {
  const { id } = useParams<{ id: string }>()
  const { data: builder } = useQuery({
    queryKey: ['builder', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await supabase.from('builders').select('*').eq('id', id!).single()
      return data as Builder
    },
  })

  if (!id || !builder) return <div className="p-8"><Spinner size={16} /></div>

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl" style={{ fontFamily: 'var(--font-display)' }}>Settings</h1>
          <p className="text-sm text-[var(--color-muted)] mt-1">
            {builder.name} is managed externally. The quote lifecycle lives in the source system;
            HH mirrors events and exposes only the mapping surfaces here.
          </p>
        </header>

        {/* Brand editor — reuses the same component as HH-managed builders.
            BrandEdit reads its id from useParams so we don't need to pipe
            anything in. */}
        <BrandEdit />

        {/* Webhook (secret, backfill URL, pull) + scheduled jobs. */}
        <WebhookPanel builderId={id} />
        <ScheduledJobsPanel builder={builder} />

        {/* Platforms with aliases — needed for the webhook's
            platform_name resolver. */}
        <PlatformsAliasPanel builderId={id} />
      </div>
    </div>
  )
}

interface PlatformRow {
  id: string
  name: string
  chassis: string
  years: string
  active: boolean
  aliases: string[]
}

function PlatformsAliasPanel({ builderId }: { builderId: string }) {
  const qc = useQueryClient()
  const { data: rows, isLoading } = useQuery({
    queryKey: ['managed-platforms', builderId],
    queryFn: async () => {
      const { data } = await supabase.from('catalog_platforms')
        .select('id, name, chassis, years, active, aliases')
        .eq('builder_id', builderId)
        .order('sort').order('name')
      return (data ?? []) as PlatformRow[]
    },
  })
  const [draft, setDraft] = useState<Record<string, string>>({})

  const updateAliases = useMutation({
    mutationFn: async ({ id, aliases }: { id: string; aliases: string[] }) => {
      const { error } = await supabase.from('catalog_platforms')
        .update({ aliases } as never).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['managed-platforms', builderId] }),
  })

  function addAlias(row: PlatformRow) {
    const s = (draft[row.id] ?? '').trim()
    if (!s) return
    const next = Array.from(new Set([...(row.aliases ?? []), s]))
    updateAliases.mutate({ id: row.id, aliases: next })
    setDraft(prev => ({ ...prev, [row.id]: '' }))
  }
  function removeAlias(row: PlatformRow, alias: string) {
    const next = (row.aliases ?? []).filter(a => a !== alias)
    updateAliases.mutate({ id: row.id, aliases: next })
  }

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-sm font-medium mb-3">Platforms &amp; aliases</h2>
      <p className="text-xs text-[var(--color-muted)] mb-4">
        The webhook's <code>platform_name</code> is matched case-insensitive
        against the platform name or any alias. Add the names the source system sends.
      </p>
      {isLoading ? <Spinner size={14} /> : (rows ?? []).length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">No platforms configured yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th className="text-left py-1.5">Platform</th>
              <th className="text-left py-1.5">Aliases</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map(r => (
              <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-2 align-top">
                  <div>{r.name}</div>
                  <div className="text-xs text-[var(--color-muted)]">{r.years}</div>
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(r.aliases ?? []).map(a => (
                      <span key={a} className="inline-flex items-center gap-1 text-xs bg-black/5 rounded px-2 py-0.5">
                        {a}
                        <button onClick={() => removeAlias(r, a)} aria-label={`Remove alias ${a}`}>
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                    <input
                      value={draft[r.id] ?? ''}
                      onChange={e => setDraft(prev => ({ ...prev, [r.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') addAlias(r) }}
                      placeholder="Add alias"
                      className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 w-32"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
