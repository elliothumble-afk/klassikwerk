import { Navigate, Outlet } from 'react-router'
import { useAuth } from '@/hooks/useAuth'

export function AuthGuard() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-[var(--color-muted)] text-sm">Loading…</span>
      </div>
    )
  }

  if (!user) return <Navigate to="/auth/login" replace />
  return <Outlet />
}
