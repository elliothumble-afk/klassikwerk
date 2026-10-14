import { Link, useLocation, useSearchParams } from 'react-router'
import { useBuilder } from '@/lib/builderContext'

export function ReserveSuccess() {
  const { bundle } = useBuilder()
  const [params] = useSearchParams()
  const location = useLocation()
  const prefix = location.pathname.startsWith('/b/') ? `/b/${bundle?.builder.slug}` : ''
  const demo = params.get('demo') === '1'

  return (
    <section className="max-w-2xl mx-auto px-6 py-20 text-center">
      <h1
        className="text-3xl text-[var(--color-foreground)] mb-4"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Reservation received
      </h1>
      <p className="text-[var(--color-muted)] mb-6">
        {demo
          ? 'Stripe is not configured in this environment, so no payment was taken. In production, a confirmation email branded for this builder will go out.'
          : `A confirmation email branded for ${bundle?.builder.name ?? 'this builder'} is on its way.`}
      </p>
      <Link
        to={`${prefix}/`}
        className="inline-flex items-center h-10 px-5 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm hover:bg-[var(--color-surface)] transition"
      >
        Back to home
      </Link>
    </section>
  )
}
