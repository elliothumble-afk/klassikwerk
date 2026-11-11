import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router'
import { ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'

interface Quote {
  id: string
  version: number
  price_cents: number
  tax_cents: number
  total_cents: number
  status: string
  source: string
  external_id: string | null
  external_url: string | null
  builder_version: number | null
  created_at: string
  sent_at: string | null
  approved_at: string | null
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
        external_id, external_url, external_platform_name, builder_version, created_at, sent_at, approved_at,
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
            {quote.external_url && (
              <a href={quote.external_url} target="_blank" rel="noreferrer"
                 className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">
                Open in {quote.builder.name} <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-sm font-medium mb-3">Contract</h2>
            {contract ? (
              <div className="text-sm">
                <div className="mb-1">Status: <span className="font-medium">{contract.status}</span></div>
                {contract.signed_at && (
                  <div className="text-xs text-[var(--color-muted)]">Signed {new Date(contract.signed_at).toLocaleDateString()}</div>
                )}
                {contract.document_url && (
                  <a href={contract.document_url} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline mt-2">
                    Open document <ExternalLink size={11} />
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">No contract yet.</p>
            )}
          </section>

          <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-sm font-medium mb-3">Payments received</h2>
            {(payments ?? []).length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">None yet.</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <tbody>
                    {payments!.map(p => (
                      <tr key={p.id} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="py-1.5">{p.stage ?? 'Payment'}</td>
                        <td className="py-1.5 text-right">${(p.amount_cents / 100).toLocaleString()}</td>
                        <td className="py-1.5 text-right text-xs text-[var(--color-muted)]">{new Date(p.received_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-right text-sm mt-2 font-medium">Total ${(totalPaid / 100).toLocaleString()}</div>
              </>
            )}
          </section>
        </div>

        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mt-5">
          <h2 className="text-sm font-medium mb-3">Milestones</h2>
          {(milestones ?? []).length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">None recorded yet.</p>
          ) : (
            <ol className="relative border-l border-[var(--color-border)] pl-4 space-y-3">
              {milestones!.map(m => (
                <li key={m.id} className="text-sm">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-[var(--color-muted)]">{new Date(m.reached_at).toLocaleString()}</div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <p className="text-xs text-[var(--color-muted)] mt-6">
          Read-only — this quote is managed in {quote.builder.name}. Edits happen there and sync back via webhook.
        </p>
      </div>
    </div>
  )
}
