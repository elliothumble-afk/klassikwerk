import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import type { ZohoSyncLog } from '@/types/database'

export function ZohoSettings() {
  const [showSecret, setShowSecret] = useState(false)
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const webhookUrl = `${supabaseUrl}/functions/v1/zoho-lead-webhook`

  const { data: logs, isLoading, refetch } = useQuery({
    queryKey: ['zoho-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zoho_sync_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as ZohoSyncLog[]
    },
    refetchInterval: 10_000,
  })

  const lastSuccess = logs?.find(l => l.status === 'success')
  const connected = Boolean(lastSuccess)

  async function retry(entry: ZohoSyncLog) {
    const kind = entry.object
    if (entry.direction === 'outbound' && (kind === 'quote_sent' || kind === 'quote_approved')) {
      const p = entry.payload as { quote_id?: string }
      await supabase.functions.invoke('zoho-push', { body: { kind, quote_id: p.quote_id } })
    } else if (entry.direction === 'outbound' && kind === 'lead_stage_changed') {
      const p = entry.payload as { lead_id?: string }
      await supabase.functions.invoke('zoho-push', { body: { kind, lead_id: p.lead_id } })
    }
    refetch()
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-display)' }}>Zoho sync</h1>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-muted)]'}`}
            />
            <span className="text-sm font-medium">
              {connected ? 'Connected' : 'Not connected'}
            </span>
            {lastSuccess && (
              <span className="text-xs text-[var(--color-muted)]">
                Last success {new Date(lastSuccess.created_at).toLocaleString()}
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--color-muted)]">
            Configure secrets with the Supabase CLI (see README). Required:
            <code className="mx-1">ZOHO_CLIENT_ID</code>,
            <code className="mx-1">ZOHO_CLIENT_SECRET</code>,
            <code className="mx-1">ZOHO_REFRESH_TOKEN</code>,
            <code className="mx-1">ZOHO_DC</code> (default <code>us</code>),
            <code className="mx-1">ZOHO_WEBHOOK_SECRET</code>.
          </p>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
          <h2 className="text-sm font-medium mb-2">Webhook URL</h2>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            Paste this into the Zoho CRM Workflow Rule → Webhook action. Append your
            webhook secret as <code>?secret=...</code> (or send it in <code>X-Zoho-Secret</code>).
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--color-background)] border border-[var(--color-border)] overflow-x-auto whitespace-nowrap">
              {webhookUrl}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(webhookUrl)}
              className="h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-xs inline-flex items-center gap-1 hover:bg-[var(--color-surface-raised)]"
            >
              <Copy size={12} /> Copy
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setShowSecret(s => !s)}
              className="text-xs text-[var(--color-accent)] hover:underline"
            >
              {showSecret ? 'Hide' : 'Show'} secret placeholder
            </button>
            {showSecret && (
              <code className="text-xs text-[var(--color-muted)]">
                ?secret={'{{ZOHO_WEBHOOK_SECRET}}'}
              </code>
            )}
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <h2 className="text-sm font-medium">Recent sync log</h2>
            <button
              onClick={() => refetch()}
              className="h-8 px-2 rounded-[var(--radius-sm)] text-xs inline-flex items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {isLoading ? (
            <div className="p-6"><Spinner size={16} className="text-[var(--color-muted)]" /></div>
          ) : (logs ?? []).length === 0 ? (
            <div className="p-6 text-sm text-[var(--color-muted)]">No sync activity yet.</div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)] max-h-[400px] overflow-auto">
              {logs!.map(l => (
                <li key={l.id} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--color-muted)]">
                      {new Date(l.created_at).toLocaleString()} · {l.direction} · {l.object}
                    </div>
                    <div className={`text-sm ${l.status === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-foreground)]'}`}>
                      {l.status}{l.error ? ` — ${l.error}` : ''}
                    </div>
                  </div>
                  {l.status === 'error' && l.direction === 'outbound' && (
                    <button
                      onClick={() => retry(l)}
                      className="text-xs text-[var(--color-accent)] hover:underline shrink-0"
                    >
                      Retry
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
