import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { supabase } from '@/lib/supabase'
import { useBuilder } from '@/lib/builderContext'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCurrency } from '@/pages/public/BuilderHome'
import type { CatalogOption, OptionGroup, Platform, Tier } from '@/types/database'

interface Selection {
  [groupId: string]: string[] // option ids
}

export function ConfigurePage() {
  const { bundle } = useBuilder()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const prefix = location.pathname.startsWith('/b/') ? `/b/${bundle?.builder.slug}` : ''

  const { data, isLoading } = useQuery({
    queryKey: ['configure-catalog', bundle?.builder.id],
    enabled: Boolean(bundle?.builder.id),
    queryFn: async () => {
      const builderId = bundle!.builder.id
      const [plat, tie, grp, opt, optPlat] = await Promise.all([
        supabase.from('catalog_platforms').select('*').eq('builder_id', builderId).eq('active', true).order('sort'),
        supabase.from('catalog_tiers').select('*').eq('builder_id', builderId).order('sort'),
        supabase.from('catalog_option_groups').select('*').eq('builder_id', builderId).order('sort'),
        supabase.from('catalog_options').select('*').eq('builder_id', builderId).eq('active', true).order('sort'),
        supabase.from('catalog_option_platforms').select('*'),
      ])
      if (plat.error) throw plat.error
      if (tie.error) throw tie.error
      if (grp.error) throw grp.error
      if (opt.error) throw opt.error
      if (optPlat.error) throw optPlat.error
      return {
        platforms: (plat.data ?? []) as Platform[],
        tiers: (tie.data ?? []) as Tier[],
        groups: (grp.data ?? []) as OptionGroup[],
        options: (opt.data ?? []) as CatalogOption[],
        optionPlatforms: (optPlat.data ?? []) as Array<{ option_id: string; platform_id: string }>,
      }
    },
  })

  const platformSlug = params.get('platform')
  const tierSlug = params.get('tier')
  const [selection, setSelection] = useState<Selection>({})
  const [submitting, setSubmitting] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  const platform = useMemo(
    () => data?.platforms.find(p => p.slug === platformSlug) ?? null,
    [data, platformSlug]
  )
  const tier = useMemo(
    () => data?.tiers.find(t => t.slug === tierSlug) ?? null,
    [data, tierSlug]
  )

  const availableGroups = useMemo(
    () => (data?.groups ?? []).filter(g => g.platform_id === null || g.platform_id === platform?.id),
    [data, platform]
  )

  const availableOptions = useMemo(() => {
    if (!data || !platform) return [] as CatalogOption[]
    const restricted = new Map<string, Set<string>>()
    data.optionPlatforms.forEach(op => {
      if (!restricted.has(op.option_id)) restricted.set(op.option_id, new Set())
      restricted.get(op.option_id)!.add(op.platform_id)
    })
    return data.options.filter(o => {
      const r = restricted.get(o.id)
      return !r || r.has(platform.id)
    })
  }, [data, platform])

  const groupedOptions = useMemo(() => {
    const by = new Map<string, CatalogOption[]>()
    availableOptions.forEach(o => {
      if (!by.has(o.group_id)) by.set(o.group_id, [])
      by.get(o.group_id)!.push(o)
    })
    return by
  }, [availableOptions])

  const total = useMemo(() => {
    if (!tier) return 0
    const base = tier.base_price_cents ?? 0
    const addons = Object.values(selection)
      .flat()
      .reduce((sum, optId) => {
        const option = availableOptions.find(o => o.id === optId)
        if (!option) return sum
        const included = tier && option.included_in_tier_ids.includes(tier.id)
        return included ? sum : sum + option.price_cents
      }, 0)
    return base + addons
  }, [selection, availableOptions, tier])

  if (!bundle) return null
  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Spinner size={20} className="text-[var(--color-muted)]" />
      </div>
    )
  }

  function setPlatform(slug: string) {
    const next = new URLSearchParams(params)
    next.set('platform', slug)
    setParams(next)
    setSelection({})
  }
  function setTier(slug: string) {
    const next = new URLSearchParams(params)
    next.set('tier', slug)
    setParams(next)
  }

  function toggleOption(group: OptionGroup, optionId: string) {
    setSelection(prev => {
      const current = prev[group.id] ?? []
      if (group.selection === 'single') {
        return { ...prev, [group.id]: current[0] === optionId ? [] : [optionId] }
      }
      return {
        ...prev,
        [group.id]: current.includes(optionId)
          ? current.filter(id => id !== optionId)
          : [...current, optionId],
      }
    })
  }

  async function startReservation() {
    if (!platform || !tier || tier.quote_only) return
    setSubmitting(true)
    setCheckoutError(null)
    try {
      // Call reservation edge function. Falls back to in-app success page
      // when the Stripe key is not configured (useful for previews).
      const { data: fn, error } = await supabase.functions.invoke('create-reservation-checkout', {
        body: {
          builder_id: bundle!.builder.id,
          platform_id: platform.id,
          tier_id: tier.id,
          selection: Object.values(selection).flat(),
          origin: window.location.origin,
          builder_slug: bundle!.builder.slug,
        },
      })
      if (error) throw error
      if (fn?.url) {
        window.location.href = fn.url as string
        return
      }
      navigate(`${prefix}/reserve/success?demo=1`)
    } catch (e) {
      setCheckoutError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="max-w-5xl mx-auto px-6 py-12">
      <h1
        className="text-3xl text-[var(--color-foreground)] mb-8"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Configure your build
      </h1>

      {/* Step 1: Platform */}
      <Step label="1. Platform">
        {data.platforms.length === 0 ? (
          <EmptyState title="No platforms yet" description="Add platforms in Ops → Catalog." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {data.platforms.map(p => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.slug)}
                className={`text-left rounded-[var(--radius-md)] border px-4 py-3 transition ${
                  platform?.id === p.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                }`}
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-[var(--color-muted)] mt-0.5">{p.chassis} · {p.years}</div>
              </button>
            ))}
          </div>
        )}
      </Step>

      {platform && (
        <Step label="2. Tier">
          <div className="grid gap-3 sm:grid-cols-3">
            {data.tiers.map(t => (
              <button
                key={t.id}
                onClick={() => setTier(t.slug)}
                className={`text-left rounded-[var(--radius-md)] border px-4 py-3 transition ${
                  tier?.id === t.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                }`}
              >
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-[var(--color-muted)] mt-0.5">
                  {t.quote_only
                    ? 'By quote'
                    : t.base_price_cents != null
                      ? `${formatCurrency(t.base_price_cents, bundle.terms.currency)} · ${t.lead_time_weeks ?? '–'} wks`
                      : '–'}
                </div>
              </button>
            ))}
          </div>
        </Step>
      )}

      {platform && tier && !tier.quote_only && (
        <Step label="3. Options">
          <div className="space-y-6">
            {availableGroups.map(group => {
              const opts = groupedOptions.get(group.id) ?? []
              if (opts.length === 0) return null
              const chosen = new Set(selection[group.id] ?? [])
              return (
                <div key={group.id}>
                  <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                    {group.name}
                    {group.required && <span className="text-xs text-[var(--color-danger)]">required</span>}
                    <span className="text-xs text-[var(--color-muted)] uppercase tracking-wide">
                      {group.selection === 'single' ? 'single' : 'multi'}
                    </span>
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {opts.map(option => {
                      const included = option.included_in_tier_ids.includes(tier.id)
                      const active = chosen.has(option.id)
                      return (
                        <button
                          key={option.id}
                          onClick={() => toggleOption(group, option.id)}
                          className={`flex items-center justify-between gap-3 text-left rounded-[var(--radius-sm)] border px-3 py-2 transition ${
                            active
                              ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)]'
                              : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {option.swatch_image_url ? (
                              <img
                                src={option.swatch_image_url}
                                alt={option.name}
                                className="h-8 w-8 rounded-sm object-cover"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-sm bg-[var(--color-surface-raised)]" />
                            )}
                            <div>
                              <div className="text-sm">{option.name}</div>
                              {option.code && (
                                <div className="text-xs text-[var(--color-muted)]">{option.code}</div>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-[var(--color-muted)] shrink-0">
                            {included ? 'Included' : option.price_cents > 0 ? `+${formatCurrency(option.price_cents, bundle.terms.currency)}` : 'Included'}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </Step>
      )}

      {platform && tier && (
        <Step label="4. Summary">
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <div className="flex items-end justify-between mb-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Build total</div>
                <div
                  className="text-3xl text-[var(--color-foreground)]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {tier.quote_only ? 'By quote' : formatCurrency(total, bundle.terms.currency)}
                </div>
              </div>
              {!tier.quote_only && (
                <div className="text-right text-xs text-[var(--color-muted)]">
                  Reservation {formatCurrency(bundle.terms.reservation_cents, bundle.terms.currency)}
                </div>
              )}
            </div>
            {tier.quote_only ? (
              <p className="text-sm text-[var(--color-muted)]">
                This tier is quote-only. Sign in and we will reach out to begin a conversation.
              </p>
            ) : (
              <>
                {checkoutError && (
                  <p className="text-xs text-[var(--color-danger)] mb-2">{checkoutError}</p>
                )}
                <button
                  onClick={startReservation}
                  disabled={submitting}
                  className="inline-flex items-center h-10 px-5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90 disabled:opacity-50 transition"
                >
                  {submitting ? <Spinner size={14} className="mr-2" /> : null}
                  Reserve this build
                </button>
              </>
            )}
          </div>
        </Step>
      )}
    </section>
  )
}

function Step({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <h2 className="text-sm font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">
        {label}
      </h2>
      {children}
    </div>
  )
}
