import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Beaker } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFn } from '@/lib/fnInvoke'
import { Spinner } from '@/components/ui/Spinner'
import type { Builder, SyncRun } from '@/types/database'

interface Props {
  builder: Builder
}

export function SyncPanel({ builder }: Props) {
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const { data: runs, refetch: refetchRuns } = useQuery({
    queryKey: ['sync-runs', builder.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sync_runs')
        .select('*')
        .eq('builder_id', builder.id)
        .order('started_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return (data ?? []) as SyncRun[]
    },
    refetchInterval: 5000,
  })

  const syncNow = useMutation({
    mutationFn: async () => {
      await invokeFn('sync-builder-catalog', { builder_id: builder.id })
    },
    onSuccess: () => {
      setStatus('Sync complete')
      setErr(null)
      refetchRuns()
      qc.invalidateQueries({ queryKey: ['builder-brand', builder.id] })
      qc.invalidateQueries({ queryKey: ['builder-terms', builder.id] })
      qc.invalidateQueries({ queryKey: ['contract-current', builder.id] })
    },
    onError: e => setErr((e as Error).message),
  })

  const syncFromFixture = useMutation({
    mutationFn: async () => {
      // Loads the fixture JSON shipped under public/fixtures/ and
      // posts it inline so the sync function uses it instead of
      // reaching the Connect feed URL. Dev-only.
      const r = await fetch('/fixtures/ecd-sample.json')
      if (!r.ok) throw new Error('ECD fixture missing from /public/fixtures/')
      const payload = await r.json()
      await invokeFn('sync-builder-catalog', { builder_id: builder.id, payload })
    },
    onSuccess: () => {
      setStatus('Sync from fixture complete')
      setErr(null)
      refetchRuns()
      qc.invalidateQueries({ queryKey: ['builder-brand', builder.id] })
      qc.invalidateQueries({ queryKey: ['builder-terms', builder.id] })
      qc.invalidateQueries({ queryKey: ['contract-current', builder.id] })
    },
    onError: e => setErr((e as Error).message),
  })

  if (builder.catalog_source !== 'connect') return null

  const lastSynced = builder.last_synced_at
    ? new Date(builder.last_synced_at).toLocaleString()
    : 'never'
  const isError = builder.last_sync_status === 'error'
  const pending = syncNow.isPending || syncFromFixture.isPending

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium mb-1">Managed by Connect</h2>
          <p className="text-xs text-[var(--color-muted)]">
            This builder's catalog, brand, terms and contract come from
            {' '}
            <code className="text-[var(--color-foreground)]">{builder.catalog_source_url ?? 'the configured feed URL'}</code>.
            Last synced {lastSynced}.
          </p>
          {isError && builder.last_sync_error && (
            <p className="text-xs text-[var(--color-danger)] mt-2">
              Last sync error: {builder.last_sync_error}
            </p>
          )}
          {status && !isError && <p className="text-xs text-[var(--color-success)] mt-2">{status}</p>}
          {err && <p className="text-xs text-[var(--color-danger)] mt-2">{err}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setStatus(null); setErr(null); syncFromFixture.mutate() }}
            disabled={pending}
            title="Dev: sync from the committed fixture instead of the live feed"
            className="h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm inline-flex items-center gap-1.5 hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
          >
            {syncFromFixture.isPending ? <Spinner size={13} /> : <Beaker size={13} />}
            Sync from fixture
          </button>
          <button
            onClick={() => { setStatus(null); setErr(null); syncNow.mutate() }}
            disabled={pending || !builder.catalog_source_url}
            className="h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50"
          >
            {syncNow.isPending ? <Spinner size={13} /> : <RefreshCw size={13} />}
            Sync now
          </button>
        </div>
      </div>

      {(runs ?? []).length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-[var(--color-muted)] cursor-pointer">Recent runs</summary>
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {runs!.map(r => (
              <li key={r.id} className="py-2 text-xs flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[var(--color-muted)]">
                    {new Date(r.started_at).toLocaleString()}
                  </div>
                  <div className={r.status === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-foreground)]'}>
                    {r.status}{r.error ? ` — ${r.error}` : ''}
                  </div>
                </div>
                {r.counts && (
                  <code className="text-[10px] text-[var(--color-muted)] whitespace-pre text-right">
                    {JSON.stringify(r.counts)}
                  </code>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
