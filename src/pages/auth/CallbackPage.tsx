import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '@/lib/supabase'

export function CallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
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
