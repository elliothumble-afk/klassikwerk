import { useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation, useMatch } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { LayoutGrid, LogOut, Building2, Wrench, FileText, Users, Receipt, Home, Link as LinkIcon } from 'lucide-react'
import { OpsBuilderSelectionProvider, useOpsBuilderSelection } from '@/lib/opsBuilderSelection'

const HOME_VALUE = '__home__'

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
  const location = useLocation()
  const { builders, selected, setSelectedId, loading } = useOpsBuilderSelection()

  // Routes that are builder-scoped. When the user clicks into one of
  // these (e.g. from a Home activity link) we auto-pin the selector
  // so the sidebar reflects the right context. Conversely, hitting
  // /ops or /ops/me / /ops/commissions / /ops/settings/* is
  // cross-builder, so we leave the selector alone.
  const builderMatch = useMatch('/ops/builders/:id/*')
  useEffect(() => {
    const id = builderMatch?.params?.id
    if (id && selected?.id !== id) setSelectedId(id)
  }, [builderMatch?.params?.id, selected?.id, setSelectedId])

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/auth/login', { replace: true })
  }

  const isOperator = profile?.role === 'operator'
  const atHome = !selected

  // Sidebar dropdown. The first option is "My homepage" (null
  // selection); picking it navigates to /ops and clears the builder
  // context. Picking a builder jumps straight to that builder's
  // dashboard page.
  function onSelectChange(value: string) {
    if (value === HOME_VALUE || value === '') {
      setSelectedId(null)
      navigate('/ops')
    } else {
      setSelectedId(value)
      // If the user is on a cross-builder page, send them to the
      // builder's dashboard; otherwise let them stay where they are
      // (e.g. switching builder while on /ops/leads keeps them on leads).
      if (location.pathname === '/ops' || location.pathname.startsWith('/ops/me')
          || location.pathname.startsWith('/ops/commissions')
          || location.pathname.startsWith('/ops/settings')
          || location.pathname === '/ops/dashboard') {
        navigate('/ops/dashboard')
      }
    }
  }

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

        {/* Builder switcher — first entry is My homepage (null selection) */}
        <div className="px-3 pt-3">
          <label className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] block mb-1 px-1">
            Workspace
          </label>
          <select
            value={selected?.id ?? HOME_VALUE}
            disabled={loading}
            onChange={e => onSelectChange(e.target.value)}
            className="w-full h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          >
            <option value={HOME_VALUE}>My homepage</option>
            {builders.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}{b.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 py-4 px-3 space-y-0.5">
          {atHome ? (
            // ─── Cross-builder menu (My homepage) ─────────────────────
            <>
              <NavItem to="/ops" icon={<Home size={15} />} end>Home</NavItem>
              <NavItem to="/ops/commissions" icon={<Receipt size={15} />}>Commissions</NavItem>
              <NavItem to="/ops/me" icon={<Users size={15} />}>My commissions</NavItem>
              {isOperator && (
                <>
                  <div className="mt-4 mb-1 px-3 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Operator</div>
                  <NavItem to="/ops/builders" icon={<Building2 size={15} />}>Builders</NavItem>
                  <NavItem to="/ops/settings/operator" icon={<Building2 size={15} />}>Operator</NavItem>
                  <NavItem to="/ops/settings/users" icon={<Users size={15} />}>Users</NavItem>
                  <NavItem to="/ops/settings/zoho" icon={<LinkIcon size={15} />}>Zoho sync</NavItem>
                </>
              )}
            </>
          ) : (
            // ─── Builder-scoped menu ──────────────────────────────────
            <>
              <button
                onClick={() => { setSelectedId(null); navigate('/ops') }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] text-sm text-[var(--color-foreground)] hover:bg-[var(--color-surface-raised)] transition"
                title="Return to My homepage (clears builder context)"
              >
                <Home size={15} />
                Home
              </button>
              <NavItem to="/ops/dashboard" icon={<LayoutGrid size={15} />}>Dashboard</NavItem>
              <NavItem to="/ops/leads" icon={<Users size={15} />}>Leads</NavItem>
              <NavItem to="/ops/quotes" icon={<Receipt size={15} />}>Quotes</NavItem>
              <NavItem to="/ops/builds" icon={<Wrench size={15} />}>Builds</NavItem>
              <NavItem to="/ops/catalog" icon={<LayoutGrid size={15} />}>Catalog</NavItem>
              {selected && (
                <>
                  <div className="mt-4 mb-1 px-3 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                    {selected.name}
                  </div>
                  <NavItem to={`/ops/builders/${selected.id}/brand`} icon={<FileText size={15} />}>Brand</NavItem>
                  <NavItem to={`/ops/builders/${selected.id}/terms`} icon={<FileText size={15} />}>Terms</NavItem>
                  <NavItem to={`/ops/builders/${selected.id}/contract`} icon={<FileText size={15} />}>Contract</NavItem>
                  <NavItem to={`/ops/builders/${selected.id}/costing`} icon={<FileText size={15} />}>Costing</NavItem>
                </>
              )}
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

function NavItem({ to, icon, children, end }: { to: string; icon: React.ReactNode; children: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
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
