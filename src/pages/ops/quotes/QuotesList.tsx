import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Quote {
  id: string
  lead_id: string
  version: number
  price_cents: number
  status: 'draft' | 'sent' | 'approved' | 'superseded'
  created_at: string
  sent_at: string | null
  platform_id: string
  lead: { id: string; customer_id: string | null; customer: { id: string; full_name: string | null; email: string | null } | null } | null
  platform: { name: string } | null
  quote_options: QoRow[]
}

// quote_options rows the diff cares about — option id + name for
// the one-line change summary. Price snapshot is read from the
// containing quote's price_cents for the total-delta.
interface QoRow {
  option_id: string
  catalog_options: { name: string } | null
}

interface Group {
  key: string
  top: Quote
  earlier: Quote[]  // sorted newest-first, excludes top
  all: Quote[]      // sorted newest-first, includes top
}

export function QuotesList() {
  const { selected } = useOpsBuilderSelection()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['quotes', selected?.id],
    enabled: Boolean(selected?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotes')
        .select(`
          id, lead_id, version, price_cents, status, created_at, sent_at, platform_id,
          lead:leads(id, customer_id, customer:customers(id, full_name, email)),
          platform:catalog_platforms(name),
          quote_options(option_id, catalog_options(name))
        `)
        .eq('builder_id', selected!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Quote[]
    },
  })

  // Group by (customer_id, platform_id). Top-level = newest non-
  // superseded version; a group whose newest version is superseded
  // (shouldn't happen in practice) is hidden.
  const groups: Group[] = useMemo(() => {
    if (!data) return []
    const map = new Map<string, Quote[]>()
    for (const q of data) {
      const cid = q.lead?.customer_id ?? q.lead?.customer?.id ?? 'no-customer'
      const key = `${cid}|${q.platform_id}`
      const arr = map.get(key) ?? []
      arr.push(q)
      map.set(key, arr)
    }
    const groups: Group[] = []
    for (const [key, arr] of map) {
      const sorted = arr.slice().sort((a, b) => b.version - a.version)
      const top = sorted.find(q => q.status !== 'superseded')
      if (!top) continue  // never surface a group whose latest is superseded
      const earlier = sorted.filter(q => q.id !== top.id)
      groups.push({ key, top, earlier, all: sorted })
    }
    // Newest top first.
    groups.sort((a, b) => new Date(b.top.created_at).getTime() - new Date(a.top.created_at).getTime())
    return groups
  }, [data])

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-display)' }}>Quotes</h1>
        {isLoading ? (
          <Spinner size={20} className="text-[var(--color-muted)]" />
        ) : groups.length === 0 ? (
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
                {groups.map(g => {
                  const isOpen = expanded.has(g.key)
                  const customerName = g.top.lead?.customer?.full_name ?? g.top.lead?.customer?.email ?? '—'
                  return (
                    <>
                      <tr key={g.key} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-raised)]">
                        <td className="px-5 py-3">
                          <Link to={`/ops/quotes/${g.top.id}`} className="text-[var(--color-accent)] hover:underline">
                            {customerName}
                          </Link>
                        </td>
                        <td className="px-5 py-3">{g.top.platform?.name ?? '—'}</td>
                        <td className="px-5 py-3">
                          v{g.top.version}
                          {g.earlier.length > 0 && (
                            <button
                              onClick={() => toggle(g.key)}
                              className="ml-2 inline-flex items-center gap-0.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                              aria-expanded={isOpen}
                            >
                              <ChevronRight
                                size={11}
                                className="transition-transform"
                                style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0)' }}
                              />
                              {g.earlier.length} earlier
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-3"><StatusBadge status={g.top.status} /></td>
                        <td className="px-5 py-3 text-right">${(g.top.price_cents / 100).toLocaleString()}</td>
                      </tr>
                      {isOpen && g.all.map((q, i) => (
                        i === 0 ? null : (
                          <tr key={q.id} className="border-b border-[var(--color-border)] last:border-0 bg-[var(--color-surface-raised)]/40">
                            <td className="px-5 py-2" />
                            <td className="px-5 py-2 text-xs text-[var(--color-muted)]">
                              {summariseDiff(q, g.all[i - 1])}
                            </td>
                            <td className="px-5 py-2">
                              <Link to={`/ops/quotes/${q.id}`} className="text-[var(--color-accent)] hover:underline text-xs">
                                v{q.version}
                              </Link>
                            </td>
                            <td className="px-5 py-2"><StatusBadge status={q.status} /></td>
                            <td className="px-5 py-2 text-right text-xs text-[var(--color-muted)]">
                              ${(q.price_cents / 100).toLocaleString()}
                              <div className="text-[10px]">{new Date(q.created_at).toLocaleDateString()}</div>
                            </td>
                          </tr>
                        )
                      ))}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: Quote['status'] }) {
  const bg =
    status === 'draft' ? '#E6E1D4' :
    status === 'sent' ? '#D7E4D9' :
    status === 'approved' ? '#B5CBB2' :
    '#CFC9BC'  // superseded
  return (
    <span className="inline-block px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded" style={{ backgroundColor: bg }}>
      {status}
    </span>
  )
}

// One-line diff between an earlier version `prev` and the newer
// version `newer` that superseded it. Reads: "+2 · −1 · +$3,500 vs v3"
// (added / removed / total delta). Zero-delta parts are dropped.
function summariseDiff(prev: Quote, newer: Quote): string {
  const prevIds = new Set(prev.quote_options.map(o => o.option_id))
  const newerIds = new Set(newer.quote_options.map(o => o.option_id))
  const added = [...newerIds].filter(id => !prevIds.has(id)).length
  const removed = [...prevIds].filter(id => !newerIds.has(id)).length
  const delta = newer.price_cents - prev.price_cents
  const parts: string[] = []
  if (added > 0) parts.push(`+${added}`)
  if (removed > 0) parts.push(`−${removed}`)
  if (delta !== 0) {
    const sign = delta > 0 ? '+' : '−'
    parts.push(`${sign}$${Math.abs(delta / 100).toLocaleString()}`)
  }
  if (parts.length === 0) return `No line changes vs v${newer.version}`
  return `${parts.join(' · ')} vs v${newer.version}`
}
