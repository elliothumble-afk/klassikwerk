import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router'
import { Check, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import { ErrorState } from '@/components/ui/ErrorState'
import type { Builder, BuilderTerms, CatalogCategory, Origin } from '@/types/database'

type Tab = 'terms' | 'categories' | 'origins'

export function CostingEdit() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('terms')
  const [status, setStatus] = useState<string | null>(null)

  const builderQ = useQuery({
    queryKey: ['builder', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('builders').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Builder
    },
  })

  async function reprice() {
    const r = await supabase.rpc('reprice_builder', { target_builder: id! })
    if (r.error) throw r.error
    setStatus(`Repriced ${r.data ?? 0} options`)
    qc.invalidateQueries({ queryKey: ['catalog', 'options', id] })
  }

  if (builderQ.isLoading) return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  if (builderQ.error) return <div className="p-8 max-w-4xl mx-auto"><ErrorState message={(builderQ.error as Error).message} /></div>
  const builder = builderQ.data!

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <Link to="/ops/builders" className="text-xs text-[var(--color-muted)] hover:underline">← Builders</Link>
        <h1 className="text-2xl mt-2 mb-1" style={{ fontFamily: 'var(--font-display)' }}>{builder.name} · Costing</h1>
        <p className="text-sm text-[var(--color-muted)] mb-6">Cost model inputs for the price-at-run computation. Saving reprices the catalog.</p>

        <div className="flex gap-4 border-b border-[var(--color-border)] mb-6">
          {(['terms','categories','origins'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-2 text-sm transition border-b-2 -mb-px ${
                tab === t
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'terms' && <TermsTab builderId={id!} reprice={reprice} />}
        {tab === 'categories' && <CategoriesTab builderId={id!} reprice={reprice} />}
        {tab === 'origins' && <OriginsTab builderId={id!} reprice={reprice} />}

        {status && <p className="mt-4 text-xs text-[var(--color-success)]">{status}</p>}
      </div>
    </div>
  )
}

// ─── Terms ─────────────────────────────────────────────────────────
function TermsTab({ builderId, reprice }: { builderId: string; reprice: () => Promise<void> }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Partial<BuilderTerms>>({})

  const q = useQuery({
    queryKey: ['builder-terms', builderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('builder_terms').select('*').eq('builder_id', builderId).maybeSingle()
      if (error) throw error
      return data as BuilderTerms | null
    },
  })
  useEffect(() => { if (q.data) setDraft(q.data) }, [q.data])

  const save = useMutation({
    mutationFn: async () => {
      const patch = {
        pricing_mode: draft.pricing_mode,
        fx_rate: draft.fx_rate,
        trade_discount_pct: draft.trade_discount_pct,
        labour_rate_cents: draft.labour_rate_cents,
        paint_rate_cents: draft.paint_rate_cents,
        partner_shop_rate_cents: draft.partner_shop_rate_cents,
        mpf_pct: draft.mpf_pct,
        brokerage_cents: draft.brokerage_cents,
        items_per_shipment: draft.items_per_shipment,
        aluminium_share_pct: draft.aluminium_share_pct,
        hh_fee_pct: draft.hh_fee_pct,
      }
      const { error } = await supabase.from('builder_terms').update(patch).eq('builder_id', builderId)
      if (error) throw error
      await reprice()
      qc.invalidateQueries({ queryKey: ['builder-terms', builderId] })
    },
  })

  if (!q.data) return <Spinner size={16} className="text-[var(--color-muted)]" />
  const d = draft
  const costBased = d.pricing_mode === 'cost_based'

  const num = (k: keyof BuilderTerms, label: string, scale = 1, pct = false) => (
    <div>
      <label className="text-xs text-[var(--color-muted)] mb-1 block">{label}</label>
      <input
        type="number"
        step={pct ? '0.0001' : 'any'}
        value={d[k] != null ? Number(d[k]) / scale : ''}
        onChange={e => setDraft({ ...d, [k]: Number(e.target.value) * scale })}
        className="h-9 w-full px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm"
      />
    </div>
  )

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-[var(--color-muted)] mb-1 block">Pricing mode</label>
        <select
          value={d.pricing_mode ?? 'simple'}
          onChange={e => setDraft({ ...d, pricing_mode: e.target.value as 'simple' | 'cost_based' })}
          className="h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm"
        >
          <option value="simple">simple (web × fx × markup)</option>
          <option value="cost_based">cost_based (full landing + labour)</option>
        </select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {num('fx_rate', 'FX (source → USD)')}
        {costBased && <>
          {num('trade_discount_pct', 'Trade discount (0.25 = 25%)')}
          {num('labour_rate_cents', 'Billed labour $/hr', 100)}
          {num('paint_rate_cents', 'Billed paint $/hr', 100)}
          {num('partner_shop_rate_cents', 'Partner shop cost $/hr (internal)', 100)}
          {num('mpf_pct', 'MPF (0.003464)')}
          {num('brokerage_cents', 'Brokerage $ per shipment', 100)}
          {num('items_per_shipment', 'Items per shipment')}
          {num('aluminium_share_pct', 'Aluminium share (wheels)')}
          {num('hh_fee_pct', 'HH fee % of sale (internal)')}
        </>}
      </div>

      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        {save.isPending ? <Spinner size={13} /> : <Check size={13} />} Save & reprice
      </button>
    </div>
  )
}

// ─── Categories ────────────────────────────────────────────────────
function CategoriesTab({ builderId, reprice }: { builderId: string; reprice: () => Promise<void> }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, CatalogCategory>>({})
  const q = useQuery({
    queryKey: ['catalog', 'categories', builderId],
    queryFn: async () => {
      const [cat, counts, origins] = await Promise.all([
        supabase.from('catalog_categories').select('*').eq('builder_id', builderId).order('sort'),
        supabase.from('catalog_options').select('category_id').eq('builder_id', builderId).eq('active', true),
        supabase.from('origins').select('*').eq('builder_id', builderId).order('sort'),
      ])
      if (cat.error) throw cat.error
      if (counts.error) throw counts.error
      if (origins.error) throw origins.error
      const count = new Map<string, number>()
      for (const r of (counts.data ?? []) as { category_id: string | null }[]) {
        if (!r.category_id) continue
        count.set(r.category_id, (count.get(r.category_id) ?? 0) + 1)
      }
      return { categories: (cat.data ?? []) as CatalogCategory[], counts: count, origins: (origins.data ?? []) as Origin[] }
    },
  })
  useEffect(() => {
    if (!q.data) return
    const d: Record<string, CatalogCategory> = {}
    for (const c of q.data.categories) d[c.id] = { ...c }
    setDraft(d)
  }, [q.data])

  const save = useMutation({
    mutationFn: async () => {
      // Upsert each row individually with its id so RLS/trigger logic
      // runs row-by-row. Small table, no need to batch.
      for (const c of Object.values(draft)) {
        const { error } = await supabase.from('catalog_categories').update({
          install_hours: c.install_hours,
          paint_hours: c.paint_hours,
          paint_materials_cents: c.paint_materials_cents,
          freight_cents: c.freight_cents,
          hts_duty_pct: c.hts_duty_pct,
          default_origin_id: c.default_origin_id,
          shopify_tags: c.shopify_tags,
        }).eq('id', c.id)
        if (error) throw error
      }
      await reprice()
      qc.invalidateQueries({ queryKey: ['catalog', 'categories', builderId] })
    },
  })

  if (!q.data) return <Spinner size={16} className="text-[var(--color-muted)]" />
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--color-muted)]">
              <th className="pr-2 py-1">Name</th><th className="pr-2 py-1">Items</th>
              <th className="pr-2 py-1">Install hrs</th><th className="pr-2 py-1">Paint hrs</th>
              <th className="pr-2 py-1">Paint $</th><th className="pr-2 py-1">Freight $</th>
              <th className="pr-2 py-1">HTS %</th><th className="pr-2 py-1">Origin</th>
            </tr>
          </thead>
          <tbody>
            {q.data.categories.map(c => {
              const d = draft[c.id] ?? c
              const upd = (patch: Partial<CatalogCategory>) =>
                setDraft(prev => ({ ...prev, [c.id]: { ...d, ...patch } }))
              const cls = 'h-7 px-1.5 w-20 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] text-right'
              return (
                <tr key={c.id} className="border-b border-[var(--color-border)]">
                  <td className="pr-2 py-1">{c.name}</td>
                  <td className="pr-2 py-1 text-[var(--color-muted)]">{q.data.counts.get(c.id) ?? 0}</td>
                  <td className="pr-2 py-1"><input className={cls} type="number" step="0.5" value={d.install_hours}
                    onChange={e => upd({ install_hours: Number(e.target.value) })} /></td>
                  <td className="pr-2 py-1"><input className={cls} type="number" step="0.5" value={d.paint_hours}
                    onChange={e => upd({ paint_hours: Number(e.target.value) })} /></td>
                  <td className="pr-2 py-1"><input className={cls} type="number" step="1" value={d.paint_materials_cents / 100}
                    onChange={e => upd({ paint_materials_cents: Math.round(Number(e.target.value) * 100) })} /></td>
                  <td className="pr-2 py-1"><input className={cls} type="number" step="1" value={d.freight_cents / 100}
                    onChange={e => upd({ freight_cents: Math.round(Number(e.target.value) * 100) })} /></td>
                  <td className="pr-2 py-1"><input className={cls} type="number" step="0.001" value={d.hts_duty_pct}
                    onChange={e => upd({ hts_duty_pct: Number(e.target.value) })} /></td>
                  <td className="pr-2 py-1">
                    <select
                      value={d.default_origin_id ?? ''}
                      onChange={e => upd({ default_origin_id: e.target.value || null })}
                      className="h-7 px-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]"
                    >
                      <option value="">—</option>
                      {q.data.origins.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        {save.isPending ? <Spinner size={13} /> : <Check size={13} />} Save & reprice
      </button>
    </div>
  )
}

// ─── Origins ──────────────────────────────────────────────────────
function OriginsTab({ builderId, reprice }: { builderId: string; reprice: () => Promise<void> }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, Origin>>({})
  const [newRow, setNewRow] = useState<{ name: string; tariff: string; s232: string }>({ name: '', tariff: '', s232: '' })

  const q = useQuery({
    queryKey: ['catalog', 'origins', builderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('origins').select('*').eq('builder_id', builderId).order('sort')
      if (error) throw error
      return data as Origin[]
    },
  })
  useEffect(() => {
    if (!q.data) return
    const d: Record<string, Origin> = {}
    for (const o of q.data) d[o.id] = { ...o }
    setDraft(d)
  }, [q.data])

  const save = useMutation({
    mutationFn: async () => {
      for (const o of Object.values(draft)) {
        const { error } = await supabase.from('origins').update({
          name: o.name,
          tariff_pct: o.tariff_pct,
          s232_aluminium_pct: o.s232_aluminium_pct,
          notes: o.notes,
        }).eq('id', o.id)
        if (error) throw error
      }
      await reprice()
      qc.invalidateQueries({ queryKey: ['catalog', 'origins', builderId] })
    },
  })

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('origins').insert({
        builder_id: builderId,
        name: newRow.name,
        tariff_pct: Number(newRow.tariff),
        s232_aluminium_pct: Number(newRow.s232),
        sort: (q.data?.length ?? 0) * 10 + 10,
      })
      if (error) throw error
      setNewRow({ name: '', tariff: '', s232: '' })
      qc.invalidateQueries({ queryKey: ['catalog', 'origins', builderId] })
    },
  })

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('origins').delete().eq('id', id)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['catalog', 'origins', builderId] })
      await reprice()
    },
  })

  if (!q.data) return <Spinner size={16} className="text-[var(--color-muted)]" />
  return (
    <div className="space-y-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[var(--color-muted)]">
            <th className="pr-2 py-1">Name</th>
            <th className="pr-2 py-1">Tariff %</th>
            <th className="pr-2 py-1">S232 (wheels) %</th>
            <th className="pr-2 py-1">Notes</th>
            <th className="pr-2 py-1 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {q.data.map(o => {
            const d = draft[o.id] ?? o
            const upd = (patch: Partial<Origin>) =>
              setDraft(prev => ({ ...prev, [o.id]: { ...d, ...patch } }))
            return (
              <tr key={o.id} className="border-b border-[var(--color-border)]">
                <td className="pr-2 py-1"><input className="h-7 px-2 w-40 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]"
                  value={d.name} onChange={e => upd({ name: e.target.value })} /></td>
                <td className="pr-2 py-1"><input className="h-7 px-2 w-20 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] text-right"
                  type="number" step="0.01" value={d.tariff_pct} onChange={e => upd({ tariff_pct: Number(e.target.value) })} /></td>
                <td className="pr-2 py-1"><input className="h-7 px-2 w-20 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] text-right"
                  type="number" step="0.01" value={d.s232_aluminium_pct} onChange={e => upd({ s232_aluminium_pct: Number(e.target.value) })} /></td>
                <td className="pr-2 py-1"><input className="h-7 px-2 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]"
                  value={d.notes ?? ''} onChange={e => upd({ notes: e.target.value })} /></td>
                <td className="pr-2 py-1">
                  <button onClick={() => del.mutate(o.id)} className="text-[var(--color-muted)] hover:text-[var(--color-danger)]">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            )
          })}
          <tr>
            <td className="pr-2 py-1"><input className="h-7 px-2 w-40 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]"
              placeholder="New origin" value={newRow.name} onChange={e => setNewRow({ ...newRow, name: e.target.value })} /></td>
            <td className="pr-2 py-1"><input className="h-7 px-2 w-20 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] text-right"
              placeholder="0.10" value={newRow.tariff} onChange={e => setNewRow({ ...newRow, tariff: e.target.value })} /></td>
            <td className="pr-2 py-1"><input className="h-7 px-2 w-20 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] text-right"
              placeholder="0.50" value={newRow.s232} onChange={e => setNewRow({ ...newRow, s232: e.target.value })} /></td>
            <td className="pr-2 py-1"></td>
            <td className="pr-2 py-1">
              <button onClick={() => add.mutate()} disabled={!newRow.name} className="text-[var(--color-accent)] hover:opacity-80 disabled:opacity-40">
                <Plus size={13} />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        {save.isPending ? <Spinner size={13} /> : <Check size={13} />} Save & reprice
      </button>
    </div>
  )
}
