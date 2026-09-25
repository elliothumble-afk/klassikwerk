import { Navigate, Outlet } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import type { Profile } from '@/types/database'

interface Props {
  role: Profile['role']
}

export function RoleGuard({ role }: Props) {
  const { profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-[var(--color-muted)] text-sm">Loading…</span>
      </div>
    )
  }

  if (!profile || profile.role !== role) {
    return <Navigate to="/auth/login" replace />
  }

  return <Outlet />
}
