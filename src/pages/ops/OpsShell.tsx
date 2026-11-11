import { useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { LayoutGrid, LogOut, Building2, Wrench, FileText, Users, Receipt, Home, Link as LinkIcon } from 'lucide-react'
import { OpsBuilderSelectionProvider, useOpsBuilderSelection } from '@/lib/opsBuilderSelection'

const HOME_VALUE = '__home__'

// Classify pathnames into the three navigation scopes:
//   • cross:   "My homepage" mode — /ops, /ops/commissions, /ops/me,
//              /ops/settings/*, /ops/builders (list only, no :id).
//   • builder: a specific builder's page — /ops/builders/:id/*.
//   • scoped:  a builder-scoped page that doesn't name the builder in
//              the URL (/ops/dashboard, /ops/leads, /ops/quotes,
//              /ops/builds, /ops/catalog, /ops/quotes/:id,
//              /ops/leads/:id, /ops/builds/:id). These require a
//              builder to be selected; if none is, send the user to
//              /ops (My homepage).
type Scope = { kind: 'cross' } | { kind: 'builder'; id: string } | { kind: 'scoped' }

function classifyPath(pathname: string): Scope {
  if (pathname === '/ops' || pathname === '/ops/') return { kind: 'cross' }
  if (pathname.startsWith('/ops/commissions')) return { kind: 'cross' }
  if (pathname === '/ops/me' || pathname.startsWith('/ops/me/')) return { kind: 'cross' }
  if (pathname.startsWith('/ops/settings/')) return { kind: 'cross' }
  if (pathname === '/ops/builders' || pathname === '/ops/builders/new') return { kind: 'cross' }
  const m = pathname.match(/^\/ops\/builders\/([0-9a-f-]{36})(?:\/|$)/i)
  if (m) return { kind: 'builder', id: m[1] }
  // Everything else under /ops is treated as builder-scoped.
  if (pathname.startsWith('/ops/')) return { kind: 'scoped' }
  return { kind: 'cross' }
}

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
  const qc = useQueryClient()
  const { builders, allBuilders, selected, setSelectedId, loading } = useOpsBuilderSelection()

  // URL is the source of truth for scope. Keep the dropdown in sync.
  // Builder-id routes pin the dropdown to that builder; cross-builder
  // routes reset it to My homepage. builder-scoped-no-id routes
  // (/ops/dashboard etc.) leave the dropdown alone — the persisted
  // selection carries through so a reload on /ops/leads stays on the
  // same builder (rule 5).
  useEffect(() => {
    const scope = classifyPath(location.pathname)
    if (scope.kind === 'cross' && selected) {
      setSelectedId(null)
    } else if (scope.kind === 'builder' && selected?.id !== scope.id) {
      // Only pin the Workspace dropdown to an ACTIVE builder.
      // Admins can still deep-link to an inactive builder's brand/
      // terms/contract pages (reached via Operator → Builders) —
      // the content renders, but the sidebar stays on My homepage
      // because the dropdown deliberately hides inactive rows.
      const b = allBuilders.find(x => x.id === scope.id)
      if (b?.active) setSelectedId(scope.id)
    } else if (scope.kind === 'scoped' && !selected && !loading) {
      // Builder-scoped URL with no selection — bounce to My homepage.
      navigate('/ops', { replace: true })
    }
    // Intentionally omit setSelectedId/navigate from deps; they're
    // stable callback identities from React Router / providers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, selected?.id, loading, allBuilders.length])

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/auth/login', { replace: true })
  }

  const isOperator = profile?.role === 'operator'
  const atHome = !selected

  // Dropdown change: immediate navigation + full react-query reset so
  // no stale builder-scoped data leaks into the new scope.
  function onSelectChange(value: string) {
    // Reset FIRST so pending queries from the old scope are cancelled
    // before the new route's queries fire.
    qc.resetQueries()
    if (value === HOME_VALUE || value === '') {
      setSelectedId(null)
      navigate('/ops')
    } else {
      setSelectedId(value)
      navigate('/ops/dashboard')
    }
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-background)]">
      <nav data-testid="ops-nav" className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
        <div className="px-5 py-5 border-b border-[var(--color-border)]">
          <span
            className="text-lg text-[var(--color-foreground)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Humble House
          </span>
          <span className="block text-xs text-[var(--color-muted)] mt-0.5">Operations</span>
        </div>

        {/* Workspace switcher — first entry is "My homepage" (null selection) */}
        <div className="px-3 pt-3">
          <label className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] block mb-1 px-1">
            Workspace
          </label>
          <select
            data-testid="workspace-select"
            value={selected?.id ?? HOME_VALUE}
            disabled={loading}
            onChange={e => onSelectChange(e.target.value)}
            className="w-full h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          >
            <option value={HOME_VALUE}>My homepage</option>
            {/* Active builders only. Inactive rows live at
                Operator → Builders and never appear in the
                Workspace surface. */}
            {builders.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 py-4 px-3 space-y-0.5" data-testid="ops-menu" data-mode={atHome ? 'home' : 'builder'}>
          {atHome ? (
            // ─── My homepage menu (cross-builder only) ────────────────
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
            // ─── Builder-scoped menu — no cross-builder links ─────────
            // Switching workspace is the only exit. "Home" intentionally
            // removed; use the dropdown to return to My homepage.
            <>
              <NavItem to="/ops/dashboard" icon={<LayoutGrid size={15} />}>Dashboard</NavItem>
              <NavItem to="/ops/leads" icon={<Users size={15} />}>Leads</NavItem>
              <NavItem to="/ops/quotes" icon={<Receipt size={15} />}>Quotes</NavItem>
              <NavItem to="/ops/builds" icon={<Wrench size={15} />}>Builds</NavItem>
              <NavItem to="/ops/catalog" icon={<LayoutGrid size={15} />}>Catalog</NavItem>
              <NavItem to={`/ops/builders/${selected.id}/brand`} icon={<FileText size={15} />}>Brand</NavItem>
              <NavItem to={`/ops/builders/${selected.id}/terms`} icon={<FileText size={15} />}>Terms</NavItem>
              <NavItem to={`/ops/builders/${selected.id}/contract`} icon={<FileText size={15} />}>Contract</NavItem>
              <NavItem to={`/ops/builders/${selected.id}/costing`} icon={<FileText size={15} />}>Costing</NavItem>
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
