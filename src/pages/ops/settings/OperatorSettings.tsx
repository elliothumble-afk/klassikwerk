import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'

// The signed-in operator can edit their own contact + brand profile.
// These fields drive the PO ship-to block and the PO letterhead, so
// the user usually only needs to visit this page once.

interface OperatorRow {
  id: string
  name: string
  slug: string
  contact: {
    name?: string
    person?: string
    email?: string
    phone?: string
    website?: string
    address?: string
  } | null
  brand: {
    logo_url?: string
    wordmark_text?: string
    tagline?: string
    color_accent?: string
  } | null
}

export function OperatorSettings() {
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<OperatorRow | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['operator-settings'],
    queryFn: async () => {
      // Scope: a profile has at most one operator (via membership).
      // For now, assume the first operator row (HH ships one-operator).
      const { data: rows, error } = await supabase
        .from('operators')
        .select('id, name, slug, contact, brand')
        .limit(1)
      if (error) throw error
      return (rows?.[0] ?? null) as OperatorRow | null
    },
  })

  useEffect(() => { if (data) setDraft(data) }, [data])

  const save = useMutation({
    mutationFn: async (payload: OperatorRow) => {
      const { error } = await supabase
        .from('operators')
        .update({
          name: payload.name,
          contact: payload.contact ?? {},
          brand: payload.brand ?? {},
        })
        .eq('id', payload.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operator-settings'] }),
    onError: (e: Error) => setErr(e.message),
  })

  if (isLoading || !draft) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }

  const contact = draft.contact ?? {}
  const brand = draft.brand ?? {}
  const setContact = (patch: Partial<NonNullable<OperatorRow['contact']>>) =>
    setDraft(d => d ? { ...d, contact: { ...(d.contact ?? {}), ...patch } } : d)
  const setBrand = (patch: Partial<NonNullable<OperatorRow['brand']>>) =>
    setDraft(d => d ? { ...d, brand: { ...(d.brand ?? {}), ...patch } } : d)

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-display)' }}>Operator settings</h1>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          These fields appear on the purchase-order ship-to block and letterhead.
        </p>
        {err && <p className="text-xs text-[var(--color-danger)] mb-3">{err}</p>}

        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
          <h2 className="text-sm font-medium mb-3">Contact</h2>
          <Field label="Name" value={draft.name}
            onChange={v => setDraft(d => d ? { ...d, name: v } : d)} />
          <Field label="Person" value={contact.person ?? ''}
            onChange={v => setContact({ person: v })} />
          <Field label="Email" value={contact.email ?? ''}
            onChange={v => setContact({ email: v })} />
          <Field label="Phone" value={contact.phone ?? ''}
            onChange={v => setContact({ phone: v })}
            placeholder="+1 555 555 0100" />
          <Field label="Website" value={contact.website ?? ''}
            onChange={v => setContact({ website: v })} />
          <TextArea label="Address" value={contact.address ?? ''}
            onChange={v => setContact({ address: v })}
            placeholder={'123 Main St\nAustin, TX 78701\nUnited States'} />
        </section>

        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
          <h2 className="text-sm font-medium mb-3">Brand</h2>
          <Field label="Wordmark text" value={brand.wordmark_text ?? ''}
            onChange={v => setBrand({ wordmark_text: v })} />
          <Field label="Logo URL" value={brand.logo_url ?? ''}
            onChange={v => setBrand({ logo_url: v })}
            placeholder="https://cdn…/logo.png" />
          <Field label="Tagline" value={brand.tagline ?? ''}
            onChange={v => setBrand({ tagline: v })} />
          <Field label="Accent colour (hex)" value={brand.color_accent ?? ''}
            onChange={v => setBrand({ color_accent: v })}
            placeholder="#1C1C1A" />
        </section>

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setDraft(data ?? null)}
            className="h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm"
          >
            Reset
          </button>
          <button
            onClick={() => save.mutate(draft)}
            disabled={save.isPending}
            className="h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {save.isPending && <Spinner size={13} />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs text-[var(--color-muted)] mb-1">{label}</span>
      <input
        className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}

function TextArea({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs text-[var(--color-muted)] mb-1">{label}</span>
      <textarea
        className="w-full h-24 border border-[var(--color-border)] rounded px-2 py-1.5 text-sm font-mono"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}
