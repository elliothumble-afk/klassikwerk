import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router'
import { FileText, Send, Save, Copy, Hammer, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFn } from '@/lib/fnInvoke'
import { renderQuotePdfToStorage } from '@/lib/pdf/renderPdf'
import { Spinner } from '@/components/ui/Spinner'
import type {
  BuilderTerms, CatalogOption, OptionGroup, Platform, Tier, Quote, QuoteOption,
} from '@/types/database'

interface Selection { [groupId: string]: string[] }

interface LeadLite {
  id: string
  builder_id: string
  stage: string
  platform_interest_id: string | null
  customer: { full_name: string | null; email: string | null } | null
}

export function QuoteEditor() {
  const { id: existingQuoteId } = useParams<{ id?: string }>()
  const [search] = useSearchParams()
  const leadIdFromQuery = search.get('lead')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // ---------- Load existing quote (if editing) ----------
  const { data: existing } = useQuery({
    queryKey: ['quote-edit', existingQuoteId],
    enabled: Boolean(existingQuoteId),
    queryFn: async () => {
      const q = await supabase
        .from('quotes')
        .select('*, quote_options(*)')
        .eq('id', existingQuoteId!)
        .single()
      if (q.error) throw q.error
      return q.data as unknown as Quote & { quote_options: QuoteOption[] }
    },
  })

  // Lead id for new or existing
  const leadId = existing?.lead_id ?? leadIdFromQuery
  const { data: lead } = useQuery({
    queryKey: ['quote-lead', leadId],
    enabled: Boolean(leadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, builder_id, stage, platform_interest_id, customer:customers(full_name, email)')
        .eq('id', leadId!)
        .single()
      if (error) throw error
      return data as unknown as LeadLite
    },
  })

  // Catalog scoped by builder
  const { data: catalog } = useQuery({
    queryKey: ['quote-catalog', lead?.builder_id],
    enabled: Boolean(lead?.builder_id),
    queryFn: async () => {
      const builderId = lead!.builder_id
      const [plat, tie, grp, opt, terms] = await Promise.all([
        supabase.from('catalog_platforms').select('*').eq('builder_id', builderId).eq('active', true).order('sort'),
        supabase.from('catalog_tiers').select('*').eq('builder_id', builderId).eq('active', true).order('sort'),
        supabase.from('catalog_option_groups').select('*').eq('builder_id', builderId).order('sort'),
        supabase.from('catalog_options').select('*').eq('builder_id', builderId).eq('active', true).order('sort'),
        supabase.from('builder_terms').select('option_mode').eq('builder_id', builderId).maybeSingle(),
      ])
      if (plat.error) throw plat.error
      if (tie.error) throw tie.error
      if (grp.error) throw grp.error
      if (opt.error) throw opt.error
      if (terms.error) throw terms.error

      // Scope the restriction fetch to THIS builder's active options
      // so cross-builder link rows can't leak into the filter.
      const builderOptionIds = (opt.data ?? []).map(o => o.id)
      let optionPlatforms: { option_id: string; platform_id: string }[] = []
      if (builderOptionIds.length > 0) {
        const op = await supabase
          .from('catalog_option_platforms')
          .select('option_id, platform_id')
          .in('option_id', builderOptionIds)
        if (op.error) throw op.error
        optionPlatforms = (op.data ?? []) as typeof optionPlatforms
      }

      const optionMode = ((terms.data as Pick<BuilderTerms, 'option_mode'> | null)?.option_mode) ?? 'priced'
      return {
        platforms: (plat.data ?? []) as Platform[],
        tiers: (tie.data ?? []) as Tier[],
        groups: (grp.data ?? []) as OptionGroup[],
        options: (opt.data ?? []) as CatalogOption[],
        optionPlatforms,
        optionMode: optionMode as 'included_only' | 'priced',
      }
    },
  })

  const [platformId, setPlatformId] = useState<string>('')
  const [tierId, setTierId] = useState<string>('')
  const [selection, setSelection] = useState<Selection>({})
  const [notes, setNotes] = useState<string>('')

  useEffect(() => {
    if (existing) {
      setPlatformId(existing.platform_id)
      setTierId(existing.tier_id)
      setNotes(existing.notes ?? '')
      const sel: Selection = {}
      // Need to map option_id → group_id; done once catalog is loaded
      if (catalog) {
        for (const qo of existing.quote_options) {
          const opt = catalog.options.find(o => o.id === qo.option_id)
          if (!opt) continue
          sel[opt.group_id] = [...(sel[opt.group_id] ?? []), qo.option_id]
        }
        setSelection(sel)
      }
    } else if (lead?.platform_interest_id && !platformId) {
      setPlatformId(lead.platform_interest_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, catalog, lead?.platform_interest_id])

  const platform = useMemo(() => catalog?.platforms.find(p => p.id === platformId) ?? null, [catalog, platformId])
  const tier = useMemo(() => catalog?.tiers.find(t => t.id === tierId) ?? null, [catalog, tierId])

  const includedOnly = catalog?.optionMode === 'included_only'

  const platformGroups = useMemo(
    () => (catalog?.groups ?? []).filter(g => g.platform_id === null || g.platform_id === platform?.id),
    [catalog, platform]
  )

  /** Map option_id → set of platform_ids it's restricted to. Options
   *  without any rows are universal (allowed on every platform). */
  const optionPlatformMap = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const op of catalog?.optionPlatforms ?? []) {
      if (!m.has(op.option_id)) m.set(op.option_id, new Set())
      m.get(op.option_id)!.add(op.platform_id)
    }
    return m
  }, [catalog])

  /** All options visible for the current platform + tier, respecting
   *  option_mode and catalog_option_platforms restrictions. */
  const visibleOptionsByGroup = useMemo(() => {
    const by = new Map<string, CatalogOption[]>()
    if (!catalog) return by
    // Nothing shows until a platform is chosen — options are platform-
    // scoped, and without a platform we can't tell which to render.
    if (!platform) return by
    for (const o of catalog.options) {
      if (includedOnly && tier && !o.included_in_tier_ids.includes(tier.id)) continue
      const restricted = optionPlatformMap.get(o.id)
      const isUniversal = !restricted || restricted.size === 0
      const linkedToCurrent = restricted?.has(platform.id) ?? false
      // Keep when the option is universal OR explicitly linked to the
      // chosen platform. Hide only when restricted to OTHER platforms.
      if (!isUniversal && !linkedToCurrent) continue
      if (!by.has(o.group_id)) by.set(o.group_id, [])
      by.get(o.group_id)!.push(o)
    }
    return by
  }, [catalog, includedOnly, tier, platform, optionPlatformMap])

  /** Groups with at least one visible option — empties are hidden. */
  const availableGroups = useMemo(
    () => platformGroups.filter(g => (visibleOptionsByGroup.get(g.id)?.length ?? 0) > 0),
    [platformGroups, visibleOptionsByGroup]
  )

  const total = useMemo(() => {
    if (!tier || !catalog) return 0
    const base = tier.base_price_cents ?? 0
    if (includedOnly) return base
    const addons = Object.values(selection).flat().reduce((sum, optId) => {
      const opt = catalog.options.find(o => o.id === optId)
      if (!opt) return sum
      return opt.included_in_tier_ids.includes(tier.id) ? sum : sum + opt.price_cents
    }, 0)
    return base + addons
  }, [selection, catalog, tier, includedOnly])

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

  // ---------- Save / revise / send / create contract ----------
  const save = useMutation({
    mutationFn: async () => {
      if (!lead || !platformId || !tierId) throw new Error('Pick a platform and tier')
      if (existing) {
        const { error: upErr } = await supabase
          .from('quotes')
          .update({ platform_id: platformId, tier_id: tierId, price_cents: total, notes })
          .eq('id', existing.id)
        if (upErr) throw upErr
        await supabase.from('quote_options').delete().eq('quote_id', existing.id)
        const rows = Object.values(selection).flat().map(optionId => ({
          quote_id: existing.id,
          option_id: optionId,
          price_cents_at_selection: catalog!.options.find(o => o.id === optionId)!.included_in_tier_ids.includes(tierId)
            ? 0
            : (catalog!.options.find(o => o.id === optionId)?.price_cents ?? 0),
        }))
        if (rows.length) {
          const { error } = await supabase.from('quote_options').insert(rows)
          if (error) throw error
        }
        return existing.id
      }
      // New: find next version
      const vRes = await supabase
        .from('quotes')
        .select('version')
        .eq('lead_id', lead.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextVersion = ((vRes.data as { version?: number } | null)?.version ?? 0) + 1
      const q = await supabase.from('quotes').insert({
        lead_id: lead.id,
        builder_id: lead.builder_id,
        version: nextVersion,
        platform_id: platformId,
        tier_id: tierId,
        price_cents: total,
        status: 'draft',
        notes,
      }).select('id').single()
      if (q.error) throw q.error
      const quoteId = (q.data as { id: string }).id

      const rows = Object.values(selection).flat().map(optionId => ({
        quote_id: quoteId,
        option_id: optionId,
        price_cents_at_selection: catalog!.options.find(o => o.id === optionId)!.included_in_tier_ids.includes(tierId)
          ? 0
          : (catalog!.options.find(o => o.id === optionId)?.price_cents ?? 0),
      }))
      if (rows.length) {
        const { error } = await supabase.from('quote_options').insert(rows)
        if (error) throw error
      }
      await supabase.from('quote_events').insert({ quote_id: quoteId, kind: 'created' })
      await supabase.from('leads').update({ stage: 'quoting' }).eq('id', lead.id)
      return quoteId
    },
    onSuccess: (quoteId) => {
      setStatus('Saved'); setErr(null)
      qc.invalidateQueries({ queryKey: ['quotes'] })
      qc.invalidateQueries({ queryKey: ['lead'] })
      if (!existingQuoteId) navigate(`/ops/quotes/${quoteId}`, { replace: true })
    },
    onError: e => setErr((e as Error).message),
  })

  const generatePdf = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error('Save the quote first')
      return await renderQuotePdfToStorage(existing.id)
    },
    onSuccess: url => {
      setStatus(`PDF ready: ${url}`)
      qc.invalidateQueries({ queryKey: ['quote-edit', existingQuoteId] })
    },
    onError: e => setErr((e as Error).message),
  })

  const send = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error('Save the quote first')
      await invokeFn('send-quote', { quote_id: existing.id })
    },
    onSuccess: () => {
      setStatus('Sent')
      qc.invalidateQueries({ queryKey: ['quote-edit', existingQuoteId] })
      qc.invalidateQueries({ queryKey: ['lead'] })
    },
    onError: e => setErr((e as Error).message),
  })

  const revise = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error('Save the quote first')
      // Mark current superseded + bump lead to revising
      await supabase.from('quotes').update({ status: 'superseded' }).eq('id', existing.id)
      await supabase.from('leads').update({ stage: 'revising' }).eq('id', existing.lead_id)
      // Clone to new version
      const nextVersion = existing.version + 1
      const insQuote = await supabase.from('quotes').insert({
        lead_id: existing.lead_id,
        builder_id: existing.builder_id,
        version: nextVersion,
        platform_id: existing.platform_id,
        tier_id: existing.tier_id,
        price_cents: existing.price_cents,
        status: 'draft',
        notes: existing.notes,
      }).select('id').single()
      if (insQuote.error) throw insQuote.error
      const newQuoteId = (insQuote.data as { id: string }).id
      // Copy options
      const copies = existing.quote_options.map(qo => ({
        quote_id: newQuoteId,
        option_id: qo.option_id,
        price_cents_at_selection: qo.price_cents_at_selection,
      }))
      if (copies.length) {
        const { error } = await supabase.from('quote_options').insert(copies)
        if (error) throw error
      }
      await supabase.from('quote_events').insert({ quote_id: newQuoteId, kind: 'revised' })
      return newQuoteId
    },
    onSuccess: (newQuoteId) => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      navigate(`/ops/quotes/${newQuoteId}`, { replace: true })
    },
    onError: e => setErr((e as Error).message),
  })

  const createContract = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error('Save the quote first')
      if (existing.status !== 'approved') throw new Error('Only approved quotes convert to builds')
      // Load lead → customer link
      const leadRes = await supabase.from('leads').select('customer_id').eq('id', existing.lead_id).single()
      if (leadRes.error) throw leadRes.error
      // Build row
      const slotYear = new Date().getUTCFullYear()
      const maxRes = await supabase
        .from('builds')
        .select('slot_number')
        .eq('builder_id', existing.builder_id)
        .eq('slot_year', slotYear)
        .order('slot_number', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      const slotNumber = ((maxRes.data as { slot_number?: number } | null)?.slot_number ?? 0) + 1
      const buildIns = await supabase.from('builds').insert({
        builder_id: existing.builder_id,
        customer_id: (leadRes.data as { customer_id: string }).customer_id,
        platform_id: existing.platform_id,
        tier_id: existing.tier_id,
        stage: 'contract',
        slot_year: slotYear,
        slot_number: slotNumber,
        price_cents: existing.price_cents,
        quote_id: existing.id,
      }).select('id').single()
      if (buildIns.error) throw buildIns.error
      const buildId = (buildIns.data as { id: string }).id
      // Copy options to build_options
      const rows = existing.quote_options.map(qo => ({
        build_id: buildId,
        option_id: qo.option_id,
        price_cents_at_selection: qo.price_cents_at_selection,
      }))
      if (rows.length) await supabase.from('build_options').insert(rows)
      await supabase.from('build_stage_events').insert({
        build_id: buildId, from_stage: null, to_stage: 'contract', note: 'Created from quote',
      })
      await supabase.from('leads').update({ stage: 'contract_sent' }).eq('id', existing.lead_id)
      return buildId
    },
    onSuccess: buildId => navigate(`/ops/builds/${buildId}`),
    onError: e => setErr((e as Error).message),
  })

  // Latest builder_push_log for this quote
  const { data: lastPush, refetch: refetchPush } = useQuery({
    queryKey: ['builder-push-log', existing?.id],
    enabled: Boolean(existing?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('builder_push_log')
        .select('status, error, http_status, created_at')
        .eq('quote_id', existing!.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as {
        status: 'success' | 'error' | 'pending'
        error: string | null
        http_status: number | null
        created_at: string
      } | null
    },
    refetchInterval: 5000,
  })

  const retryPush = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error('Save the quote first')
      await invokeFn('push-quote-to-builder', { quote_id: existing.id })
    },
    onSuccess: () => { setStatus('Pushed to builder'); refetchPush() },
    onError: e => setErr((e as Error).message),
  })

  if (leadId && !lead) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }
  if (!catalog) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }

  const customer = lead?.customer
  const readOnly = existing?.status === 'superseded' || existing?.status === 'approved'

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <Link to={lead ? `/ops/leads/${lead.id}` : '/ops/leads'} className="text-xs text-[var(--color-muted)] hover:underline">
              ← {lead ? 'Lead' : 'Leads'}
            </Link>
            <h1 className="text-2xl mt-2" style={{ fontFamily: 'var(--font-display)' }}>
              {existing ? `Quote v${existing.version}` : 'New quote'}
              {existing?.status && (
                <span className="ml-3 text-xs font-normal px-2 py-1 rounded bg-[var(--color-surface-raised)] text-[var(--color-muted)] uppercase">
                  {existing.status}
                </span>
              )}
            </h1>
            <p className="text-sm text-[var(--color-muted)] mt-1">
              {customer?.full_name ?? customer?.email ?? '—'}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-[var(--color-muted)]">Total</div>
            <div className="text-3xl" style={{ fontFamily: 'var(--font-display)' }}>
              ${(total / 100).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Step: Platform */}
        <Step label="Platform">
          <div className="grid gap-3 sm:grid-cols-3">
            {catalog.platforms.map(p => (
              <button
                key={p.id}
                disabled={readOnly}
                onClick={() => setPlatformId(p.id)}
                className={`text-left rounded-[var(--radius-md)] border px-4 py-3 transition ${
                  platformId === p.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                } disabled:opacity-50`}
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-[var(--color-muted)] mt-0.5">{p.chassis} · {p.years}</div>
              </button>
            ))}
          </div>
        </Step>

        {platformId && (
          <Step label="Tier">
            <div className="grid gap-3 sm:grid-cols-3">
              {catalog.tiers.map(t => (
                <button
                  key={t.id}
                  disabled={readOnly}
                  onClick={() => setTierId(t.id)}
                  className={`text-left rounded-[var(--radius-md)] border px-4 py-3 transition ${
                    tierId === t.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface)]'
                      : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                  } disabled:opacity-50`}
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-[var(--color-muted)] mt-0.5">
                    {t.quote_only ? 'By quote' : t.base_price_cents != null ? `$${(t.base_price_cents / 100).toLocaleString()}` : '—'}
                  </div>
                </button>
              ))}
            </div>
          </Step>
        )}

        {platformId && tier && (
          <Step label="Options">
            <div className="space-y-5">
              {availableGroups.map(group => {
                const opts = visibleOptionsByGroup.get(group.id) ?? []
                const chosen = new Set(selection[group.id] ?? [])
                return (
                  <div key={group.id}>
                    <h3 className="text-sm font-medium mb-2">{group.name}
                      <span className="ml-2 text-xs text-[var(--color-muted)] uppercase">
                        {group.selection}
                      </span>
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {opts.map(opt => {
                        const included = opt.included_in_tier_ids.includes(tier.id)
                        const active = chosen.has(opt.id)
                        const priceMissing = !includedOnly && !included && opt.price_cents === 0
                        return (
                          <button
                            key={opt.id}
                            disabled={readOnly}
                            onClick={() => toggleOption(group, opt.id)}
                            className={`flex items-center justify-between gap-3 text-left rounded-[var(--radius-sm)] border px-3 py-2 transition ${
                              active
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)]'
                                : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                            } disabled:opacity-50`}
                            title={priceMissing ? `Set a price on ${opt.name} in Catalog → Options` : undefined}
                          >
                            <div className="flex items-center gap-3">
                              {opt.swatch_image_url ? (
                                <img src={opt.swatch_image_url} alt="" className="h-8 w-8 rounded-sm object-cover" />
                              ) : (
                                <div className="h-8 w-8 rounded-sm bg-[var(--color-surface-raised)]" />
                              )}
                              <div>
                                <div className="text-sm">{opt.name}</div>
                                {opt.code && <div className="text-xs text-[var(--color-muted)]">{opt.code}</div>}
                              </div>
                            </div>
                            {!includedOnly && (
                              <div className="text-xs shrink-0 text-right">
                                {included ? (
                                  <span className="text-[var(--color-muted)]">Included</span>
                                ) : (
                                  <>
                                    <span className={priceMissing ? 'text-[var(--color-danger)]' : 'text-[var(--color-muted)]'}>
                                      +${(opt.price_cents / 100).toLocaleString()}
                                    </span>
                                    {priceMissing && (
                                      <div className="text-[10px] text-[var(--color-danger)] mt-0.5">
                                        Set a price
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
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

        <Step label="Notes">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            disabled={readOnly}
            placeholder="Internal notes (do not appear on the PDF)"
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm disabled:opacity-50"
          />
        </Step>

        <div className="flex flex-wrap gap-2 items-center mt-6">
          {!readOnly && (
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {save.isPending ? <Spinner size={13} /> : <Save size={13} />}
              Save draft
            </button>
          )}
          {existing && (
            <>
              <button
                onClick={() => generatePdf.mutate()}
                disabled={generatePdf.isPending}
                className="h-9 px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {generatePdf.isPending ? <Spinner size={13} /> : <FileText size={13} />}
                Generate PDF
              </button>
              <button
                onClick={() => send.mutate()}
                disabled={send.isPending || existing.status === 'approved' || existing.status === 'superseded'}
                className="h-9 px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {send.isPending ? <Spinner size={13} /> : <Send size={13} />}
                Send
              </button>
              <button
                onClick={() => revise.mutate()}
                disabled={revise.isPending || existing.status === 'superseded'}
                className="h-9 px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {revise.isPending ? <Spinner size={13} /> : <Copy size={13} />}
                Revise
              </button>
              <button
                onClick={() => createContract.mutate()}
                disabled={createContract.isPending || existing.status !== 'approved'}
                className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                title={existing.status !== 'approved' ? 'Only approved quotes convert to builds' : undefined}
              >
                {createContract.isPending ? <Spinner size={13} /> : <Hammer size={13} />}
                Create contract
              </button>
              {existing.pdf_url && (
                <a
                  href={existing.pdf_url}
                  target="_blank"
                  rel="noreferrer"
                  className="h-9 px-3 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
                >
                  Open PDF <ExternalLink size={11} />
                </a>
              )}
              <Link
                to={`/q/${existing.token}`}
                target="_blank"
                rel="noreferrer"
                className="h-9 px-3 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
              >
                Public preview <ExternalLink size={11} />
              </Link>
            </>
          )}
          {status && <span className="text-xs text-[var(--color-success)]">{status}</span>}
          {err && <span className="text-xs text-[var(--color-danger)]">{err}</span>}
        </div>

        {existing && lastPush && (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs uppercase tracking-wide text-[var(--color-muted)] mr-2">Builder push</span>
                <span className={lastPush.status === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-foreground)]'}>
                  {lastPush.status}
                  {lastPush.http_status != null ? ` · HTTP ${lastPush.http_status}` : ''}
                  {lastPush.error ? ` — ${lastPush.error}` : ''}
                </span>
                <span className="ml-2 text-xs text-[var(--color-muted)]">
                  {new Date(lastPush.created_at).toLocaleString()}
                </span>
              </div>
              {lastPush.status === 'error' && (
                <button
                  onClick={() => retryPush.mutate()}
                  disabled={retryPush.isPending}
                  className="h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-xs inline-flex items-center gap-1.5 hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
                >
                  {retryPush.isPending && <Spinner size={11} />}
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Step({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">{label}</h2>
      {children}
    </div>
  )
}
