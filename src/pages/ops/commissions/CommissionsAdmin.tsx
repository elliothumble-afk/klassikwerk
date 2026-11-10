import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Download, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'

interface Row {
  id: string
  builder_id: string
  profile_id: string | null
  quote_id: string | null
  external_id: string | null
  source: 'native' | 'builder'
  description: string | null
  amount_cents: number
  status: 'pending' | 'earned' | 'paid' | 'void'
  earned_at: string | null
  paid_at: string | null
  paid_reference: string | null
  conflict: boolean
  builder: { name: string } | null
  rep: { full_name: string | null } | null
}

const STATUSES = ['pending', 'earned', 'paid', 'void'] as const

export function CommissionsAdmin() {
  const qc = useQueryClient()
  const [repFilter, setRepFilter] = useState<string>('')
  const [builderFilter, setBuilderFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paidRef, setPaidRef] = useState<string>('')
  const [paidDate, setPaidDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [err, setErr] = useState<string | null>(null)

  const { data: rows, isLoading } = useQuery({
    queryKey: ['commissions-admin', repFilter, builderFilter, statusFilter, fromDate, toDate],
    queryFn: async () => {
      let q = supabase.from('commissions').select(`
        id, builder_id, profile_id, quote_id, external_id, source,
        description, amount_cents, status, earned_at, paid_at,
        paid_reference, conflict,
        builder:builders(name),
        rep:profiles!commissions_profile_id_fkey(full_name)
      `).order('earned_at', { ascending: false, nullsFirst: false })
      if (repFilter) q = q.eq('profile_id', repFilter)
      if (builderFilter) q = q.eq('builder_id', builderFilter)
      if (statusFilter) q = q.eq('status', statusFilter)
      if (fromDate) q = q.gte('earned_at', fromDate)
      if (toDate) q = q.lte('earned_at', `${toDate}T23:59:59`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as Row[]
    },
  })

  const { data: builders } = useQuery({
    queryKey: ['commissions-builders'],
    queryFn: async () => {
      const { data } = await supabase.from('builders').select('id, name').order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
  })
  const { data: reps } = useQuery({
    queryKey: ['commissions-reps'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').eq('role', 'ops').order('full_name')
      return (data ?? []) as { id: string; full_name: string | null }[]
    },
  })

  const totals = useMemo(() => {
    const per = new Map<string, { name: string; forecast: number; paid: number }>()
    for (const r of rows ?? []) {
      const key = r.profile_id ?? 'unassigned'
      const b = per.get(key) ?? { name: r.rep?.full_name ?? 'Unassigned', forecast: 0, paid: 0 }
      if (r.status === 'paid') b.paid += r.amount_cents
      else if (r.status === 'pending' || r.status === 'earned') b.forecast += r.amount_cents
      per.set(key, b)
    }
    return [...per.values()].sort((a, b) => (b.forecast + b.paid) - (a.forecast + a.paid))
  }, [rows])

  const markPaid = useMutation({
    mutationFn: async () => {
      if (selected.size === 0) throw new Error('No rows selected')
      const nowDate = paidDate || new Date().toISOString().slice(0, 10)
      const upd = await supabase.from('commissions')
        .update({
          status: 'paid',
          paid_at: `${nowDate}T00:00:00Z`,
          paid_reference: paidRef || null,
        } as never)
        .in('id', Array.from(selected))
      if (upd.error) throw upd.error
    },
    onSuccess: () => {
      setSelected(new Set()); setPaidRef('')
      qc.invalidateQueries({ queryKey: ['commissions-admin'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['ops-me-commissions'] })
    },
    onError: (e: Error) => setErr(e.message),
  })

  function exportCsv() {
    const header = ['id', 'builder', 'rep', 'source', 'status', 'amount_cents', 'description', 'earned_at', 'paid_at', 'paid_reference', 'external_id', 'conflict']
    const lines = [header.join(',')]
    for (const r of rows ?? []) {
      const cells = [
        r.id, r.builder?.name ?? '', r.rep?.full_name ?? '',
        r.source, r.status, String(r.amount_cents),
        JSON.stringify(r.description ?? ''), r.earned_at ?? '',
        r.paid_at ?? '', r.paid_reference ?? '', r.external_id ?? '',
        String(r.conflict),
      ]
      lines.push(cells.map(c => typeof c === 'string' && c.includes(',') ? `"${c.replace(/"/g, '""')}"` : c).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `commissions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-display)' }}>Commissions</h1>
        <div className="flex gap-3 flex-wrap mb-4 text-sm">
          <select value={repFilter} onChange={e => setRepFilter(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1">
            <option value="">All reps</option>
            {(reps ?? []).map(r => <option key={r.id} value={r.id}>{r.full_name ?? '—'}</option>)}
          </select>
          <select value={builderFilter} onChange={e => setBuilderFilter(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1">
            <option value="">All builders</option>
            {(builders ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1">
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
          <button onClick={exportCsv} className="inline-flex items-center gap-1 text-xs border border-[var(--color-border)] rounded px-2 py-1">
            <Download size={11} /> CSV
          </button>
        </div>

        {totals.length > 0 && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-5">
            <h2 className="text-sm font-medium mb-3">Totals per rep</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-muted)]">
                  <th className="text-left py-1">Rep</th>
                  <th className="text-right py-1">Forecast</th>
                  <th className="text-right py-1">Paid</th>
                  <th className="text-right py-1">Total</th>
                </tr>
              </thead>
              <tbody>
                {totals.map(t => (
                  <tr key={t.name} className="border-t border-[var(--color-border)]">
                    <td className="py-1.5">{t.name}</td>
                    <td className="py-1.5 text-right">${(t.forecast / 100).toLocaleString()}</td>
                    <td className="py-1.5 text-right">${(t.paid / 100).toLocaleString()}</td>
                    <td className="py-1.5 text-right font-medium">${((t.forecast + t.paid) / 100).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selected.size > 0 && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 p-3 mb-4 text-sm flex items-center gap-2 flex-wrap">
            <span>{selected.size} selected</span>
            <input value={paidRef} onChange={e => setPaidRef(e.target.value)} placeholder="Payment reference" className="border border-[var(--color-border)] rounded px-2 py-1 flex-1 min-w-[160px]" />
            <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
            <button onClick={() => markPaid.mutate()} disabled={markPaid.isPending}
              className="h-8 px-3 rounded bg-[var(--color-accent)] text-white inline-flex items-center gap-1 disabled:opacity-50">
              {markPaid.isPending && <Spinner size={11} />}<Check size={11} /> Mark paid
            </button>
          </div>
        )}
        {err && <p className="text-xs text-[var(--color-danger)] mb-3">{err}</p>}

        {isLoading ? <Spinner size={16} /> : (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-muted)] border-b border-[var(--color-border)]">
                  <th className="px-2 py-2"></th>
                  <th className="text-left px-3 py-2">Rep</th>
                  <th className="text-left px-3 py-2">Builder</th>
                  <th className="text-left px-3 py-2">Description</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Earned</th>
                  <th className="text-left px-3 py-2">Paid</th>
                  <th className="text-left px-3 py-2">Ref</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map(r => (
                  <tr key={r.id} className={`border-b border-[var(--color-border)] last:border-0 ${r.conflict ? 'bg-[var(--color-danger)]/5' : ''}`}>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} disabled={r.status === 'paid'} />
                    </td>
                    <td className="px-3 py-1.5">{r.rep?.full_name ?? '—'}</td>
                    <td className="px-3 py-1.5">{r.builder?.name ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      {r.quote_id ? <Link to={`/ops/quotes/${r.quote_id}`} className="text-[var(--color-accent)] hover:underline">{r.description ?? '—'}</Link> : (r.description ?? '—')}
                      {r.conflict && <span className="ml-2 text-xs text-[var(--color-danger)]">(conflict)</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs uppercase tracking-wide text-[var(--color-muted)]">{r.source}</td>
                    <td className="px-3 py-1.5 text-xs uppercase tracking-wide">{r.status}</td>
                    <td className="px-3 py-1.5 text-right">${(r.amount_cents / 100).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-muted)]">{r.earned_at ? new Date(r.earned_at).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-muted)]">{r.paid_at ? new Date(r.paid_at).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-muted)]">{r.paid_reference ?? '—'}</td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && (
                  <tr><td colSpan={10} className="p-6 text-sm text-center text-[var(--color-muted)]">No commissions match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
