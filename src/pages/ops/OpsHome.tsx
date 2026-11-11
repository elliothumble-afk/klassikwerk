// Home page — the cross-builder landing at /ops. Sits above the
// builder selector in the sidebar. Four panels per the Phase 9 brief:
//
//   • My work          — leads waiting on quote, quotes sent & unanswered,
//                        builds in progress (scoped to the signed-in user
//                        unless the viewer is an admin, who sees the team).
//   • Pipeline         — one row per builder for the current month.
//   • My commissions   — unpaid + paid YTD; link to /ops/me.
//   • Recent activity  — last 20 events across builders.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Settings } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'
import { Spinner } from '@/components/ui/Spinner'
import {
  commissionForQuote, sumCommissions,
  type CommissionStatus,
} from '@/lib/commissionDisplay'

type HomeSection = 'my_work' | 'pipeline' | 'commissions' | 'activity'
const SECTION_LABELS: Record<HomeSection, string> = {
  my_work: 'My work',
  pipeline: 'Pipeline',
  commissions: 'Commissions',
  activity: 'Recent activity',
}
const ALL_SECTIONS: HomeSection[] = ['my_work', 'pipeline', 'commissions', 'activity']

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function monthStartIso(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

function yearStartIso(): string {
  return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString()
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = (Date.now() - new Date(iso).getTime()) / 86400000
  return Math.floor(d)
}

interface Builder { id: string; name: string; slug: string; active: boolean }

export function OpsHome() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'operator'
  const profileId = profile?.id ?? null
  const { setSelectedId } = useOpsBuilderSelection()
  const [customising, setCustomising] = useState(false)

  // Per-user section visibility: profiles.home_prefs. Missing keys
  // default to shown.
  const { data: prefs } = useQuery({
    queryKey: ['home-prefs', profileId],
    enabled: Boolean(profileId),
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('home_prefs').eq('id', profileId!).single()
      return (data?.home_prefs ?? {}) as Partial<Record<HomeSection, boolean>>
    },
  })
  const visible = (s: HomeSection) => prefs?.[s] !== false
  const savePrefs = useMutation({
    mutationFn: async (next: Partial<Record<HomeSection, boolean>>) => {
      const { error } = await supabase.from('profiles').update({ home_prefs: next }).eq('id', profileId!)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['home-prefs', profileId] }),
  })
  const toggle = (s: HomeSection) => {
    const next = { ...(prefs ?? {}) }
    next[s] = visible(s) ? false : true
    savePrefs.mutate(next)
  }

  // Jump into a builder's context when the user follows an in-row link.
  // Writing selected id before the navigation triggers useOpsBuilderSelection
  // to pin the sidebar to the right builder.
  const openInBuilder = (builderId: string) => () => setSelectedId(builderId)

  // ─── Builders (for pipeline + joins) ───────────────────────────────
  const { data: builders } = useQuery({
    queryKey: ['home-builders'],
    queryFn: async () => {
      const { data } = await supabase.from('builders')
        .select('id, name, slug, active').eq('active', true).order('name')
      return (data ?? []) as Builder[]
    },
  })
  const builderById = useMemo(() => {
    const m = new Map<string, Builder>()
    for (const b of builders ?? []) m.set(b.id, b)
    return m
  }, [builders])

  // ─── My work ───────────────────────────────────────────────────────
  // Admins see the whole team; reps see their own. "My" means:
  //   • leads where owner_profile_id = me  OR unassigned
  //   • quotes where sales_rep_profile_id = me  OR unassigned
  //   • builds (not scoped per-user today) — same for everyone
  const { data: myWork, isLoading: loadingMine } = useQuery({
    queryKey: ['home-my-work', profileId, isAdmin],
    enabled: Boolean(profileId),
    queryFn: async () => {
      const leadsQ = supabase.from('leads')
        .select('id, builder_id, stage, updated_at, customer:customers(full_name, email)')
        .in('stage', ['warm', 'quoting', 'revising'])
        .order('updated_at', { ascending: false })
        .limit(8)
      if (!isAdmin && profileId) leadsQ.or(`owner_profile_id.eq.${profileId},owner_profile_id.is.null`)
      const quotesQ = supabase.from('quotes')
        .select('id, builder_id, version, price_cents, commission_cents, sent_at, status, external_id, source, lead:leads(customer:customers(full_name, email))')
        .eq('status', 'sent')
        .order('sent_at', { ascending: false, nullsFirst: false })
        .limit(8)
      if (!isAdmin && profileId) quotesQ.or(`sales_rep_profile_id.eq.${profileId},sales_rep_profile_id.is.null`)
      const buildsQ = supabase.from('builds')
        .select('id, builder_id, stage, price_cents, customer:customers(full_name)')
        .neq('stage', 'closed')
        .order('updated_at', { ascending: false })
        .limit(8)
      const [l, q, b] = await Promise.all([leadsQ, quotesQ, buildsQ])
      return {
        leads: (l.data ?? []) as unknown as Array<{ id: string; builder_id: string; stage: string; updated_at: string; customer: { full_name: string | null; email: string | null } | null }>,
        quotes: (q.data ?? []) as unknown as Array<{ id: string; builder_id: string; version: number; price_cents: number; commission_cents: number | null; sent_at: string | null; status: string; external_id: string | null; source: 'native' | 'builder'; lead: { customer: { full_name: string | null; email: string | null } | null } | null }>,
        builds: (b.data ?? []) as unknown as Array<{ id: string; builder_id: string; stage: string; price_cents: number; customer: { full_name: string | null } | null }>,
      }
    },
  })

  // Commissions for the "awaiting reply" quotes — non-void rows win,
  // native quotes fall back to quote.commission_cents snapshot.
  const awaitingQuoteIds = useMemo(() => (myWork?.quotes ?? []).map(q => q.id), [myWork?.quotes])
  const { data: awaitingCommissions } = useQuery({
    queryKey: ['home-awaiting-comm', awaitingQuoteIds.join(',')],
    enabled: awaitingQuoteIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('commissions')
        .select('quote_id, amount_cents, status').in('quote_id', awaitingQuoteIds)
      return (data ?? []) as Array<{ quote_id: string | null; amount_cents: number; status: CommissionStatus }>
    },
  })
  const awaitingCommissionTotal = useMemo(
    () => sumCommissions(myWork?.quotes ?? [], awaitingCommissions),
    [myWork?.quotes, awaitingCommissions],
  )

  // ─── Pipeline this month ───────────────────────────────────────────
  // One row per active builder: quotes sent / approved / approved-$,
  // contracts (deals signed), payments received. Includes Connect
  // quotes — no source filter.
  const { data: pipeline } = useQuery({
    queryKey: ['home-pipeline', builders?.length],
    enabled: Boolean(builders?.length),
    queryFn: async () => {
      const month = monthStartIso()
      // Quotes sent + approved this month per builder. We need `id` +
      // `source` + `commission_cents` so we can resolve the per-quote
      // commission against the commissions table below.
      const quotesRes = await supabase.from('quotes')
        .select('id, builder_id, source, status, price_cents, total_cents, commission_cents, sent_at, approved_at')
        .or(`sent_at.gte.${month},approved_at.gte.${month}`)
      // Contracts signed this month.
      const contractsRes = await supabase.from('contracts')
        .select('builder_id, status, signed_at').gte('signed_at', month)
      // Payments received this month.
      const paymentsRes = await supabase.from('quote_payments')
        .select('amount_cents, received_at, quote:quotes(builder_id)').gte('received_at', month)
      // Commissions tied to any in-month quote. We re-use commission
      // display rules: non-void row wins per quote; native quotes with
      // no row fall back to quote.commission_cents.
      type PipelineQuote = { id: string; builder_id: string; source: 'native' | 'builder'; status: string; price_cents: number; total_cents: number | null; commission_cents: number | null; sent_at: string | null; approved_at: string | null }
      const pipelineQuotes = (quotesRes.data ?? []) as unknown as PipelineQuote[]
      const inMonthQuoteIds = pipelineQuotes.map(q => q.id)
      const commRes = inMonthQuoteIds.length > 0
        ? await supabase.from('commissions')
            .select('quote_id, amount_cents, status').in('quote_id', inMonthQuoteIds)
        : { data: [] }
      const commRows = (commRes.data ?? []) as Array<{ quote_id: string | null; amount_cents: number; status: CommissionStatus }>
      type Row = { builder_id: string; name: string; sent: number; approved: number; approvedValue: number; signed: number; payments: number; commission: number }
      const by = new Map<string, Row>()
      for (const b of builders ?? []) by.set(b.id, { builder_id: b.id, name: b.name, sent: 0, approved: 0, approvedValue: 0, signed: 0, payments: 0, commission: 0 })
      for (const q of pipelineQuotes) {
        const r = by.get(q.builder_id); if (!r) continue
        if (q.sent_at && q.sent_at >= month) r.sent += 1
        if (q.approved_at && q.approved_at >= month) {
          r.approved += 1
          r.approvedValue += q.total_cents ?? q.price_cents
        }
        const c = commissionForQuote(q, commRows)
        if (c) r.commission += c.amountCents
      }
      for (const c of (contractsRes.data ?? []) as unknown as Array<{ builder_id: string }>) {
        const r = by.get(c.builder_id); if (r) r.signed += 1
      }
      for (const p of (paymentsRes.data ?? []) as unknown as Array<{ amount_cents: number; quote: { builder_id: string } | null }>) {
        const bid = p.quote?.builder_id; if (!bid) continue
        const r = by.get(bid); if (r) r.payments += p.amount_cents
      }
      return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
    },
  })

  // ─── My commissions ────────────────────────────────────────────────
  const { data: comm } = useQuery({
    queryKey: ['home-comm', profileId, isAdmin],
    enabled: Boolean(profileId),
    queryFn: async () => {
      // When admin, show the team's totals; reps see their own.
      const q = supabase.from('commissions')
        .select('amount_cents, status, paid_at')
      if (!isAdmin && profileId) q.eq('profile_id', profileId)
      const { data } = await q
      const yearStart = yearStartIso()
      let unpaid = 0, paid = 0, paidYtd = 0
      for (const r of ((data ?? []) as unknown as Array<{ amount_cents: number; status: string; paid_at: string | null }>)) {
        if (r.status === 'paid') {
          paid += r.amount_cents
          if (r.paid_at && r.paid_at >= yearStart) paidYtd += r.amount_cents
        } else if (r.status === 'pending' || r.status === 'earned') {
          unpaid += r.amount_cents
        }
      }
      return { unpaid, paid, paidYtd }
    },
  })

  // ─── Recent activity: quote_events + quote_payments + milestones ───
  // 20 most recent events across all builders. Each item links to the
  // associated quote.
  const { data: activity } = useQuery({
    queryKey: ['home-activity'],
    queryFn: async () => {
      type Event = { quote_id: string; builder_id: string; builder_name: string | null; customer_name: string | null; kind: string; label: string; at: string }
      const events: Event[] = []
      const quoteEvents = await supabase.from('quote_events')
        .select('quote_id, kind, created_at, quote:quotes(id, builder_id, external_id, source, builder:builders(name), lead:leads(customer:customers(full_name)))')
        .in('kind', ['sent', 'approved'])
        .order('created_at', { ascending: false })
        .limit(40)
      for (const e of (quoteEvents.data ?? []) as unknown as Array<{ quote_id: string; kind: string; created_at: string; quote: { id: string; builder_id: string; external_id: string | null; builder: { name: string } | null; lead: { customer: { full_name: string | null } | null } | null } | null }>) {
        if (!e.quote) continue
        events.push({
          quote_id: e.quote_id,
          builder_id: e.quote.builder_id,
          builder_name: e.quote.builder?.name ?? null,
          customer_name: e.quote.lead?.customer?.full_name ?? null,
          kind: e.kind,
          label: e.kind === 'sent' ? 'Quote sent' : e.kind === 'approved' ? 'Quote approved' : e.kind,
          at: e.created_at,
        })
      }
      const payments = await supabase.from('quote_payments')
        .select('quote_id, amount_cents, received_at, stage, quote:quotes(builder_id, external_id, builder:builders(name), lead:leads(customer:customers(full_name)))')
        .order('received_at', { ascending: false }).limit(20)
      for (const p of (payments.data ?? []) as unknown as Array<{ quote_id: string; amount_cents: number; received_at: string; stage: string | null; quote: { builder_id: string; external_id: string | null; builder: { name: string } | null; lead: { customer: { full_name: string | null } | null } | null } | null }>) {
        if (!p.quote) continue
        events.push({
          quote_id: p.quote_id,
          builder_id: p.quote.builder_id,
          builder_name: p.quote.builder?.name ?? null,
          customer_name: p.quote.lead?.customer?.full_name ?? null,
          kind: 'payment',
          label: `Payment received ${money(p.amount_cents)}${p.stage ? ` · ${p.stage}` : ''}`,
          at: p.received_at,
        })
      }
      const milestones = await supabase.from('quote_milestones')
        .select('quote_id, name, reached_at, quote:quotes(builder_id, external_id, builder:builders(name), lead:leads(customer:customers(full_name)))')
        .order('reached_at', { ascending: false }).limit(20)
      for (const m of (milestones.data ?? []) as unknown as Array<{ quote_id: string; name: string; reached_at: string; quote: { builder_id: string; external_id: string | null; builder: { name: string } | null; lead: { customer: { full_name: string | null } | null } | null } | null }>) {
        if (!m.quote) continue
        events.push({
          quote_id: m.quote_id,
          builder_id: m.quote.builder_id,
          builder_name: m.quote.builder?.name ?? null,
          customer_name: m.quote.lead?.customer?.full_name ?? null,
          kind: 'milestone',
          label: `Milestone · ${m.name}`,
          at: m.reached_at,
        })
      }
      const contracts = await supabase.from('contracts')
        .select('quote_id, status, signed_at, builder_id, builder:builders(name), quote:quotes(lead:leads(customer:customers(full_name)))')
        .not('signed_at', 'is', null).order('signed_at', { ascending: false }).limit(20)
      for (const c of (contracts.data ?? []) as unknown as Array<{ quote_id: string | null; status: string; signed_at: string; builder_id: string; builder: { name: string } | null; quote: { lead: { customer: { full_name: string | null } | null } | null } | null }>) {
        if (!c.quote_id) continue
        events.push({
          quote_id: c.quote_id,
          builder_id: c.builder_id,
          builder_name: c.builder?.name ?? null,
          customer_name: c.quote?.lead?.customer?.full_name ?? null,
          kind: 'contract',
          label: `Contract ${c.status}`,
          at: c.signed_at,
        })
      }
      events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      return events.slice(0, 20)
    },
  })

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-display)' }}>Home</h1>
            <p className="text-sm text-[var(--color-muted)]">
              {isAdmin ? 'Team view' : `Signed in as ${profile?.full_name ?? '—'}`}
            </p>
          </div>
          <button
            onClick={() => setCustomising(v => !v)}
            className="h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-xs inline-flex items-center gap-1.5 hover:bg-[var(--color-surface-raised)]"
          >
            <Settings size={13} /> Customise
          </button>
        </div>
        {customising && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 mb-5 text-sm">
            <div className="text-xs text-[var(--color-muted)] mb-2">Show on your Home:</div>
            <div className="flex flex-wrap gap-3">
              {ALL_SECTIONS.map(s => (
                <label key={s} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={visible(s)}
                    onChange={() => toggle(s)}
                    disabled={savePrefs.isPending}
                  />
                  {SECTION_LABELS[s]}
                </label>
              ))}
              {savePrefs.isPending && <Spinner size={12} />}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ─── My work ────────────────────────────────────────────────── */}
          {visible('my_work') && (
          <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 lg:col-span-2">
            <h2 className="text-sm font-medium mb-3">My work</h2>
            {loadingMine ? <Spinner size={16} /> : (
              <div className="space-y-6">
                <LeadsTable
                  leads={myWork?.leads ?? []}
                  builderById={builderById}
                  openInBuilder={openInBuilder}
                />
                <QuotesTable
                  quotes={myWork?.quotes ?? []}
                  commissions={awaitingCommissions}
                  commissionTotal={awaitingCommissionTotal}
                  builderById={builderById}
                  openInBuilder={openInBuilder}
                />
                <BuildsTable
                  builds={myWork?.builds ?? []}
                  builderById={builderById}
                  openInBuilder={openInBuilder}
                />
              </div>
            )}
          </section>
          )}

          {/* ─── My commissions ─────────────────────────────────────────── */}
          {visible('commissions') && (
          <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex items-start justify-between">
              <h2 className="text-sm font-medium">{isAdmin ? 'Team commissions' : 'My commissions'}</h2>
              <Link to="/ops/me" className="text-xs text-[var(--color-accent)] hover:underline">Details →</Link>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat label="Unpaid" value={comm?.unpaid ?? 0} />
              <Stat label="Paid" value={comm?.paid ?? 0} />
              <Stat label="Paid YTD" value={comm?.paidYtd ?? 0} />
            </div>
          </section>
          )}
        </div>

        {/* ─── Pipeline this month ───────────────────────────────────── */}
        {visible('pipeline') && (
        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mt-5">
          <h2 className="text-sm font-medium mb-3">
            Pipeline — {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </h2>
          {!pipeline ? <Spinner size={16} /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left py-2">Builder</th>
                  <th className="text-right py-2">Quotes sent</th>
                  <th className="text-right py-2">Approved</th>
                  <th className="text-right py-2">Approved $</th>
                  <th className="text-right py-2">Signed</th>
                  <th className="text-right py-2">Payments $</th>
                  <th className="text-right py-2" data-testid="col-commission">Commission $</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.map(r => (
                  <tr key={r.builder_id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-1.5">
                      <button onClick={openInBuilder(r.builder_id)} className="text-[var(--color-accent)] hover:underline">
                        {r.name}
                      </button>
                    </td>
                    <td className="py-1.5 text-right">{r.sent}</td>
                    <td className="py-1.5 text-right">{r.approved}</td>
                    <td className="py-1.5 text-right">{money(r.approvedValue)}</td>
                    <td className="py-1.5 text-right">{r.signed}</td>
                    <td className="py-1.5 text-right">{money(r.payments)}</td>
                    <td className="py-1.5 text-right" data-testid="cell-commission">{money(r.commission)}</td>
                  </tr>
                ))}
                {pipeline.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-sm text-[var(--color-muted)]">No active builders.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </section>
        )}

        {/* ─── Recent activity ───────────────────────────────────────── */}
        {visible('activity') && (
        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mt-5">
          <h2 className="text-sm font-medium mb-3">Recent activity</h2>
          {!activity ? <Spinner size={16} /> : activity.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {activity.map((e, i) => (
                <li key={e.quote_id + ':' + e.kind + ':' + e.at + ':' + i} className="py-2 flex items-start gap-3">
                  <div className="text-xs text-[var(--color-muted)] w-32 shrink-0">
                    {new Date(e.at).toLocaleString()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">
                      <Link to={`/ops/quotes/${e.quote_id}`} onClick={openInBuilder(e.builder_id)} className="text-[var(--color-accent)] hover:underline">
                        {e.customer_name ?? 'Quote'}
                      </Link>
                      {' — '}{e.label}
                    </div>
                    {e.builder_name && (
                      <div className="text-xs text-[var(--color-muted)]">{e.builder_name}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        )}
      </div>
    </div>
  )
}

// ─── My work tables ─────────────────────────────────────────────────
// Each section is a proper table with its own column schema. Money is
// right-aligned; commission total sits in a dedicated footer row.
// Uses the same visual language as Pipeline below.

function MyWorkSection({ title, empty, hasRows, children, 'data-testid': dataTestId }: {
  title: string
  empty: string
  hasRows: boolean
  children: React.ReactNode
  'data-testid'?: string
}) {
  return (
    <div data-testid={dataTestId}>
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)] mb-2">{title}</div>
      {!hasRows ? (
        <p className="text-sm text-[var(--color-muted)]">{empty}</p>
      ) : (
        <table className="w-full text-sm">{children}</table>
      )}
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`text-${align} py-2 text-xs font-medium text-[var(--color-muted)] whitespace-nowrap`}>
      {children}
    </th>
  )
}

function LeadsTable({ leads, builderById, openInBuilder }: {
  leads: Array<{ id: string; builder_id: string; stage: string; updated_at: string; customer: { full_name: string | null; email: string | null } | null }>
  builderById: Map<string, Builder>
  openInBuilder: (id: string) => () => void
}) {
  return (
    <MyWorkSection
      title="Leads waiting for a quote"
      empty="No leads waiting."
      hasRows={leads.length > 0}
      data-testid="my-work-leads"
    >
      <thead>
        <tr className="border-b border-[var(--color-border)]">
          <Th>Customer</Th>
          <Th>Builder</Th>
          <Th>Stage</Th>
        </tr>
      </thead>
      <tbody>
        {leads.map(l => (
          <tr key={l.id} className="border-b border-[var(--color-border)] last:border-0">
            <td className="py-1.5">
              <Link to={`/ops/leads/${l.id}`} onClick={openInBuilder(l.builder_id)}
                    className="text-[var(--color-accent)] hover:underline">
                {l.customer?.full_name ?? l.customer?.email ?? '—'}
              </Link>
            </td>
            <td className="py-1.5 text-[var(--color-muted)]">{builderById.get(l.builder_id)?.name ?? '—'}</td>
            <td className="py-1.5 text-xs uppercase tracking-wide text-[var(--color-muted)]">{l.stage}</td>
          </tr>
        ))}
      </tbody>
    </MyWorkSection>
  )
}

function QuotesTable({ quotes, commissions, commissionTotal, builderById, openInBuilder }: {
  quotes: Array<{ id: string; builder_id: string; version: number; price_cents: number; commission_cents: number | null; sent_at: string | null; status: string; external_id: string | null; source: 'native' | 'builder'; lead: { customer: { full_name: string | null; email: string | null } | null } | null }>
  commissions: Array<{ quote_id: string | null; amount_cents: number; status: CommissionStatus }> | undefined
  commissionTotal: number
  builderById: Map<string, Builder>
  openInBuilder: (id: string) => () => void
}) {
  return (
    <MyWorkSection
      title="Quotes sent, awaiting reply"
      empty="All sent quotes answered."
      hasRows={quotes.length > 0}
      data-testid="my-work-quotes"
    >
      <thead>
        <tr className="border-b border-[var(--color-border)]">
          <Th>Customer</Th>
          <Th>Ref</Th>
          <Th>Builder</Th>
          <Th>Status / age</Th>
          <Th align="right">Quote total</Th>
          <Th align="right">HH commission</Th>
        </tr>
      </thead>
      <tbody>
        {quotes.map(q => {
          const days = daysSince(q.sent_at)
          const title = q.lead?.customer?.full_name ?? q.lead?.customer?.email ?? '—'
          const ref = q.source === 'builder' && q.external_id ? q.external_id : `v${q.version}`
          const c = commissionForQuote(q, commissions)
          return (
            <tr key={q.id} className="border-b border-[var(--color-border)] last:border-0">
              <td className="py-1.5">
                <Link to={`/ops/quotes/${q.id}`} onClick={openInBuilder(q.builder_id)}
                      className="text-[var(--color-accent)] hover:underline">
                  {title}
                </Link>
              </td>
              <td className="py-1.5 font-mono text-xs text-[var(--color-muted)]">{ref}</td>
              <td className="py-1.5 text-[var(--color-muted)]">{builderById.get(q.builder_id)?.name ?? '—'}</td>
              <td className="py-1.5 text-xs text-[var(--color-muted)]">
                <span className="uppercase tracking-wide">{q.status}</span>
                {days != null && <span> · {days}d</span>}
              </td>
              <td className="py-1.5 text-right tabular-nums">{money(q.price_cents)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {c ? money(c.amountCents) : <span className="text-[var(--color-muted)]">—</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
      {commissionTotal > 0 && (
        <tfoot>
          <tr className="border-t border-[var(--color-border)]" data-testid="quotes-commission-total">
            <td colSpan={5} className="py-1.5 text-right text-xs uppercase tracking-wide text-[var(--color-muted)]">
              HH commission total
            </td>
            <td className="py-1.5 text-right tabular-nums font-medium">{money(commissionTotal)}</td>
          </tr>
        </tfoot>
      )}
    </MyWorkSection>
  )
}

function BuildsTable({ builds, builderById, openInBuilder }: {
  builds: Array<{ id: string; builder_id: string; stage: string; price_cents: number; customer: { full_name: string | null } | null }>
  builderById: Map<string, Builder>
  openInBuilder: (id: string) => () => void
}) {
  return (
    <MyWorkSection
      title="Builds in progress"
      empty="No active builds."
      hasRows={builds.length > 0}
      data-testid="my-work-builds"
    >
      <thead>
        <tr className="border-b border-[var(--color-border)]">
          <Th>Customer</Th>
          <Th>Builder</Th>
          <Th>Stage</Th>
          <Th align="right">Total</Th>
        </tr>
      </thead>
      <tbody>
        {builds.map(b => (
          <tr key={b.id} className="border-b border-[var(--color-border)] last:border-0">
            <td className="py-1.5">
              <Link to={`/ops/builds/${b.id}`} onClick={openInBuilder(b.builder_id)}
                    className="text-[var(--color-accent)] hover:underline">
                {b.customer?.full_name ?? '—'}
              </Link>
            </td>
            <td className="py-1.5 text-[var(--color-muted)]">{builderById.get(b.builder_id)?.name ?? '—'}</td>
            <td className="py-1.5 text-xs uppercase tracking-wide text-[var(--color-muted)]">{b.stage}</td>
            <td className="py-1.5 text-right tabular-nums">{money(b.price_cents)}</td>
          </tr>
        ))}
      </tbody>
    </MyWorkSection>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="text-base font-medium">{money(value)}</div>
    </div>
  )
}
