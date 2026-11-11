import { useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Builder } from '@/types/database'

interface Props {
  builder: Builder
}

interface JobRow {
  jobname: string
  schedule: string
  active: boolean
  last_run_at: string | null
  last_run_status: string | null
}

// Which of the fleet-wide cron jobs apply to THIS builder. Rules
// mirror the WHERE clauses baked into supabase/migrations/202611110900.
function appliesTo(builder: Builder, hasBackfillUrl: boolean): Record<string, boolean> {
  return {
    'nightly-sync-builder-catalog': builder.active && builder.catalog_source === 'shopify',
    'daily-fx-refresh': true,  // fleet-wide; FX function filters internally on fx_auto
    'weekly-connect-backfill': builder.active && hasBackfillUrl,
  }
}

// Compute the next UTC occurrence of a simple cron expression:
//   "minute hour day-of-month month day-of-week"
// Only supports the forms we actually schedule:
//   "0 7 * * *" (daily)   /  "0 9 * * 0" (weekly Sunday)
//   "0 10 * * *" (daily)
// Returns null for anything else so we can degrade gracefully.
function nextRunUtc(expr: string, from = new Date()): Date | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [m, h, dom, mon, dow] = parts
  if (mon !== '*') return null
  const minute = Number(m); const hour = Number(h)
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute, 0, 0))
  if (dom === '*' && dow === '*') {
    // Daily. If today's slot already passed, bump to tomorrow.
    if (d <= from) d.setUTCDate(d.getUTCDate() + 1)
    return d
  }
  if (dom === '*' && /^[0-6]$/.test(dow)) {
    // Weekly on a given weekday (0 = Sunday).
    const target = Number(dow)
    let delta = (target - d.getUTCDay() + 7) % 7
    if (delta === 0 && d <= from) delta = 7
    d.setUTCDate(d.getUTCDate() + delta)
    return d
  }
  return null
}

function scheduleHuman(expr: string): string {
  // Short human form for the row: "Daily at 07:00 UTC", "Sundays at 09:00 UTC".
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr
  const [m, h, dom, , dow] = parts
  const time = `${h.padStart(2, '0')}:${m.padStart(2, '0')} UTC`
  if (dom === '*' && dow === '*') return `Daily at ${time}`
  if (dom === '*' && /^[0-6]$/.test(dow)) {
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(dow)]
    return `${day} at ${time}`
  }
  return expr
}

const JOB_LABELS: Record<string, string> = {
  'nightly-sync-builder-catalog': 'Catalog sync',
  'daily-fx-refresh': 'FX refresh',
  'weekly-connect-backfill': 'Connect backfill',
}

export function ScheduledJobsPanel({ builder }: Props) {
  const { data: secrets } = useQuery({
    queryKey: ['builder-secrets-sched', builder.id],
    queryFn: async () => {
      const { data } = await supabase.from('builder_secrets')
        .select('backfill_url').eq('builder_id', builder.id).maybeSingle()
      return (data as { backfill_url: string | null } | null) ?? null
    },
  })
  const hasBackfill = Boolean(secrets?.backfill_url)

  const { data: jobs } = useQuery({
    queryKey: ['scheduled-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('scheduled_jobs_public').select('*')
      if (error) throw error
      return (data ?? []) as JobRow[]
    },
    staleTime: 60_000,
  })

  const applies = appliesTo(builder, hasBackfill)
  const relevant = (jobs ?? []).filter(j => applies[j.jobname])
  if (relevant.length === 0) return null

  const now = new Date()

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
      <h2 className="text-sm font-medium mb-3 flex items-center gap-1.5"><Clock size={14} /> Scheduled jobs</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-[var(--color-muted)]">
            <th className="text-left py-1">Job</th>
            <th className="text-left py-1">Schedule</th>
            <th className="text-left py-1">Last run</th>
            <th className="text-left py-1">Next run</th>
          </tr>
        </thead>
        <tbody>
          {relevant.map(j => {
            const next = nextRunUtc(j.schedule, now)
            return (
              <tr key={j.jobname} className="border-t border-[var(--color-border)]">
                <td className="py-1.5">{JOB_LABELS[j.jobname] ?? j.jobname}</td>
                <td className="py-1.5 text-xs text-[var(--color-muted)]">{scheduleHuman(j.schedule)}</td>
                <td className="py-1.5 text-xs">
                  {j.last_run_at ? (
                    <>
                      <span className={j.last_run_status === 'failed' ? 'text-[var(--color-danger)]' : ''}>
                        {new Date(j.last_run_at).toLocaleString()}
                      </span>
                      {j.last_run_status && (
                        <span className="ml-1 text-[var(--color-muted)]">({j.last_run_status})</span>
                      )}
                    </>
                  ) : <span className="text-[var(--color-muted)]">never</span>}
                </td>
                <td className="py-1.5 text-xs">
                  {next ? next.toLocaleString() : <span className="text-[var(--color-muted)]">—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-[var(--color-muted)] mt-2">
        All schedules run in UTC. 07:00 UTC ≈ 02–03:00 America/New_York depending on daylight saving.
      </p>
    </div>
  )
}
