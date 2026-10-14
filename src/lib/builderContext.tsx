import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { supabase } from '@/lib/supabase'
import type { Builder, BuilderBrand, BuilderTerms } from '@/types/database'

export interface BuilderBundle {
  builder: Builder
  brand: BuilderBrand
  terms: BuilderTerms
}

interface BuilderContextValue {
  bundle: BuilderBundle | null
  loading: boolean
  error: Error | null
}

const BuilderContext = createContext<BuilderContextValue>({
  bundle: null,
  loading: true,
  error: null,
})

async function fetchBuilderBundle(slug: string | null, hostname: string): Promise<BuilderBundle | null> {
  if (slug) {
    const { data: builder, error } = await supabase
      .from('builders')
      .select('*')
      .eq('slug', slug)
      .maybeSingle()
    if (error) throw error
    if (!builder) return null
    return loadBrandAndTerms(builder as Builder)
  }

  // Custom-domain resolution: look up builder_brand.custom_domain = hostname
  const { data: brand, error } = await supabase
    .from('builder_brand')
    .select('*, builders!inner(*)')
    .eq('custom_domain', hostname)
    .maybeSingle()
  if (error) throw error
  if (!brand) return null
  const builder = (brand as unknown as { builders: Builder }).builders
  const terms = await loadTerms(builder.id)
  return { builder, brand: brand as unknown as BuilderBrand, terms }
}

async function loadBrandAndTerms(builder: Builder): Promise<BuilderBundle> {
  const [brandRes, termsRes] = await Promise.all([
    supabase.from('builder_brand').select('*').eq('builder_id', builder.id).maybeSingle(),
    supabase.from('builder_terms').select('*').eq('builder_id', builder.id).maybeSingle(),
  ])
  if (brandRes.error) throw brandRes.error
  if (termsRes.error) throw termsRes.error
  return {
    builder,
    brand: (brandRes.data ?? defaultBrand(builder.id)) as BuilderBrand,
    terms: (termsRes.data ?? defaultTerms(builder.id)) as BuilderTerms,
  }
}

async function loadTerms(builderId: string): Promise<BuilderTerms> {
  const { data, error } = await supabase
    .from('builder_terms')
    .select('*')
    .eq('builder_id', builderId)
    .maybeSingle()
  if (error) throw error
  return (data ?? defaultTerms(builderId)) as BuilderTerms
}

function defaultBrand(builderId: string): BuilderBrand {
  return {
    builder_id: builderId,
    logo_url: null,
    wordmark_text: null,
    color_accent: '#2E3B2B',
    color_bg: '#FAF8F4',
    color_text: '#1C1C1A',
    font_display: 'Fraunces',
    font_body: 'Inter',
    tagline: null,
    hero_copy: null,
    process_copy: [],
    custom_domain: null,
    created_at: '',
    updated_at: '',
  }
}

function defaultTerms(builderId: string): BuilderTerms {
  return {
    builder_id: builderId,
    reservation_cents: 100000,
    payment_schedule: [],
    warranty_text: null,
    governing_law: null,
    lead_time_copy: null,
    currency: 'usd',
    created_at: '',
    updated_at: '',
  }
}

export function useBuilderBundle(slug: string | null): BuilderContextValue {
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname
  const query = useQuery({
    queryKey: ['builder-bundle', slug, hostname],
    queryFn: () => fetchBuilderBundle(slug, hostname),
    staleTime: 1000 * 60,
  })
  return { bundle: query.data ?? null, loading: query.isLoading, error: (query.error as Error) ?? null }
}

interface ProviderProps {
  slug: string | null
  children: ReactNode
}

export function BuilderProvider({ slug, children }: ProviderProps) {
  const { bundle, loading, error } = useBuilderBundle(slug)
  const value = useMemo(() => ({ bundle, loading, error }), [bundle, loading, error])

  useEffect(() => {
    if (bundle) applyBrand(bundle.brand)
    return () => resetBrand()
  }, [bundle])

  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>
}

export function useBuilder() {
  return useContext(BuilderContext)
}

/**
 * Resolve the current builder slug from the URL params when a route
 * is nested under `/b/:builderSlug/*`. Falls back to null (custom domain).
 */
export function useBuilderSlugFromParams(): string | null {
  const { builderSlug } = useParams<{ builderSlug: string }>()
  return builderSlug ?? null
}

// ------------------------------------------------------------
// Brand application: write CSS variables + load web fonts
// ------------------------------------------------------------

const FONT_LINKS: Map<string, HTMLLinkElement> = new Map()

function familyToUrl(family: string): string {
  const name = family.replace(/\s+/g, '+')
  return `https://fonts.googleapis.com/css2?family=${name}:wght@400;500;600&display=swap`
}

function ensureFontLoaded(family: string) {
  if (!family) return
  if (FONT_LINKS.has(family)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = familyToUrl(family)
  link.dataset.builderFont = family
  document.head.appendChild(link)
  FONT_LINKS.set(family, link)
}

function applyBrand(brand: BuilderBrand) {
  const root = document.documentElement
  root.style.setProperty('--color-accent', brand.color_accent)
  root.style.setProperty('--color-background', brand.color_bg)
  root.style.setProperty('--color-foreground', brand.color_text)
  root.style.setProperty('--font-display', `'${brand.font_display}', Georgia, serif`)
  root.style.setProperty('--font-body', `'${brand.font_body}', system-ui, sans-serif`)
  ensureFontLoaded(brand.font_display)
  ensureFontLoaded(brand.font_body)
}

function resetBrand() {
  const root = document.documentElement
  root.style.removeProperty('--color-accent')
  root.style.removeProperty('--color-background')
  root.style.removeProperty('--color-foreground')
  root.style.removeProperty('--font-display')
  root.style.removeProperty('--font-body')
}
