import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '@/lib/supabase'

export function CallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    // Recovery links land here when redirectTo is /auth/callback.
    // Preserve the full hash so Supabase can exchange the token.
    const hash = window.location.hash
    const params = new URLSearchParams(hash.slice(1))
    if (params.get('type') === 'recovery') {
      window.location.replace('/auth/reset-password' + hash)
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate('/auth/login', { replace: true })
        return
      }

      supabase
        .from('profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .single()
        .then(({ data }) => {
          if (data?.role === 'ops') {
            navigate('/ops/catalog', { replace: true })
          } else {
            navigate('/portal', { replace: true })
          }
        })
    })
  }, [navigate])

  return (
    <main className="min-h-screen flex items-center justify-center">
      <span className="text-sm text-[var(--color-muted)]">Signing you in…</span>
    </main>
  )
}
