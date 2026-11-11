import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Spinner } from '@/components/ui/Spinner'
import {
  composeBuilderCommissionDescription, commissionSourceLabel,
} from '@/lib/commissionDisplay'

interface Row {
  id: string
  status: 'pending' | 'earned' | 'paid' | 'void'
  source: 'native' | 'builder'
  description: string | null
  amount_cents: number
  earned_at: string | null
  paid_at: string | null
  paid_reference: string | null
  quote_id: string | null
  builder: { name: string } | null
  quote: {
    id: string
    external_id: string | null
    price_cents: number
    total_cents: number | null
    external_platform_name: string | null
    platform: { name: string } | null
    lead: { customer: { full_name: string | null } | null } | null
  } | null
}

function describeRow(r: Row): string {
  if (r.description && r.description.trim()) return r.description
  if (r.source === 'builder' && r.quote) {
    const composed = composeBuilderCommissionDescription({
      customer_name: r.quote.lead?.customer?.full_name ?? null,
      platform_name: r.quote.platform?.name ?? r.quote.external_platform_name ?? null,
      external_id: r.quote.external_id,
      total_cents: r.quote.total_cents,
      price_cents: r.quote.price_cents,
    })
    if (composed) return composed
  }
  return '—'
}

export function OpsMe() {
  const { profile } = useAuth()
  const profileId = profile?.id ?? null

  const { data, isLoading } = useQuery({
    queryKey: ['ops-me-commissions', profileId],
    enabled: Boolean(profileId),
    queryFn: async () => {
      const { data, error } = await supabase.from('commissions')
        .select(`
          id, status, source, description, amount_cents, earned_at, paid_at,
          paid_reference, quote_id,
          builder:builders(name),
          quote:quotes!commissions_quote_id_fkey(id, external_id, price_cents, total_cents, external_platform_name,
            platform:catalog_platforms(name),
            lead:leads(customer:customers(full_name)))
        `)
        .eq('profile_id', profileId!)
        .order('earned_at', { ascending: false, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as unknown as Row[]
    },
  })

  const totals = useMemo(() => {
    const yearStart = new Date(new Date().getUTCFullYear(), 0, 1).toISOString()
    let pending = 0, earned = 0, paid = 0, paidYTD = 0, earnedYTD = 0
    for (const r of data ?? []) {
      if (r.status === 'pending') pending += r.amount_cents
      if (r.status === 'earned')  earned  += r.amount_cents
      if (r.status === 'paid')    paid    += r.amount_cents
      if (r.status === 'paid' && r.paid_at && r.paid_at >= yearStart) paidYTD += r.amount_cents
      if (r.status === 'earned' && r.earned_at && r.earned_at >= yearStart) earnedYTD += r.amount_cents
    }
    return { pending, earned, paid, paidYTD, earnedYTD }
  }, [data])

  if (!profileId) return <div className="p-8"><Spinner size={16} /></div>

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl mb-2" style={{ fontFamily: 'var(--font-display)' }}>My commissions</h1>
        <p className="text-sm text-[var(--color-muted)] mb-6">
          Signed in as {profile?.full_name ?? '—'}
        </p>

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Stat label="Pending" value={totals.pending} />
          <Stat label="Earned" value={totals.earned} />
          <Stat label="Paid" value={totals.paid} />
          <Stat label="Paid YTD" value={totals.paidYTD} />
        </section>

        {isLoading ? <Spinner size={16} /> : (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left px-3 py-2">Description</th>
                  <th className="text-left px-3 py-2">Customer</th>
                  <th className="text-left px-3 py-2">Builder</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Earned</th>
                  <th className="text-left px-3 py-2">Paid</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map(r => (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-3 py-1.5">
                      {r.quote_id
                        ? <Link to={`/ops/quotes/${r.quote_id}`} className="text-[var(--color-accent)] hover:underline">{describeRow(r)}</Link>
                        : describeRow(r)}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-muted)]">{r.quote?.lead?.customer?.full_name ?? '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-muted)]">{r.builder?.name ?? '—'}</td>
                    <td className="px-3 py-1.5 text-xs uppercase tracking-wide text-[var(--color-muted)]">{commissionSourceLabel(r.source)}</td>
                    <td className="px-3 py-1.5 text-xs uppercase tracking-wide">{r.status}</td>
                    <td className="px-3 py-1.5 text-right">${(r.amount_cents / 100).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-muted)]">{r.earned_at ? new Date(r.earned_at).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-muted)]">{r.paid_at ? new Date(r.paid_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
                {(data ?? []).length === 0 && (
                  <tr><td colSpan={8} className="p-6 text-sm text-center text-[var(--color-muted)]">No commissions yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="text-xl mt-1">${(value / 100).toLocaleString()}</div>
    </div>
  )
}
