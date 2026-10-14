import { Outlet, NavLink, useNavigate } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { LayoutGrid, LogOut, Building2, Wrench, FileText, Users, Receipt, Home, Link as LinkIcon } from 'lucide-react'
import { OpsBuilderSelectionProvider, useOpsBuilderSelection } from '@/lib/opsBuilderSelection'

export function OpsShell() {
  return (
    <OpsBuilderSelectionProvider>
      <OpsShellInner />
    </OpsBuilderSelectionProvider>
  )
}

function OpsShellInner() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { builders, selected, setSelectedId, loading } = useOpsBuilderSelection()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/auth/login', { replace: true })
  }

  const isOperator = profile?.role === 'operator'

  return (
    <div className="flex min-h-screen bg-[var(--color-background)]">
      <nav className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
        <div className="px-5 py-5 border-b border-[var(--color-border)]">
          <span
            className="text-lg text-[var(--color-foreground)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Humble House
          </span>
          <span className="block text-xs text-[var(--color-muted)] mt-0.5">Operations</span>
        </div>

        {/* Builder switcher */}
        <div className="px-3 pt-3">
          <label className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] block mb-1 px-1">
            Builder
          </label>
          <select
            value={selected?.id ?? ''}
            disabled={loading || builders.length === 0}
            onChange={e => setSelectedId(e.target.value)}
            className="w-full h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          >
            {builders.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}{b.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 py-4 px-3 space-y-0.5">
          <NavItem to="/ops" icon={<Home size={15} />}>Dashboard</NavItem>
          <NavItem to="/ops/leads" icon={<Users size={15} />}>Leads</NavItem>
          <NavItem to="/ops/quotes" icon={<Receipt size={15} />}>Quotes</NavItem>
          <NavItem to="/ops/builds" icon={<Wrench size={15} />}>Builds</NavItem>
          <NavItem to="/ops/catalog" icon={<LayoutGrid size={15} />}>Catalog</NavItem>
          {isOperator && (
            <>
              <div className="mt-4 mb-1 px-3 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Operator</div>
              <NavItem to="/ops/builders" icon={<Building2 size={15} />}>Builders</NavItem>
              <NavItem to="/ops/settings/zoho" icon={<LinkIcon size={15} />}>Zoho sync</NavItem>
            </>
          )}
          {selected && (
            <>
              <div className="mt-4 mb-1 px-3 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                {selected.name}
              </div>
              <NavItem to={`/ops/builders/${selected.id}/brand`} icon={<FileText size={15} />}>Brand</NavItem>
              <NavItem to={`/ops/builders/${selected.id}/terms`} icon={<FileText size={15} />}>Terms</NavItem>
              <NavItem to={`/ops/builders/${selected.id}/contract`} icon={<FileText size={15} />}>Contract</NavItem>
            </>
          )}
        </div>

        <div className="px-3 py-4 border-t border-[var(--color-border)]">
          <div className="px-3 mb-2">
            <p className="text-xs text-[var(--color-muted)] truncate">
              {profile?.full_name ?? profile?.role ?? 'Ops user'}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-[var(--radius-sm)] text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-foreground)] transition"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </nav>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

function NavItem({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] text-sm transition
         ${isActive
           ? 'bg-[var(--color-accent-light)] text-[var(--color-accent)] font-medium'
           : 'text-[var(--color-foreground)] hover:bg-[var(--color-surface-raised)]'
         }`
      }
    >
      {icon}
      {children}
    </NavLink>
  )
}
