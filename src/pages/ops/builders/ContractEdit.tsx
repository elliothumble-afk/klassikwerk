import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import { Check } from 'lucide-react'
import type { ContractTemplate } from '@/types/database'
import { SyncPanel } from './SyncPanel'

const KNOWN_FIELDS = [
  'builder_name',
  'builder_legal_name',
  'customer_full_name',
  'customer_address',
  'vehicle_platform',
  'vehicle_vin',
  'vehicle_year',
  'configuration_table',
  'price_total',
  'payment_schedule_table',
  'warranty_text',
  'governing_law',
] as const

const SAMPLE_MERGES: Record<string, string> = {
  builder_name: 'Sample Builder',
  builder_legal_name: 'Sample Builder LLC',
  customer_full_name: 'Jane Driver',
  customer_address: '123 Collector Way, Miami FL',
  vehicle_platform: 'Sample Platform',
  vehicle_vin: 'VIN0000000000000',
  vehicle_year: '2003',
  configuration_table: '| Group | Choice |\n| --- | --- |\n| Exterior Colour | Sample Green |\n| Leather | Sample Greige |',
  price_total: '$87,500.00',
  payment_schedule_table: '| Step | % | Trigger |\n| --- | --- | --- |\n| Contract signing | 50% | contract |\n| Delivery | 50% | delivery |',
  warranty_text: '12 months or 12,000 miles workmanship warranty.',
  governing_law: 'State of Florida',
}

function merge(markdown: string, fields: Record<string, string>): string {
  return markdown.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => fields[key] ?? `[${key}]`)
}

function markdownToHtml(md: string): string {
  // Very small md→html, enough for a live preview. Server-side PDF renderer
  // does the real conversion.
  let html = md
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Tables
  html = html.replace(/((?:^\|.*\|\n?)+)/gm, (block) => {
    const rows = block.trim().split('\n').map(r => r.trim())
    const cells = rows.map(r => r.split('|').slice(1, -1).map(c => c.trim()))
    if (cells.length < 2) return block
    const [header, _, ...rest] = cells
    const headHtml = `<thead><tr>${header.map(h => `<th>${h}</th>`).join('')}</tr></thead>`
    const bodyHtml = `<tbody>${rest.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`
    return `<table>${headHtml}${bodyHtml}</table>`
  })
  html = html.split(/\n{2,}/).map(block => {
    if (/^<h[1-6]|^<table|^<ul|^<ol/.test(block.trim())) return block
    return `<p>${block.replace(/\n/g, '<br/>')}</p>`
  }).join('\n')
  return html
}

export function ContractEdit() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [body, setBody] = useState<string>('')
  const [title, setTitle] = useState<string>('Work Authorization')
  const [bumped, setBumped] = useState(false)

  const { data: builder } = useQuery({
    queryKey: ['builder', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('builders').select('*').eq('id', id!).single()
      if (error) throw error
      return data as import('@/types/database').Builder
    },
  })

  const { data: current, isLoading } = useQuery({
    queryKey: ['contract-current', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('builder_id', id!)
        .eq('is_current', true)
        .maybeSingle()
      if (error) throw error
      return data as ContractTemplate | null
    },
  })

  const synced = Boolean(current?.synced)

  const { data: versions } = useQuery({
    queryKey: ['contract-versions', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('builder_id', id!)
        .order('version', { ascending: false })
      if (error) throw error
      return (data ?? []) as ContractTemplate[]
    },
  })

  useEffect(() => {
    if (current) {
      setBody(current.body_markdown)
      setTitle(current.title)
    }
  }, [current])

  const saveNew = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('No builder id')
      const nextVersion = (versions?.[0]?.version ?? 0) + 1
      // Clear previous current flag
      const { error: clearErr } = await supabase
        .from('contract_templates')
        .update({ is_current: false })
        .eq('builder_id', id)
        .eq('is_current', true)
      if (clearErr) throw clearErr
      const { error } = await supabase.from('contract_templates').insert({
        builder_id: id,
        version: nextVersion,
        title,
        body_markdown: body,
        merge_fields: KNOWN_FIELDS as unknown as string[],
        is_current: true,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setBumped(true)
      qc.invalidateQueries({ queryKey: ['contract-current', id] })
      qc.invalidateQueries({ queryKey: ['contract-versions', id] })
      setTimeout(() => setBumped(false), 2000)
    },
  })

  const previewHtml = useMemo(() => markdownToHtml(merge(body, SAMPLE_MERGES)), [body])

  function insertField(field: string) {
    setBody(prev => `${prev}{{${field}}}`)
  }

  if (isLoading) return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl mb-4" style={{ fontFamily: 'var(--font-display)' }}>Contract template</h1>

        {builder && <SyncPanel builder={builder} />}

        <fieldset disabled={synced} className={synced ? 'opacity-70' : ''}>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="mb-3">
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className="h-9 w-full px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm" />
            </div>
            <div className="mb-2">
              <label className="text-xs text-[var(--color-muted)] mb-1 block">Insert merge field</label>
              <div className="flex gap-1 flex-wrap">
                {KNOWN_FIELDS.map(f => (
                  <button
                    key={f}
                    onClick={() => insertField(f)}
                    className="text-xs px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-raised)]"
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              className="w-full h-[520px] px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] font-mono text-xs"
            />
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => saveNew.mutate()}
                disabled={saveNew.isPending}
                className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-50"
              >
                {saveNew.isPending ? <Spinner size={13} /> : <Check size={14} />}
                {saveNew.isPending ? 'Saving…' : bumped ? `Saved v${versions?.[0]?.version ?? 1}` : `Save as v${(versions?.[0]?.version ?? 0) + 1}`}
              </button>
              <span className="text-xs text-[var(--color-muted)]">
                Current version: v{current?.version ?? '—'}
              </span>
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--color-muted)] mb-1 block">Live preview (sample merge data)</label>
            <div
              className="h-[560px] overflow-auto p-5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
        </fieldset>
      </div>
    </div>
  )
}
