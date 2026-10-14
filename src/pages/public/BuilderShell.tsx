import { Outlet, Link, useLocation, useParams } from 'react-router'
import { BuilderProvider, useBuilder } from '@/lib/builderContext'
import { Spinner } from '@/components/ui/Spinner'

/**
 * Wraps every builder-scoped public route. Loads the builder (by path slug
 * or by custom-domain match) and renders a consistent header + outlet.
 */
export function BuilderShell({ slugOverride }: { slugOverride?: string | null }) {
  const params = useParams<{ builderSlug: string }>()
  const slug = slugOverride === undefined ? params.builderSlug ?? null : slugOverride

  return (
    <BuilderProvider slug={slug}>
      <BuilderShellInner />
    </BuilderProvider>
  )
}

function BuilderShellInner() {
  const { bundle, loading, error } = useBuilder()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size={20} className="text-[var(--color-muted)]" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6">
        <p className="text-sm text-[var(--color-danger)]">
          {(error as Error).message}
        </p>
      </div>
    )
  }
  if (!bundle) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6">
        <h1
          className="text-2xl text-[var(--color-foreground)] mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Not found
        </h1>
        <p className="text-sm text-[var(--color-muted)] mb-6">
          No active builder matches this URL.
        </p>
      </div>
    )
  }

  const base = `/b/${bundle.builder.slug}`
  const inPath = location.pathname.startsWith('/b/')
  const prefix = inPath ? base : ''

  return (
    <main
      className="min-h-screen"
      style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-foreground)' }}
    >
      <header className="border-b border-[var(--color-border)]">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to={`${prefix}/`}>
            {bundle.brand.logo_url ? (
              <img
                src={bundle.brand.logo_url}
                alt={bundle.brand.wordmark_text ?? bundle.builder.name}
                className="h-7 w-auto"
              />
            ) : (
              <span
                className="text-xl"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {bundle.brand.wordmark_text ?? bundle.builder.name}
              </span>
            )}
          </Link>

          <nav className="flex items-center gap-6 text-sm">
            <Link
              to="/auth/login"
              className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <Outlet />

      <footer className="border-t border-[var(--color-border)] mt-16">
        <div className="max-w-5xl mx-auto px-6 py-6 text-xs text-[var(--color-muted)]">
          © {new Date().getFullYear()} {bundle.builder.legal_name ?? bundle.builder.name}
        </div>
      </footer>
    </main>
  )
}
