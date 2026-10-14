import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { supabase } from '@/lib/supabase'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'
import { Spinner } from '@/components/ui/Spinner'
import { LEAD_STAGES, type LeadStage } from '@/types/database'

const STAGE_LABEL: Record<LeadStage, string> = {
  inquiry: 'Inquiry',
  warm: 'Warm',
  quoting: 'Quoting',
  quoted: 'Quoted',
  revising: 'Revising',
  contract_sent: 'Contract sent',
  won: 'Won',
  lost: 'Lost',
}

export function OpsDashboard() {
  const { selected } = useOpsBuilderSelection()

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', selected?.id],
    enabled: Boolean(selected?.id),
    queryFn: async () => {
      const builderId = selected!.id
      const [leadsRes, quotesRes, buildsRes] = await Promise.all([
        supabase.from('leads').select('stage').eq('builder_id', builderId),
        supabase.from('quotes').select('id, version, price_cents, status, created_at, lead:leads(customer:customers(full_name, email))').eq('builder_id', builderId).eq('status', 'sent').order('sent_at', { ascending: false }).limit(10),
        supabase.from('builds').select('id, stage, price_cents').eq('builder_id', builderId).not('stage', 'in', '(closed)'),
      ])
      if (leadsRes.error) throw leadsRes.error
      if (quotesRes.error) throw quotesRes.error
      if (buildsRes.error) throw buildsRes.error
      const stageCounts = new Map<LeadStage, number>(LEAD_STAGES.map(s => [s, 0]))
      for (const l of leadsRes.data ?? []) stageCounts.set(l.stage as LeadStage, (stageCounts.get(l.stage as LeadStage) ?? 0) + 1)
      return {
        stageCounts,
        awaiting: quotesRes.data ?? [],
        builds: buildsRes.data ?? [],
      }
    },
  })

  if (!selected) {
    return (
      <div className="p-8">
        <p className="text-sm text-[var(--color-muted)]">Pick a builder in the sidebar.</p>
      </div>
    )
  }
  if (isLoading || !data) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-display)' }}>Dashboard</h1>

        <section className="mb-10">
          <h2 className="text-sm font-medium text-[var(--color-muted)] mb-3">Leads by stage</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {LEAD_STAGES.map(stage => (
              <Link
                key={stage}
                to="/ops/leads"
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)] transition"
              >
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{STAGE_LABEL[stage]}</div>
                <div className="text-2xl mt-1" style={{ fontFamily: 'var(--font-display)' }}>
                  {data.stageCounts.get(stage) ?? 0}
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2 mb-10">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="px-5 py-3 border-b border-[var(--color-border)] text-sm font-medium">
              Quotes awaiting reply
            </div>
            {data.awaiting.length === 0 ? (
              <div className="px-5 py-6 text-sm text-[var(--color-muted)]">None.</div>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {data.awaiting.map((q: any) => (
                  <li key={q.id} className="px-5 py-3 flex items-center justify-between">
                    <Link to={`/ops/quotes/${q.id}`} className="text-sm hover:underline">
                      v{q.version} · {q.lead?.customer?.full_name ?? q.lead?.customer?.email ?? '—'}
                    </Link>
                    <span className="text-xs text-[var(--color-muted)]">${(q.price_cents / 100).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="px-5 py-3 border-b border-[var(--color-border)] text-sm font-medium">
              Builds in progress ({data.builds.length})
            </div>
            {data.builds.length === 0 ? (
              <div className="px-5 py-6 text-sm text-[var(--color-muted)]">None.</div>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {data.builds.slice(0, 10).map((b: any) => (
                  <li key={b.id} className="px-5 py-3 flex items-center justify-between">
                    <Link to={`/ops/builds/${b.id}`} className="text-sm hover:underline">
                      {b.id.slice(0, 8)} · {b.stage}
                    </Link>
                    <span className="text-xs text-[var(--color-muted)]">
                      {b.price_cents != null ? `$${(b.price_cents / 100).toLocaleString()}` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
