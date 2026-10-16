import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'
import { useAuth } from '@/hooks/useAuth'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { LEAD_STAGES, type Lead, type LeadStage, type Customer, type Profile } from '@/types/database'
import { NewLeadDialog } from './NewLeadDialog'

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

type LeadRow = Lead & {
  customer: Pick<Customer, 'full_name' | 'email'> | null
  owner_profile: Pick<Profile, 'full_name'> | null
}

export function LeadsBoard() {
  const { selected } = useOpsBuilderSelection()
  const { profile } = useAuth()
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'mine' | 'unassigned'>('all')
  const [newLeadOpen, setNewLeadOpen] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['leads', selected?.id, ownerFilter, profile?.id],
    enabled: Boolean(selected?.id),
    queryFn: async () => {
      let q = supabase
        .from('leads')
        .select('*, customer:customers(full_name, email), owner_profile:profiles(full_name)')
        .eq('builder_id', selected!.id)
        .order('created_at', { ascending: false })
      if (ownerFilter === 'mine' && profile?.id) q = q.eq('owner_profile_id', profile.id)
      if (ownerFilter === 'unassigned') q = q.is('owner_profile_id', null)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as LeadRow[]
    },
  })

  const byStage = useMemo(() => {
    const m = new Map<LeadStage, LeadRow[]>()
    for (const s of LEAD_STAGES) m.set(s, [])
    for (const lead of data ?? []) m.get(lead.stage)!.push(lead)
    return m
  }, [data])

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl" style={{ fontFamily: 'var(--font-display)' }}>Leads</h1>
          <div className="flex items-center gap-2">
            <select
              value={ownerFilter}
              onChange={e => setOwnerFilter(e.target.value as typeof ownerFilter)}
              className="h-9 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm"
            >
              <option value="all">All owners</option>
              <option value="mine">Owned by me</option>
              <option value="unassigned">Unassigned</option>
            </select>
            <button
              onClick={() => setNewLeadOpen(true)}
              className="flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90"
            >
              <Plus size={14} /> New lead
            </button>
          </div>
        </div>

        {newLeadOpen && (
          <NewLeadDialog
            defaultBuilderId={selected?.id ?? null}
            onClose={() => setNewLeadOpen(false)}
            onCreated={() => { setNewLeadOpen(false); refetch() }}
          />
        )}

        {isLoading ? (
          <Spinner size={20} className="text-[var(--color-muted)]" />
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState title="No leads yet" description="Inquiries from the public landing and Zoho will land here." />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {LEAD_STAGES.map(stage => {
              const column = byStage.get(stage) ?? []
              return (
                <div key={stage} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide">{STAGE_LABEL[stage]}</span>
                    <span className="text-xs text-[var(--color-muted)]">{column.length}</span>
                  </div>
                  <ul className="divide-y divide-[var(--color-border)]">
                    {column.length === 0 ? (
                      <li className="px-3 py-6 text-xs text-[var(--color-muted)] text-center">—</li>
                    ) : column.map(lead => (
                      <li key={lead.id}>
                        <Link
                          to={`/ops/leads/${lead.id}`}
                          className="block px-3 py-2.5 hover:bg-[var(--color-surface-raised)] transition"
                        >
                          <div className="text-sm font-medium truncate">
                            {lead.customer?.full_name ?? lead.customer?.email ?? '—'}
                          </div>
                          <div className="text-xs text-[var(--color-muted)] truncate">
                            {lead.customer?.email ?? '—'}
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--color-muted)]">
                            <span>{lead.source}</span>
                            <span>{lead.owner_profile?.full_name ?? ''}</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
