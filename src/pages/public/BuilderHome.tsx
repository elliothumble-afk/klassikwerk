import { useQuery } from '@tanstack/react-query'
import { useBuilder } from '@/lib/builderContext'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import { InquiryForm } from '@/pages/public/InquiryForm'
import type { Platform } from '@/types/database'

export function BuilderHome() {
  const { bundle } = useBuilder()

  const { data: platforms } = useQuery({
    queryKey: ['public-platforms', bundle?.builder.id],
    enabled: Boolean(bundle?.builder.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_platforms')
        .select('*')
        .eq('builder_id', bundle!.builder.id)
        .eq('active', true)
        .order('sort')
      if (error) throw error
      return (data ?? []) as Platform[]
    },
  })

  if (!bundle) return null
  const { brand } = bundle

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
          <p className="text-lg text-[var(--color-muted)] max-w-2xl">
            {brand.hero_copy}
          </p>
        )}
      </section>

      <section className="max-w-5xl mx-auto px-6 py-10">
        <h2
          className="text-2xl text-[var(--color-foreground)] mb-6"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Platforms
        </h2>
        {!platforms ? (
          <Spinner size={20} className="text-[var(--color-muted)]" />
        ) : platforms.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">No platforms published yet.</p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {platforms.slice(0, 3).map(platform => (
              <li key={platform.id}>
                <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
                  {platform.hero_image_url ? (
                    <div
                      className="aspect-[4/3] bg-cover bg-center"
                      style={{ backgroundImage: `url(${platform.hero_image_url})` }}
                    />
                  ) : (
                    <div className="aspect-[4/3] bg-[var(--color-surface-raised)]" />
                  )}
                  <div className="p-5">
                    <h3
                      className="text-lg text-[var(--color-foreground)] mb-1"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {platform.name}
                    </h3>
                    <p className="text-xs text-[var(--color-muted)]">
                      {platform.chassis} · {platform.years}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="max-w-5xl mx-auto px-6 py-10">
        <h2
          className="text-2xl text-[var(--color-foreground)] mb-6"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(brand.process_copy ?? []).map((stage, i) => (
            <li
              key={stage.label}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)] mb-1">
                Step {i + 1}
              </div>
              <div className="text-sm font-medium mb-1">{stage.label}</div>
              <div className="text-xs text-[var(--color-muted)]">{stage.copy}</div>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-xl mx-auto px-6 py-16" id="inquire">
        <h2
          className="text-2xl text-[var(--color-foreground)] mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Start the conversation
        </h2>
        <p className="text-sm text-[var(--color-muted)] mb-6">
          Tell us what you're thinking. We'll come back to you by email.
        </p>
        <InquiryForm platforms={platforms ?? []} />
      </section>
    </>
  )
}

export function formatCurrency(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100)
}
