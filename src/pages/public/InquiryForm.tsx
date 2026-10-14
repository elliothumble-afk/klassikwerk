import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useBuilder } from '@/lib/builderContext'
import { Spinner } from '@/components/ui/Spinner'
import type { Platform } from '@/types/database'

interface Props {
  platforms: Platform[]
}

export function InquiryForm({ platforms }: Props) {
  const { bundle } = useBuilder()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [platformId, setPlatformId] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!bundle) return
    setSubmitting(true)
    setErr(null)
    try {
      const { data, error } = await supabase.functions.invoke('submit-inquiry', {
        body: {
          builder_id: bundle.builder.id,
          builder_slug: bundle.builder.slug,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          platform_id: platformId || null,
          message: message.trim(),
        },
      })
      if (error) throw error
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
      setSent(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm text-[var(--color-foreground)]">
        Thank you — we'll be in touch at <strong>{email}</strong>.
      </div>
    )
  }

  const input = 'h-10 px-3 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]'

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input required value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className={input} />
        <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className={input} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)" className={input} />
        <select value={platformId} onChange={e => setPlatformId(e.target.value)} className={input}>
          <option value="">Platform of interest (optional)</option>
          {platforms.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="What are you thinking?" rows={4}
        className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]" />
      {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center h-10 px-5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90 disabled:opacity-50 transition"
      >
        {submitting && <Spinner size={14} className="mr-2" />}
        Send
      </button>
    </form>
  )
}
