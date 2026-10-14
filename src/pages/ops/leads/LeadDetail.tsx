import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import { LEAD_STAGES, type LeadStage } from '@/types/database'

interface LeadDetailData {
  id: string
  stage: LeadStage
  source: string
  zoho_lead_id: string | null
  notes: string | null
  message: string | null
  phone: string | null
  platform_interest_id: string | null
  created_at: string
  customer: { full_name: string | null; email: string | null; phone: string | null; zoho_contact_id: string | null } | null
  platform: { name: string } | null
  quotes: { id: string; version: number; status: string; price_cents: number; created_at: string }[]
}

export function LeadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['lead', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select(`
          id, stage, source, zoho_lead_id, notes, message, phone,
          platform_interest_id, created_at,
          customer:customers(full_name, email, phone, zoho_contact_id),
          platform:catalog_platforms!leads_platform_interest_id_fkey(name),
          quotes(id, version, status, price_cents, created_at)
        `)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as LeadDetailData
    },
  })

  const updateStage = useMutation({
    mutationFn: async (stage: LeadStage) => {
      const { error } = await supabase.from('leads').update({ stage }).eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead', id] }),
  })

  if (isLoading || !data) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <Link to="/ops/leads" className="text-xs text-[var(--color-muted)] hover:underline">← Leads</Link>
        <div className="flex items-start justify-between mt-2 mb-6">
          <div>
            <h1 className="text-2xl" style={{ fontFamily: 'var(--font-display)' }}>
              {data.customer?.full_name ?? data.customer?.email ?? '—'}
            </h1>
            <p className="text-sm text-[var(--color-muted)]">
              {data.customer?.email ?? '—'}{data.phone ? ` · ${data.phone}` : ''}
            </p>
          </div>
          <button
            onClick={() => navigate(`/ops/quotes/new?lead=${data.id}`)}
            className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90"
          >
            Start quote
          </button>
        </div>

        <div className="grid gap-5 md:grid-cols-2 mb-6">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3">
            <Row label="Stage">
              <select
                value={data.stage}
                onChange={e => updateStage.mutate(e.target.value as LeadStage)}
                className="h-8 px-2 border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-background)] text-sm"
              >
                {LEAD_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Row>
            <Row label="Source">{data.source}</Row>
            <Row label="Platform of interest">{data.platform?.name ?? '—'}</Row>
            <Row label="Zoho lead">
              {data.zoho_lead_id ? (
                <a
                  href={`https://crm.zoho.com/crm/EntityInfo.do?module=Leads&id=${data.zoho_lead_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-accent)] text-xs inline-flex items-center gap-1 hover:underline"
                >
                  {data.zoho_lead_id} <ExternalLink size={11} />
                </a>
              ) : '—'}
            </Row>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-sm font-medium mb-2">Message</h2>
            <p className="text-sm text-[var(--color-muted)] whitespace-pre-wrap">
              {data.message ?? '—'}
            </p>
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="px-5 py-3 border-b border-[var(--color-border)] text-sm font-medium">
            Quotes
          </div>
          {data.quotes.length === 0 ? (
            <div className="px-5 py-6 text-sm text-[var(--color-muted)]">No quotes yet.</div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {data.quotes
                .sort((a, b) => b.version - a.version)
                .map(q => (
                  <li key={q.id} className="px-5 py-3 flex items-center justify-between">
                    <Link to={`/ops/quotes/${q.id}`} className="text-sm hover:underline">
                      v{q.version}
                    </Link>
                    <span className="text-xs text-[var(--color-muted)]">
                      ${(q.price_cents / 100).toLocaleString()} · {q.status}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--color-muted)] text-xs uppercase tracking-wide">{label}</span>
      <span>{children}</span>
    </div>
  )
}
