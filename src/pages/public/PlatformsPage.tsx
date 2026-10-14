import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router'
import { supabase } from '@/lib/supabase'
import { useBuilder } from '@/lib/builderContext'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Platform } from '@/types/database'

export function PlatformsPage() {
  const { bundle } = useBuilder()
  const location = useLocation()
  const prefix = location.pathname.startsWith('/b/') ? `/b/${bundle?.builder.slug}` : ''

  const { data: platforms, isLoading } = useQuery({
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
      return data as Platform[]
    },
  })

  if (!bundle) return null

  return (
    <section className="max-w-5xl mx-auto px-6 py-16">
      <h1
        className="text-3xl text-[var(--color-foreground)] mb-10"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Platforms
      </h1>

      {isLoading ? (
        <Spinner size={20} className="text-[var(--color-muted)]" />
      ) : !platforms || platforms.length === 0 ? (
        <EmptyState title="No platforms yet" description="This builder has not published any platforms." />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map(platform => (
            <li key={platform.id}>
              <Link
                to={`${prefix}/configure?platform=${platform.slug}`}
                className="block rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden hover:border-[var(--color-accent)] transition"
              >
                {platform.hero_image_url ? (
                  <div
                    className="aspect-[4/3] bg-cover bg-center"
                    style={{ backgroundImage: `url(${platform.hero_image_url})` }}
                  />
                ) : (
                  <div className="aspect-[4/3] bg-[var(--color-surface-raised)]" />
                )}
                <div className="p-5">
                  <h2
                    className="text-lg text-[var(--color-foreground)] mb-1"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {platform.name}
                  </h2>
                  <p className="text-xs text-[var(--color-muted)]">
                    {platform.chassis} · {platform.years}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
