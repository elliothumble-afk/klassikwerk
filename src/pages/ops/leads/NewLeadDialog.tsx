import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import type { Builder } from '@/types/database'

const SOURCES = ['site', 'design_centre', 'referral', 'zoho'] as const
type Source = typeof SOURCES[number]

interface Props {
  defaultBuilderId: string | null
  onClose: () => void
  onCreated: (leadId: string) => void
}

export function NewLeadDialog({ defaultBuilderId, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [builderId, setBuilderId] = useState<string>(defaultBuilderId ?? '')
  const [source, setSource] = useState<Source>('design_centre')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data: builders } = useQuery({
    queryKey: ['new-lead', 'builders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('builders').select('*').order('sort')
      if (error) throw error
      return (data ?? []) as Builder[]
    },
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setErr(null)
    try {
      if (!builderId) throw new Error('Pick a builder')
      const emailNorm = email.trim().toLowerCase()
      let customerId: string | null = null
      if (emailNorm) {
        const existing = await supabase.from('customers').select('id, full_name').eq('email', emailNorm).maybeSingle()
        if (existing.error) throw existing.error
        if (existing.data) {
          customerId = existing.data.id
          if (name && !existing.data.full_name) {
            await supabase.from('customers').update({ full_name: name.trim() }).eq('id', customerId)
          }
        } else {
          const ins = await supabase.from('customers').insert({
            email: emailNorm,
            full_name: name.trim() || null,
            source: source === 'site' ? 'web' : source === 'design_centre' ? 'humble_house' : 'referral',
          }).select('id').single()
          if (ins.error) throw ins.error
          customerId = ins.data.id
        }
      }

      const leadIns = await supabase.from('leads').insert({
        builder_id: builderId,
        customer_id: customerId,
        source,
        stage: 'inquiry',
        phone: phone.trim() || null,
      }).select('id').single()
      if (leadIns.error) throw leadIns.error
      onCreated(leadIns.data.id)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const input = 'h-9 px-3 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] text-sm'

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-6">
      <div className="bg-[var(--color-surface)] rounded-[var(--radius-lg)] max-w-md w-full p-6 border border-[var(--color-border)]">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-medium">New lead</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Full name">
            <input required value={name} onChange={e => setName(e.target.value)} className={input} />
          </Field>
          <Field label="Email">
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} className={input} />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={e => setPhone(e.target.value)} className={input} />
          </Field>
          <Field label="Builder">
            <select value={builderId} onChange={e => setBuilderId(e.target.value)} required className={input}>
              <option value="">Select builder…</option>
              {(builders ?? []).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Source">
            <select value={source} onChange={e => setSource(e.target.value as Source)} className={input}>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-3 text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {submitting && <Spinner size={13} />}
              Create lead
            </button>
          </div>
        </form>
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
