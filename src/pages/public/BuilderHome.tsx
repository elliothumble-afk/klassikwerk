import { Link, useLocation } from 'react-router'
import { useBuilder } from '@/lib/builderContext'

export function BuilderHome() {
  const { bundle } = useBuilder()
  const location = useLocation()
  const prefix = location.pathname.startsWith('/b/') ? `/b/${bundle!.builder.slug}` : ''

  if (!bundle) return null
  const { brand, terms } = bundle

  return (
    <>
      <section className="max-w-4xl mx-auto px-6 pt-16 pb-10">
        <h1
          className="text-4xl sm:text-5xl text-[var(--color-foreground)] leading-tight mb-5"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {brand.tagline ?? bundle.builder.name}
        </h1>
        {brand.hero_copy && (
          <p className="text-lg text-[var(--color-muted)] max-w-2xl mb-8">
            {brand.hero_copy}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Link
            to={`${prefix}/configure`}
            className="inline-flex items-center h-10 px-5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90 transition"
          >
            Start a configuration
          </Link>
          <Link
            to={`${prefix}/process`}
            className="inline-flex items-center h-10 px-5 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm hover:bg-[var(--color-surface)] transition"
          >
            How it works
          </Link>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-10">
        <div className="grid gap-6 sm:grid-cols-3">
          <Card
            label="Reservation"
            value={`${formatCurrency(terms.reservation_cents, terms.currency)} refundable deposit`}
          />
          <Card label="Lead time" value={terms.lead_time_copy ?? 'Contact us'} />
          <Card label="Warranty" value={terms.warranty_text ?? 'Workmanship warranty'} />
        </div>
      </section>
    </>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)] mb-2">{label}</div>
      <div className="text-sm text-[var(--color-foreground)]">{value}</div>
    </div>
  )
}

export function formatCurrency(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100)
}
