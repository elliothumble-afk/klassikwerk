import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { supabase } from '@/lib/supabase'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Row {
  id: string
  version: number
  price_cents: number
  status: string
  created_at: string
  sent_at: string | null
  lead: { id: string; customer: { full_name: string | null; email: string | null } | null } | null
  platform: { name: string } | null
}

export function QuotesList() {
  const { selected } = useOpsBuilderSelection()
  const { data, isLoading } = useQuery({
    queryKey: ['quotes', selected?.id],
    enabled: Boolean(selected?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotes')
        .select(`
          id, version, price_cents, status, created_at, sent_at,
          lead:leads(id, customer:customers(full_name, email)),
          platform:catalog_platforms(name)
        `)
        .eq('builder_id', selected!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Row[]
    },
  })

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-display)' }}>Quotes</h1>
        {isLoading ? (
          <Spinner size={20} className="text-[var(--color-muted)]" />
        ) : !data || data.length === 0 ? (
          <EmptyState title="No quotes yet" description="Start one from a lead." />
        ) : (
          <div className="bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Customer</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Platform</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Version</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.map(q => (
                  <tr key={q.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-raised)]">
                    <td className="px-5 py-3">
                      <Link to={`/ops/quotes/${q.id}`} className="text-[var(--color-accent)] hover:underline">
                        {q.lead?.customer?.full_name ?? q.lead?.customer?.email ?? '—'}
                      </Link>
                    </td>
                    <td className="px-5 py-3">{q.platform?.name ?? '—'}</td>
                    <td className="px-5 py-3">v{q.version}</td>
                    <td className="px-5 py-3">{q.status}</td>
                    <td className="px-5 py-3 text-right">${(q.price_cents / 100).toLocaleString()}</td>
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
