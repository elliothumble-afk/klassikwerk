import { useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import { useNavigate } from 'react-router'

const inputClass = `
  h-10 px-3 w-full rounded-[var(--radius-md)]
  border border-[var(--color-border)]
  bg-[var(--color-surface)]
  text-sm text-[var(--color-foreground)]
  placeholder:text-[var(--color-muted)]
  focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent
  transition
`

type Mode = 'password' | 'magic'
type State = 'idle' | 'loading' | 'sent' | 'error'

function PasswordForm() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setState('loading')
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) {
      setErrorMsg(error.message)
      setState('error')
      return
    }
    const role = data.user
      ? (await supabase.from('profiles').select('role').eq('user_id', data.user.id).single()).data?.role
      : null
    navigate(role === 'ops' ? '/ops/catalog' : '/portal', { replace: true })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pw-email" className="text-sm font-medium">Email</label>
        <input
          id="pw-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          autoComplete="email"
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="pw-password" className="text-sm font-medium">Password</label>
          <Link
            to="/auth/forgot-password"
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition"
          >
            Forgot password?
          </Link>
        </div>
        <input
          id="pw-password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          autoComplete="current-password"
          className={inputClass}
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
        Sign in
      </button>
    </form>
  )
}

function MagicLinkForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setState('loading')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setErrorMsg(error.message)
      setState('error')
    } else {
      setState('sent')
    }
  }

  if (state === 'sent') {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[var(--radius-md)] bg-[var(--color-accent-light)] p-5 text-sm text-[var(--color-accent)]">
          Check your inbox — a login link is on its way to <strong>{email}</strong>.
        </div>
        <button
          onClick={onBack}
          className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] text-left transition"
        >
          ← Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ml-email" className="text-sm font-medium">Email</label>
        <input
          id="ml-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          autoComplete="email"
          className={inputClass}
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
        Send magic link
      </button>

      <button
        type="button"
        onClick={onBack}
        className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] text-left transition"
      >
        ← Back to sign in
      </button>
    </form>
  )
}

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('password')

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-[var(--color-background)]">
      <div className="w-full max-w-sm">
        <h1
          className="text-3xl text-[var(--color-foreground)] mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Sign in
        </h1>
        <p className="text-sm text-[var(--color-muted)] mb-8">
          {mode === 'password' ? 'Welcome back.' : "We'll send a link to your inbox."}
        </p>

        {mode === 'password' ? (
          <>
            <PasswordForm />
            <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
              <button
                onClick={() => setMode('magic')}
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition"
              >
                Send me a magic link instead →
              </button>
            </div>
          </>
        ) : (
          <MagicLinkForm onBack={() => setMode('password')} />
        )}
      </div>
    </main>
  )
}
