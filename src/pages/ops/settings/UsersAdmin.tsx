import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'

interface StaffRow {
  id: string
  user_id: string | null
  full_name: string | null
  role: 'customer' | 'ops' | 'operator' | 'partner'
  active: boolean
  email: string | null
}

// UI role labels. admin ↔ operator, rep ↔ ops.
const UI_ROLES = [
  { ui: 'admin', db: 'operator' },
  { ui: 'rep',   db: 'ops' },
] as const
type UiRole = (typeof UI_ROLES)[number]['ui']
function toUi(db: string): UiRole | null {
  const m = UI_ROLES.find(r => r.db === db)
  return m?.ui ?? null
}
function toDb(ui: UiRole): string {
  return UI_ROLES.find(r => r.ui === ui)!.db
}

export function UsersAdmin() {
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<UiRole>('rep')
  const [editing, setEditing] = useState<Record<string, { name: string; role: UiRole }>>({})

  const { data: rows, isLoading } = useQuery({
    queryKey: ['users-admin'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_profiles')
        .select('id, user_id, full_name, role, active, email')
        .in('role', ['ops', 'operator'])
        .order('role')
        .order('full_name')
      if (error) throw error
      return (data ?? []) as unknown as StaffRow[]
    },
  })

  const invite = useMutation({
    mutationFn: async () => {
      if (!inviteEmail || !inviteName) throw new Error('Email and name are required')
      const session = (await supabase.auth.getSession()).data.session
      if (!session?.access_token) throw new Error('No session')
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-staff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email: inviteEmail.trim(), full_name: inviteName.trim(), role: inviteRole }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
    },
    onSuccess: () => {
      setInviteEmail(''); setInviteName(''); setInviteRole('rep'); setErr(null)
      qc.invalidateQueries({ queryKey: ['users-admin'] })
      qc.invalidateQueries({ queryKey: ['commissions-reps'] })
    },
    onError: (e: Error) => setErr(e.message),
  })

  const saveRow = useMutation({
    mutationFn: async ({ row, name, role }: { row: StaffRow; name: string; role: UiRole }) => {
      const upd = await supabase.from('profiles').update({
        full_name: name.trim() || null,
        role: toDb(role),
        updated_at: new Date().toISOString(),
      } as never).eq('id', row.id)
      if (upd.error) throw upd.error
    },
    onSuccess: (_, vars) => {
      setEditing(prev => { const n = { ...prev }; delete n[vars.row.id]; return n })
      qc.invalidateQueries({ queryKey: ['users-admin'] })
      qc.invalidateQueries({ queryKey: ['commissions-reps'] })
    },
    onError: (e: Error) => setErr(e.message),
  })

  const toggleActive = useMutation({
    mutationFn: async (row: StaffRow) => {
      const upd = await supabase.from('profiles').update({
        active: !row.active,
        updated_at: new Date().toISOString(),
      } as never).eq('id', row.id)
      if (upd.error) throw upd.error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-admin'] })
      qc.invalidateQueries({ queryKey: ['commissions-reps'] })
    },
    onError: (e: Error) => setErr(e.message),
  })

  const input = 'h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] text-sm'

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-display)' }}>Users</h1>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-6">
          <h2 className="text-sm font-medium mb-3 flex items-center gap-1.5"><UserPlus size={14} /> Invite</h2>
          <div className="grid grid-cols-[1fr_1fr_120px_auto] gap-2">
            <input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Full name" className={input} />
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@example.com" className={input} />
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as UiRole)} className={input}>
              {UI_ROLES.map(r => <option key={r.ui} value={r.ui}>{r.ui}</option>)}
            </select>
            <button onClick={() => invite.mutate()} disabled={invite.isPending || !inviteEmail || !inviteName}
              className="h-9 px-3 rounded bg-[var(--color-accent)] text-white inline-flex items-center gap-1 disabled:opacity-50">
              {invite.isPending ? <Spinner size={12} /> : <Check size={13} />}
              {invite.isPending ? 'Inviting…' : 'Send invite'}
            </button>
          </div>
          <p className="text-xs text-[var(--color-muted)] mt-2">
            Supabase will email a sign-in link. Admins can manage every builder and settings; reps appear in commission dropdowns.
          </p>
        </div>

        {err && <p className="text-xs text-[var(--color-danger)] mb-3">{err}</p>}

        {isLoading ? <Spinner size={16} /> : (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Role</th>
                  <th className="text-left px-3 py-2">Active</th>
                  <th className="text-right px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map(r => {
                  const uiRole = toUi(r.role)
                  const draft = editing[r.id]
                  const isEditing = Boolean(draft)
                  return (
                    <tr key={r.id} className={`border-b border-[var(--color-border)] last:border-0 ${!r.active ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-1.5">
                        {isEditing ? (
                          <input value={draft.name} onChange={e => setEditing(p => ({ ...p, [r.id]: { ...draft, name: e.target.value } }))}
                            className={`${input} py-1 h-8`} />
                        ) : (r.full_name ?? r.email ?? '—')}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-[var(--color-muted)]">{r.email ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        {isEditing ? (
                          <select value={draft.role} onChange={e => setEditing(p => ({ ...p, [r.id]: { ...draft, role: e.target.value as UiRole } }))}
                            className={`${input} py-1 h-8`}>
                            {UI_ROLES.map(role => <option key={role.ui} value={role.ui}>{role.ui}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs uppercase tracking-wide">{uiRole ?? r.role}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <button onClick={() => toggleActive.mutate(r)}
                          className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5">
                          {r.active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveRow.mutate({ row: r, name: draft.name, role: draft.role })}
                              disabled={saveRow.isPending}
                              className="text-xs bg-[var(--color-accent)] text-white rounded px-2 py-0.5 mr-1 disabled:opacity-50">
                              Save
                            </button>
                            <button onClick={() => setEditing(p => { const n = { ...p }; delete n[r.id]; return n })}
                              className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setEditing(p => ({ ...p, [r.id]: { name: r.full_name ?? '', role: uiRole ?? 'rep' } }))}
                            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5">
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {(rows ?? []).length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-sm text-center text-[var(--color-muted)]">No staff users yet. Invite one above.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
