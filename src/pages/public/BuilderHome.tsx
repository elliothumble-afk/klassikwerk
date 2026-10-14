import { useQuery } from '@tanstack/react-query'
import { useBuilder } from '@/lib/builderContext'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import type { Platform } from '@/types/database'

interface GalleryItem {
  id: string
  platform_id: string
  image_url: string
  caption: string | null
}

const DEFAULT_ENQUIRE_URL = 'https://humblehouseauto.com'

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

  const { data: gallery } = useQuery({
    queryKey: ['public-gallery', bundle?.builder.id],
    enabled: Boolean(bundle?.builder.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_platform_gallery')
        .select('id, platform_id, image_url, caption')
        .eq('builder_id', bundle!.builder.id)
        .order('sort')
      if (error) throw error
      return (data ?? []) as GalleryItem[]
    },
  })

  if (!bundle) return null
  const { brand } = bundle
  const enquireUrl = brand.enquire_url || DEFAULT_ENQUIRE_URL

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
        <a
          href={enquireUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center h-10 px-5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90 transition"
        >
          Enquire
        </a>
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

      {(gallery?.length ?? 0) > 0 && (
        <section className="max-w-5xl mx-auto px-6 py-10">
          <h2
            className="text-2xl text-[var(--color-foreground)] mb-6"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Gallery
          </h2>
          <ul className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {gallery!.map(item => (
              <li
                key={item.id}
                className="aspect-[4/3] overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-raised)]"
                title={item.caption ?? undefined}
              >
                <img
                  src={item.image_url}
                  alt={item.caption ?? ''}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

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

      <section className="max-w-5xl mx-auto px-6 py-16 text-center">
        <a
          href={enquireUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center h-11 px-6 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90 transition"
        >
          Enquire
        </a>
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
