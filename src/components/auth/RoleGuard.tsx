import { Navigate, Outlet } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import type { Profile } from '@/types/database'

interface Props {
  role?: Profile['role']
  roles?: Profile['role'][]
}

export function RoleGuard({ role, roles }: Props) {
  const { profile, loading } = useAuth()
  const allowed = roles ?? (role ? [role] : [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-[var(--color-muted)] text-sm">Loading…</span>
      </div>
    )
  }

  if (!profile || !allowed.includes(profile.role)) {
    return <Navigate to="/auth/login" replace />
  }

  return <Outlet />
}
