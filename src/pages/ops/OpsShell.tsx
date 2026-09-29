import { Outlet, NavLink, useNavigate } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { LayoutGrid, LogOut } from 'lucide-react'

export function OpsShell() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/auth/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-background)]">
      {/* Sidebar */}
      <nav className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
        <div className="px-5 py-5 border-b border-[var(--color-border)]">
          <span
            className="text-lg text-[var(--color-foreground)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            KlassikWerk
          </span>
          <span className="block text-xs text-[var(--color-muted)] mt-0.5">Operations</span>
        </div>

        <div className="flex-1 py-4 px-3 space-y-0.5">
          <NavLink
            to="/ops/catalog"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] text-sm transition
              ${isActive
                ? 'bg-[var(--color-accent-light)] text-[var(--color-accent)] font-medium'
                : 'text-[var(--color-foreground)] hover:bg-[var(--color-surface-raised)]'
              }`
            }
          >
            <LayoutGrid size={15} />
            Catalog
          </NavLink>
        </div>

        <div className="px-3 py-4 border-t border-[var(--color-border)]">
          <div className="px-3 mb-2">
            <p className="text-xs text-[var(--color-muted)] truncate">
              {profile?.full_name ?? 'Ops user'}
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

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
