import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router'
import { ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import {
  commissionForQuote, formatCommission, commissionBadgeBg,
  type CommissionStatus,
} from '@/lib/commissionDisplay'

interface Quote {
  id: string
  version: number
  price_cents: number
  tax_cents: number
  total_cents: number
  status: string
  source: 'native' | 'builder'
  external_id: string | null
  external_url: string | null
  builder_version: number | null
  created_at: string
  sent_at: string | null
  approved_at: string | null
  commission_cents: number | null
  builder: { id: string; name: string }
  lead: { customer: { full_name: string | null; email: string | null } | null } | null
  external_platform_name: string | null
  platform: { name: string; chassis: string; years: string } | null
}

export function BuilderQuoteSummary() {
  const { id } = useParams<{ id: string }>()

  const { data: quote } = useQuery({
    queryKey: ['builder-quote', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('quotes').select(`
        id, version, price_cents, tax_cents, total_cents, status, source,
        external_id, external_url, external_platform_name, builder_version, created_at, sent_at, approved_at, commission_cents,
        builder:builders(id, name),
        lead:leads(customer:customers(full_name, email)),
        platform:catalog_platforms(name, chassis, years)
      `).eq('id', id!).single()
      if (error) throw error
      return data as unknown as Quote
    },
  })

  const { data: contract } = useQuery({
    queryKey: ['builder-contract', id],
    enabled: Boolean(quote?.id),
    queryFn: async () => {
      const { data } = await supabase.from('contracts')
        .select('id, status, signed_at, document_url, payment_schedule')
        .eq('quote_id', quote!.id).maybeSingle()
      return data as { id: string; status: string; signed_at: string | null; document_url: string | null; payment_schedule: unknown } | null
    },
  })

  const { data: payments } = useQuery({
    queryKey: ['builder-payments', id],
    enabled: Boolean(quote?.id),
    queryFn: async () => {
      const { data } = await supabase.from('quote_payments')
        .select('id, amount_cents, received_at, stage, reference')
        .eq('quote_id', quote!.id).order('received_at')
      return (data ?? []) as Array<{ id: string; amount_cents: number; received_at: string; stage: string | null; reference: string | null }>
    },
  })

  const { data: commissions } = useQuery({
    queryKey: ['builder-commissions', id],
    enabled: Boolean(quote?.id),
    queryFn: async () => {
      const { data } = await supabase.from('commissions')
        .select('quote_id, amount_cents, status').eq('quote_id', quote!.id)
      return (data ?? []) as Array<{ quote_id: string | null; amount_cents: number; status: CommissionStatus }>
    },
  })

  const { data: milestones } = useQuery({
    queryKey: ['builder-milestones', id],
    enabled: Boolean(quote?.id),
    queryFn: async () => {
      const { data } = await supabase.from('quote_milestones')
        .select('id, name, reached_at')
        .eq('quote_id', quote!.id).order('reached_at')
      return (data ?? []) as Array<{ id: string; name: string; reached_at: string }>
    },
  })

  if (!quote) return <div className="p-8"><Spinner size={16} /></div>

  const customerName = quote.lead?.customer?.full_name ?? quote.lead?.customer?.email ?? '—'
  const totalPaid = (payments ?? []).reduce((s, p) => s + p.amount_cents, 0)
  const commission = commissionForQuote(quote, commissions)

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <Link to="/ops/quotes" className="text-xs text-[var(--color-muted)] hover:underline">← Quotes</Link>
        <div className="flex items-start justify-between mt-2 mb-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)] flex items-center gap-2 flex-wrap">
              <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                {quote.builder.name}
              </span>
              <span>Quote v{quote.version}</span>
              {quote.external_id && (
                <span className="font-mono text-[11px] normal-case text-[var(--color-muted)]" title="Connect reference">
                  {quote.external_id}
                  {quote.builder_version != null && quote.builder_version !== quote.version
                    ? ` · v${quote.builder_version} in Connect`
                    : ''}
                </span>
              )}
              <span className="uppercase">{quote.status}</span>
            </div>
            <h1 className="text-2xl mt-1" style={{ fontFamily: 'var(--font-display)' }}>{customerName}</h1>
            <p className="text-sm text-[var(--color-muted)]">
              {quote.platform?.name
                ? <>{quote.platform.name}{quote.platform.years ? ` · ${quote.platform.years}` : ''}</>
                : quote.external_platform_name
                  ? <><span>{quote.external_platform_name}</span><span className="ml-1.5 text-[10px] uppercase tracking-wide px-1 rounded border border-[var(--color-border)]" title={`Sent by ${quote.builder.name} as "${quote.external_platform_name}" — no matching catalog platform`}>unmapped</span></>
                  : '—'}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl" style={{ fontFamily: 'var(--font-display)' }}>
              ${((quote.total_cents || quote.price_cents) / 100).toLocaleString()}
            </div>
            {quote.tax_cents > 0 && (
              <div className="text-xs text-[var(--color-muted)]">
                Incl. ${((quote.tax_cents) / 100).toLocaleString()} sales tax
              </div>
            )}
            {commission && (
              <div
                data-testid="hh-commission-summary"
                className="mt-2 text-xs text-[var(--color-muted)] inline-flex items-center gap-1.5"
              >
                HH commission {formatCommission(commission)}
                <span
                  className="inline-block px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded"
                  style={{ backgroundColor: commissionBadgeBg(commission.status) }}
                  title={commission.booked ? 'Commission booked' : 'Computed from HH terms — booked on approval'}
                >
                  {commission.status}
                </span>
              </div>
            )}
            {quote.external_url && (
              <a href={quote.external_url} target="_blank" rel="noreferrer"
                 className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline block">
                Open in {quote.builder.name} <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>

        {/*
          Unified status timeline: sent → signed → payments → milestones,
          chronological top-to-bottom with dates. Collapses the prior
          Contract / Payments / Milestones blocks into one event log.
        */}
        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="text-sm font-medium mb-4">Status timeline</h2>
          <ol className="relative border-l border-[var(--color-border)] pl-5 space-y-5">
            <TimelineEvent
              when={quote.sent_at}
              label="Quote sent"
              detail={quote.external_url ? (
                <a href={quote.external_url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">
                  Open in {quote.builder.name} <ExternalLink size={11} />
                </a>
              ) : null}
            />
            <TimelineEvent
              when={quote.approved_at}
              label="Quote approved"
              muted={!quote.approved_at}
              pending={quote.approved_at ? null : 'Awaiting approval'}
            />
            {contract && (
              <>
                <TimelineEvent
                  when={contract.signed_at ? null : quote.approved_at}
                  label={`Contract ${contract.status}`}
                  detail={contract.document_url ? (
                    <a href={contract.document_url} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">
                      Open document <ExternalLink size={11} />
                    </a>
                  ) : null}
                />
                {contract.signed_at && (
                  <TimelineEvent
                    when={contract.signed_at}
                    label="Contract signed"
                  />
                )}
              </>
            )}
            {(payments ?? []).map(p => (
              <TimelineEvent
                key={p.id}
                when={p.received_at}
                label={`Payment${p.stage ? ` · ${p.stage}` : ''} — $${(p.amount_cents / 100).toLocaleString()}`}
                detail={p.reference ? <span className="text-xs text-[var(--color-muted)] font-mono">{p.reference}</span> : null}
              />
            ))}
            {(milestones ?? []).map(m => (
              <TimelineEvent
                key={m.id}
                when={m.reached_at}
                label={`Milestone · ${m.name}`}
              />
            ))}
            {!quote.sent_at && (payments ?? []).length === 0 && (milestones ?? []).length === 0 && !contract && (
              <li className="text-sm text-[var(--color-muted)]">No events yet.</li>
            )}
          </ol>
          {(payments ?? []).length > 0 && (
            <div className="text-right text-sm mt-4 pt-3 border-t border-[var(--color-border)] font-medium">
              Total paid ${(totalPaid / 100).toLocaleString()}
            </div>
          )}
        </section>

        <p className="text-xs text-[var(--color-muted)] mt-6">
          Read-only — this quote is managed in {quote.builder.name}. Edits happen there and sync back via webhook.
        </p>
      </div>
    </div>
  )
}

function TimelineEvent({ when, label, detail, muted, pending }: {
  when: string | null
  label: string
  detail?: React.ReactNode
  muted?: boolean
  pending?: string | null
}) {
  return (
    <li className={`text-sm ${muted ? 'opacity-60' : ''}`}>
      {/* Dot on the vertical rail */}
      <span className={`absolute -left-[5px] w-2.5 h-2.5 rounded-full mt-1.5 ${muted ? 'bg-[var(--color-border)]' : 'bg-[var(--color-accent)]'}`} />
      <div className="font-medium">{label}</div>
      <div className="text-xs text-[var(--color-muted)]">
        {when ? new Date(when).toLocaleString() : (pending ?? '—')}
      </div>
      {detail && <div className="mt-1">{detail}</div>}
    </li>
  )
}
