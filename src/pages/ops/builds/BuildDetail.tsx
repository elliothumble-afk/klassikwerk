import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router'
import { FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'

interface BuildDoc {
  id: string
  storage_path: string
  caption: string | null
  created_at: string
}

export function BuildDetail() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data: build, isLoading } = useQuery({
    queryKey: ['build-detail', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('builds')
        .select(`
          id, stage, price_cents, created_at, builder_id,
          platform:catalog_platforms(name, chassis, years),
          tier:catalog_tiers(name, base_price_cents, lead_time_weeks)
        `)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as {
        id: string
        stage: string
        price_cents: number | null
        created_at: string
        builder_id: string
        platform: { name: string; chassis: string; years: string } | null
        tier: { name: string; base_price_cents: number | null; lead_time_weeks: number | null } | null
      }
    },
  })

  const { data: documents } = useQuery({
    queryKey: ['build-docs', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('media')
        .select('id, storage_path, caption, created_at')
        .eq('build_id', id!)
        .eq('kind', 'document')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BuildDoc[]
    },
  })

  const generate = useMutation({
    mutationFn: async () => {
      setErr(null)
      const { data, error } = await supabase.functions.invoke('render-contract', {
        body: { build_id: id },
      })
      if (error) throw error
      return data as { url?: string; path?: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['build-docs', id] })
    },
    onError: (e: Error) => setErr(e.message),
    onSettled: () => setGenerating(false),
  })

  if (isLoading || !build) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <Link to="/ops/builds" className="text-xs text-[var(--color-muted)] hover:underline">← Builds</Link>
        <h1 className="text-2xl mt-2 mb-4" style={{ fontFamily: 'var(--font-display)' }}>
          Build {build.id.slice(0, 8)}
        </h1>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <Row label="Platform" value={build.platform ? `${build.platform.name} · ${build.platform.chassis}` : '—'} />
          <Row label="Tier" value={build.tier?.name ?? '—'} />
          <Row label="Stage" value={build.stage} />
          <Row label="Total" value={build.price_cents != null ? `$${(build.price_cents / 100).toLocaleString()}` : '—'} />
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Contract</h2>
            <button
              onClick={() => { setGenerating(true); generate.mutate() }}
              disabled={generating}
              className="h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {generating && <Spinner size={13} />}
              Generate contract
            </button>
          </div>
          {err && <p className="text-xs text-[var(--color-danger)] mb-2">{err}</p>}
          <ul className="space-y-1">
            {(documents ?? []).length === 0 ? (
              <li className="text-xs text-[var(--color-muted)]">No generated contracts yet.</li>
            ) : (
              documents!.map(d => (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-2">
                    <FileText size={14} className="text-[var(--color-muted)]" />
                    {d.caption ?? d.storage_path}
                  </span>
                  <a
                    href={supabase.storage.from('media').getPublicUrl(d.storage_path).data.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[var(--color-accent)] hover:underline"
                  >
                    Open PDF
                  </a>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  )
}
