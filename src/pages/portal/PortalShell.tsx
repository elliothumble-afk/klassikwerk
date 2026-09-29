import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router'

export function PortalShell() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/auth/login', { replace: true })
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <h1
        className="text-3xl text-[var(--color-foreground)] mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Customer portal
      </h1>
      <p className="text-sm text-[var(--color-muted)] mb-8">
        Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}. Phase 2 content coming soon.
      </p>
      <button
        onClick={handleSignOut}
        className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] underline underline-offset-2"
      >
        Sign out
      </button>
    </main>
  )
}
