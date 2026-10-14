import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { supabase } from '@/lib/supabase'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface BuildRow {
  id: string
  stage: string
  price_cents: number | null
  created_at: string
  platform: { name: string } | null
  tier: { name: string } | null
}

export function BuildsList() {
  const { selected } = useOpsBuilderSelection()

  const { data, isLoading } = useQuery({
    queryKey: ['builds', selected?.id],
    enabled: Boolean(selected?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('builds')
        .select('id, stage, price_cents, created_at, platform:catalog_platforms(name), tier:catalog_tiers(name)')
        .eq('builder_id', selected!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as BuildRow[]
    },
  })

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-display)' }}>Builds</h1>

        {isLoading ? (
          <Spinner size={20} className="text-[var(--color-muted)]" />
        ) : !data || data.length === 0 ? (
          <EmptyState
            title="No builds yet"
            description="Reservations from the public configurator will show up here."
          />
        ) : (
          <div className="bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">ID</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Platform</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Tier</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Stage</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.map(b => (
                  <tr key={b.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-raised)]">
                    <td className="px-5 py-3 font-mono text-xs">
                      <Link to={`/ops/builds/${b.id}`} className="text-[var(--color-accent)] hover:underline">
                        {b.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-5 py-3">{b.platform?.name ?? '—'}</td>
                    <td className="px-5 py-3">{b.tier?.name ?? '—'}</td>
                    <td className="px-5 py-3">{b.stage}</td>
                    <td className="px-5 py-3 text-right">
                      {b.price_cents != null ? `$${(b.price_cents / 100).toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
