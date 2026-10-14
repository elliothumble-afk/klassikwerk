import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import { ErrorState } from '@/components/ui/ErrorState'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Builder, BuilderBrand, Operator } from '@/types/database'

interface BuilderCard {
  builder: Builder
  brand: BuilderBrand | null
}

export function OperatorLanding() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['operator-landing'],
    queryFn: async () => {
      const [opRes, buildersRes, brandRes] = await Promise.all([
        supabase.from('operators').select('*').limit(1).maybeSingle(),
        supabase.from('builders').select('*').eq('active', true).order('sort'),
        supabase.from('builder_brand').select('*'),
      ])
      if (opRes.error) throw opRes.error
      if (buildersRes.error) throw buildersRes.error
      if (brandRes.error) throw brandRes.error
      const brandByBuilder = new Map<string, BuilderBrand>(
        ((brandRes.data ?? []) as BuilderBrand[]).map(b => [b.builder_id, b])
      )
      const cards: BuilderCard[] = ((buildersRes.data ?? []) as Builder[]).map(builder => ({
        builder,
        brand: brandByBuilder.get(builder.id) ?? null,
      }))
      return { operator: opRes.data as Operator | null, cards }
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size={20} className="text-[var(--color-muted)]" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <ErrorState message={(error as Error).message} retry={refetch} />
      </div>
    )
  }

  const operator = data?.operator
  const tagline =
    operator && (operator.brand as { tagline?: string } | null)?.tagline
      ? (operator.brand as { tagline?: string }).tagline!
      : 'Bespoke restorations, white-labelled.'

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--color-border)]">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1
              className="text-2xl text-[var(--color-foreground)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {operator?.name ?? 'Humble House'}
            </h1>
            <p className="text-xs text-[var(--color-muted)] mt-1">{tagline}</p>
          </div>
          <Link
            to="/auth/login"
            className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2
          className="text-xl text-[var(--color-foreground)] mb-6"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Builders
        </h2>

        {(!data?.cards || data.cards.length === 0) ? (
          <EmptyState
            title="No active builders yet"
            description="Sign in and create a builder from Ops → Builders."
          />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.cards.map(({ builder, brand }) => (
              <li key={builder.id}>
                <Link
                  to={`/b/${builder.slug}`}
                  className="block rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 hover:border-[var(--color-accent)] hover:shadow-sm transition"
                  style={brand ? { borderTopColor: brand.color_accent, borderTopWidth: 3 } : undefined}
                >
                  <h3
                    className="text-lg text-[var(--color-foreground)] mb-1"
                    style={{
                      fontFamily: brand ? `'${brand.font_display}', Georgia, serif` : 'var(--font-display)',
                    }}
                  >
                    {brand?.wordmark_text ?? builder.name}
                  </h3>
                  {brand?.tagline && (
                    <p className="text-sm text-[var(--color-muted)]">{brand.tagline}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
