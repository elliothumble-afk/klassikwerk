import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import type { BuilderTerms, PaymentSchedule } from '@/types/database'

export function TermsEdit() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<BuilderTerms | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['builder-terms', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('builder_terms').select('*').eq('builder_id', id!).maybeSingle()
      if (error) throw error
      return data as BuilderTerms | null
    },
  })
  useEffect(() => { if (data) setDraft(data) }, [data])

  const save = useMutation({
    mutationFn: async (next: BuilderTerms) => {
      const { error } = await supabase.from('builder_terms').upsert({
        builder_id: next.builder_id,
        reservation_cents: next.reservation_cents,
        payment_schedule: next.payment_schedule,
        warranty_text: next.warranty_text,
        governing_law: next.governing_law,
        lead_time_copy: next.lead_time_copy,
        currency: next.currency,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['builder-terms', id] }),
  })

  if (isLoading || !draft) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }

  function up<K extends keyof BuilderTerms>(key: K, value: BuilderTerms[K]) {
    setDraft(prev => prev ? { ...prev, [key]: value } : prev)
  }

  function updateRow(i: number, patch: Partial<PaymentSchedule>) {
    if (!draft) return
    const next = [...draft.payment_schedule]
    next[i] = { ...next[i], ...patch }
    up('payment_schedule', next)
  }
  function addRow() { if (!draft) return; up('payment_schedule', [...draft.payment_schedule, { label: '', percent: 0, trigger: '' }]) }
  function removeRow(i: number) { if (!draft) return; up('payment_schedule', draft.payment_schedule.filter((_, idx) => idx !== i)) }

  const input = 'h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] text-sm'
  const total = draft.payment_schedule.reduce((sum, r) => sum + (Number(r.percent) || 0), 0)

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-display)' }}>Terms</h1>

        <div className="space-y-3 mb-8">
          <Field label="Reservation (USD cents)">
            <input type="number" value={draft.reservation_cents} onChange={e => up('reservation_cents', Number(e.target.value))} className={`${input} w-full`} />
          </Field>
          <Field label="Currency">
            <input value={draft.currency} onChange={e => up('currency', e.target.value)} className={`${input} w-32`} />
          </Field>
          <Field label="Warranty text"><textarea value={draft.warranty_text ?? ''} onChange={e => up('warranty_text', e.target.value)} className={`${input} w-full h-20 py-2`} /></Field>
          <Field label="Governing law"><input value={draft.governing_law ?? ''} onChange={e => up('governing_law', e.target.value)} className={`${input} w-full`} /></Field>
          <Field label="Lead-time copy"><input value={draft.lead_time_copy ?? ''} onChange={e => up('lead_time_copy', e.target.value)} className={`${input} w-full`} /></Field>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Payment schedule</h2>
            <span className={`text-xs ${total === 100 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>Total {total}%</span>
          </div>
          <div className="space-y-2">
            {draft.payment_schedule.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_1fr_30px] gap-2">
                <input value={r.label} onChange={e => updateRow(i, { label: e.target.value })} className={input} placeholder="Label" />
                <input type="number" value={r.percent} onChange={e => updateRow(i, { percent: Number(e.target.value) })} className={input} />
                <input value={r.trigger} onChange={e => updateRow(i, { trigger: e.target.value })} className={input} placeholder="trigger" />
                <button onClick={() => removeRow(i)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)]">×</button>
              </div>
            ))}
          </div>
          <button onClick={addRow} className="mt-2 text-xs text-[var(--color-accent)] hover:underline">+ Add step</button>
        </div>

        <button
          onClick={() => save.mutate(draft)}
          disabled={save.isPending}
          className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-50"
        >
          {save.isPending ? <Spinner size={13} /> : <Check size={14} />}
          {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : 'Save terms'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-[var(--color-muted)] block mb-1">{label}</label>
      {children}
    </div>
  )
}
