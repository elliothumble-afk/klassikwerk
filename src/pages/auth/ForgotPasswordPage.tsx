import { useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'

type State = 'idle' | 'loading' | 'sent' | 'error'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setState('loading')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback`,
    })
    if (error) {
      setErrorMsg(error.message)
      setState('error')
    } else {
      setState('sent')
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-[var(--color-background)]">
      <div className="w-full max-w-sm">
        <h1
          className="text-3xl text-[var(--color-foreground)] mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Reset password
        </h1>
        <p className="text-sm text-[var(--color-muted)] mb-8">
          Enter your email and we'll send a reset link.
        </p>

        {state === 'sent' ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-[var(--radius-md)] bg-[var(--color-accent-light)] p-5 text-sm text-[var(--color-accent)]">
              Check your inbox — a reset link is on its way to <strong>{email}</strong>.
            </div>
            <Link
              to="/auth/login"
              className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition"
            >
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reset-email" className="text-sm font-medium">Email</label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="
                  h-10 px-3 w-full rounded-[var(--radius-md)]
                  border border-[var(--color-border)]
                  bg-[var(--color-surface)]
                  text-sm text-[var(--color-foreground)]
                  placeholder:text-[var(--color-muted)]
                  focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent
                  transition
                "
              />
            </div>

            {state === 'error' && (
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
              Send reset link
            </button>

            <Link
              to="/auth/login"
              className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition"
            >
              ← Back to sign in
            </Link>
          </form>
        )}
      </div>
    </main>
  )
}
