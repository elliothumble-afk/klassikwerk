import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import type { Builder, BuilderBrand, ProcessStage } from '@/types/database'
import { Check } from 'lucide-react'
import { SyncPanel } from './SyncPanel'

export function BrandEdit() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data: builder } = useQuery({
    queryKey: ['builder', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('builders').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Builder
    },
  })

  const { data: brand, isLoading } = useQuery({
    queryKey: ['builder-brand', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('builder_brand').select('*').eq('builder_id', id!).maybeSingle()
      if (error) throw error
      return data as BuilderBrand | null
    },
  })

  const synced = Boolean(brand?.synced)

  const [draft, setDraft] = useState<BuilderBrand | null>(null)
  useEffect(() => { if (brand) setDraft(brand) }, [brand])

  const save = useMutation({
    mutationFn: async (next: BuilderBrand) => {
      const { error } = await supabase.from('builder_brand').upsert({
        builder_id: next.builder_id,
        logo_url: next.logo_url,
        wordmark_text: next.wordmark_text,
        color_accent: next.color_accent,
        color_bg: next.color_bg,
        color_text: next.color_text,
        font_display: next.font_display,
        font_body: next.font_body,
        tagline: next.tagline,
        hero_copy: next.hero_copy,
        process_copy: next.process_copy,
        custom_domain: next.custom_domain,
        enquire_url: next.enquire_url,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['builder-brand', id] }),
  })

  if (isLoading || !draft) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }

  function up<K extends keyof BuilderBrand>(key: K, value: BuilderBrand[K]) {
    setDraft(prev => prev ? { ...prev, [key]: value } : prev)
  }

  function updateStage(i: number, patch: Partial<ProcessStage>) {
    if (!draft) return
    const next = [...(draft.process_copy ?? [])]
    next[i] = { ...next[i], ...patch }
    up('process_copy', next)
  }

  const input = 'h-9 px-3 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm'

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-display)' }}>Brand</h1>

        {builder && <SyncPanel builder={builder} />}

        <fieldset disabled={synced} className={synced ? 'opacity-70' : ''}>
        <section className="space-y-3 mb-8">
          <Field label="Wordmark text"><input value={draft.wordmark_text ?? ''} onChange={e => up('wordmark_text', e.target.value)} className={input} /></Field>
          <Field label="Logo URL"><input value={draft.logo_url ?? ''} onChange={e => up('logo_url', e.target.value)} className={input} /></Field>
          <Field label="Tagline"><input value={draft.tagline ?? ''} onChange={e => up('tagline', e.target.value)} className={input} /></Field>
          <Field label="Hero copy"><textarea value={draft.hero_copy ?? ''} onChange={e => up('hero_copy', e.target.value)} className={`${input} h-24 py-2`} /></Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Accent"><input type="color" value={draft.color_accent} onChange={e => up('color_accent', e.target.value)} className="h-9 w-full" /></Field>
            <Field label="Background"><input type="color" value={draft.color_bg} onChange={e => up('color_bg', e.target.value)} className="h-9 w-full" /></Field>
            <Field label="Text"><input type="color" value={draft.color_text} onChange={e => up('color_text', e.target.value)} className="h-9 w-full" /></Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Display font"><input value={draft.font_display} onChange={e => up('font_display', e.target.value)} className={input} /></Field>
            <Field label="Body font"><input value={draft.font_body} onChange={e => up('font_body', e.target.value)} className={input} /></Field>
          </div>

          <Field label="Custom domain (optional)"><input value={draft.custom_domain ?? ''} onChange={e => up('custom_domain', e.target.value || null)} className={input} placeholder="example.com" /></Field>
          <Field label="Enquire URL">
            <input
              value={draft.enquire_url}
              onChange={e => up('enquire_url', e.target.value)}
              className={input}
              placeholder="https://humblehouseauto.com"
            />
            <p className="text-xs text-[var(--color-muted)] mt-1">
              Where the public "Enquire" button on this builder's landing points to.
            </p>
          </Field>
        </section>

        <section className="mb-8">
          <h2 className="text-sm font-medium mb-2">Process stages</h2>
          <div className="space-y-2">
            {(draft.process_copy ?? []).map((s, i) => (
              <div key={i} className="grid grid-cols-[160px_1fr] gap-2">
                <input value={s.label} onChange={e => updateStage(i, { label: e.target.value })} className={input} />
                <input value={s.copy} onChange={e => updateStage(i, { copy: e.target.value })} className={input} />
              </div>
            ))}
          </div>
        </section>

        <button
          onClick={() => save.mutate(draft)}
          disabled={save.isPending || synced}
          className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-50"
        >
          {save.isPending ? <Spinner size={13} /> : <Check size={14} />}
          {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : 'Save brand'}
        </button>
        {save.error && <p className="mt-2 text-xs text-[var(--color-danger)]">{(save.error as Error).message}</p>}
        </fieldset>
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
