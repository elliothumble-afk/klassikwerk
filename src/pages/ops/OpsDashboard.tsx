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

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

/** First day of the current calendar month in UTC — used as the lower
 *  bound on approved_at when computing month-to-date totals. */
function monthStartIso(): string {
  const d = new Date()
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  return start.toISOString()
}

function monthLabel(): string {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

export function OpsDashboard() {
  const { selected } = useOpsBuilderSelection()

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', selected?.id],
    enabled: Boolean(selected?.id),
    queryFn: async () => {
      const builderId = selected!.id
      const monthIso = monthStartIso()
      const [leadsRes, quotesRes, buildsRes, approvedThisMonthRes] = await Promise.all([
        supabase.from('leads').select('stage').eq('builder_id', builderId),
        supabase.from('quotes').select('id, version, price_cents, status, created_at, lead:leads(customer:customers(full_name, email))').eq('builder_id', builderId).eq('status', 'sent').order('sent_at', { ascending: false }).limit(10),
        supabase.from('builds').select('id, stage, price_cents').eq('builder_id', builderId).not('stage', 'in', '(closed)'),
        // Approved quotes this month, with the snapshot columns needed
        // to compute HH gross margin per quote + the rep from the
        // most-recent "sent" event (fallback: "created"). The snapshot
        // keeps month-end totals honest even if terms change later.
        supabase.from('quotes').select(`
          id, price_cents, commission_cents, approved_at, builder_id,
          quote_options(landed_cost_cents, partner_cost_cents, materials_cents),
          quote_events(kind, by_profile_id, created_at)
        `)
          .eq('builder_id', builderId)
          .eq('status', 'approved')
          .gte('approved_at', monthIso),
      ])
      if (leadsRes.error) throw leadsRes.error
      if (quotesRes.error) throw quotesRes.error
      if (buildsRes.error) throw buildsRes.error
      if (approvedThisMonthRes.error) throw approvedThisMonthRes.error
      const stageCounts = new Map<LeadStage, number>(LEAD_STAGES.map(s => [s, 0]))
      for (const l of leadsRes.data ?? []) stageCounts.set(l.stage as LeadStage, (stageCounts.get(l.stage as LeadStage) ?? 0) + 1)

      // HH gross margin & commission totals from approved quotes.
      // Commission uses the snapshot column on the quote (never
      // recomputed from today's terms); gross margin trusts the
      // quote_options cost snapshots. Rep is the by_profile_id of the
      // latest "sent" event, falling back to "created".
      type QRow = {
        id: string
        price_cents: number
        commission_cents: number | null
        quote_options: { landed_cost_cents: number | null; partner_cost_cents: number | null; materials_cents: number | null }[]
        quote_events: { kind: string; by_profile_id: string | null; created_at: string }[]
      }
      const approvedRows = (approvedThisMonthRes.data as unknown as QRow[]) ?? []

      let totalGross = 0
      let totalCommission = 0
      const perRep = new Map<string | null, { commission: number; quotes: number }>()
      for (const q of approvedRows) {
        const sale = q.price_cents ?? 0
        const landed    = q.quote_options.reduce((a, r) => a + (r.landed_cost_cents    ?? 0), 0)
        const partner   = q.quote_options.reduce((a, r) => a + (r.partner_cost_cents   ?? 0), 0)
        const materials = q.quote_options.reduce((a, r) => a + (r.materials_cents      ?? 0), 0)
        const commission = q.commission_cents ?? 0
        const gross = sale - landed - partner - materials - commission
        totalGross += gross
        totalCommission += commission
        // Pick the rep: most recent 'sent' with a by_profile_id, else 'created'.
        const events = q.quote_events.slice().sort((a, b) =>
          b.created_at.localeCompare(a.created_at))
        const rep = events.find(e => e.kind === 'sent' && e.by_profile_id)?.by_profile_id
          ?? events.find(e => e.kind === 'created' && e.by_profile_id)?.by_profile_id
          ?? null
        const bucket = perRep.get(rep) ?? { commission: 0, quotes: 0 }
        bucket.commission += commission
        bucket.quotes += 1
        perRep.set(rep, bucket)
      }

      // Resolve rep profile_ids to display names.
      const repIds = Array.from(perRep.keys()).filter((v): v is string => !!v)
      let nameById = new Map<string, string>()
      if (repIds.length > 0) {
        const profRes = await supabase.from('profiles')
          .select('id, full_name').in('id', repIds)
        if (profRes.error) throw profRes.error
        for (const p of (profRes.data ?? []) as { id: string; full_name: string | null }[]) {
          nameById.set(p.id, p.full_name ?? '—')
        }
      }
      const commissionRows = Array.from(perRep.entries())
        .map(([id, b]) => ({
          repId: id,
          repName: id ? (nameById.get(id) ?? '—') : 'Unassigned',
          commission: b.commission,
          quotes: b.quotes,
        }))
        .sort((a, b) => b.commission - a.commission)

      return {
        stageCounts,
        awaiting: quotesRes.data ?? [],
        builds: buildsRes.data ?? [],
        totalGross,
        totalCommission,
        approvedCount: approvedRows.length,
        commissionRows,
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

        <section className="mb-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              HH gross margin · {monthLabel()}
            </div>
            <div className="text-2xl mt-1" style={{ fontFamily: 'var(--font-display)' }}>
              {money(data.totalGross)}
              <span className="text-xs text-[var(--color-muted)] ml-2">
                · {data.approvedCount} approved quote{data.approvedCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Commission owed · {monthLabel()}
            </div>
            {data.commissionRows.length === 0 ? (
              <div className="text-sm text-[var(--color-muted)] mt-2">No approved quotes this month.</div>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-border)]">
                {data.commissionRows.map(r => (
                  <li key={r.repId ?? 'unassigned'} className="py-1.5 flex items-center justify-between text-sm">
                    <span>
                      {r.repName}
                      <span className="text-xs text-[var(--color-muted)] ml-2">
                        · {r.quotes} quote{r.quotes === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="font-mono">{money(r.commission)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="text-xs text-[var(--color-muted)] mt-2 pt-2 border-t border-[var(--color-border)] flex justify-between">
              <span>Total</span>
              <span className="font-mono">{money(data.totalCommission)}</span>
            </div>
          </div>
        </section>

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
