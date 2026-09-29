import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'

type State = 'waiting' | 'ready' | 'loading' | 'done' | 'error' | 'expired'

const inputClass = `
  h-10 px-3 w-full rounded-[var(--radius-md)]
  border border-[var(--color-border)]
  bg-[var(--color-surface)]
  text-sm text-[var(--color-foreground)]
  placeholder:text-[var(--color-muted)]
  focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent
  transition
`

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<State>('waiting')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    // Supabase auto-processes the hash on load. Listen for the recovery event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setState('ready')
      }
    })

    // Also handle the case where the session was already exchanged before this
    // component mounted (e.g. fast reload or redirect from /auth/callback).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setState('ready')
    })

    return () => subscription.unsubscribe()
  }, [])

  // If after 5 s there's still no recovery session, the token is missing/expired.
  useEffect(() => {
    if (state !== 'waiting') return
    const t = setTimeout(() => setState('expired'), 5000)
    return () => clearTimeout(t)
  }, [state])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setErrorMsg('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.')
      return
    }

    setState('loading')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setErrorMsg(error.message)
      setState('ready')
      return
    }

    setState('done')
    setTimeout(() => navigate('/auth/login', { replace: true }), 2500)
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-[var(--color-background)]">
      <div className="w-full max-w-sm">
        <h1
          className="text-3xl text-[var(--color-foreground)] mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          New password
        </h1>

        {state === 'waiting' && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)] mt-6">
            <Spinner size={16} className="text-[var(--color-muted)]" />
            Verifying reset link…
          </div>
        )}

        {state === 'expired' && (
          <div className="flex flex-col gap-4 mt-6">
            <p className="text-sm text-[var(--color-danger)]">
              This link has expired or is invalid.
            </p>
            <Link
              to="/auth/forgot-password"
              className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition"
            >
              Request a new reset link →
            </Link>
          </div>
        )}

        {state === 'done' && (
          <div className="rounded-[var(--radius-md)] bg-[var(--color-accent-light)] p-5 text-sm text-[var(--color-accent)] mt-6">
            Password updated. Redirecting to sign in…
          </div>
        )}

        {(state === 'ready' || state === 'loading') && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-6">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="new-password" className="text-sm font-medium">New password</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete="new-password"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirm-password" className="text-sm font-medium">Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setErrorMsg('') }}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                className={inputClass}
              />
            </div>

            {errorMsg && (
              <p className="text-sm text-[var(--color-danger)]">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={state === 'loading'}
              className="
                h-10 px-4 rounded-[var(--radius-md)]
                bg-[var(--color-accent)] text-white text-sm font-medium
                hover:bg-[var(--color-accent-hover)]
                disabled:opacity-50
                flex items-center justify-center gap-2
                transition
              "
            >
              {state === 'loading' && <Spinner size={16} />}
              Set new password
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
