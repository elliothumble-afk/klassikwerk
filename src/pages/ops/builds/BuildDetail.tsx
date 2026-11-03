import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router'
import { FileText, Mail, RefreshCw, CheckCircle, PackageCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { renderContractPdfToStorage, renderBuildSheetPdfToStorage, renderPurchaseOrderPdfToStorage } from '@/lib/pdf/renderPdf'
import { Spinner } from '@/components/ui/Spinner'
import { VehicleIntake } from './VehicleIntake'

interface BuildDoc {
  id: string
  storage_path: string
  caption: string | null
  created_at: string
}

interface BuildOptionRow {
  id: string
  option_id: string
  quantity: number
  instruction: string | null
  received_at: string | null
  catalog_options: {
    name: string
    code: string | null
    kit_sku: string | null
    category_id: string | null
  } | null
}

interface PurchaseOrderRow {
  id: string
  number: string
  status: 'draft' | 'sent' | 'confirmed' | 'received'
  currency: string
  subtotal_cents: number
  pdf_url: string | null
  sent_at: string | null
  sent_to: string | null
  confirmed_at: string | null
  received_at: string | null
  supplier: { name: string; email: string | null } | null
}

export function BuildDetail() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const [instructionsDraft, setInstructionsDraft] = useState<string | null>(null)

  const build = useQuery({
    queryKey: ['build-detail', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('builds')
        .select(`
          id, stage, price_cents, created_at, builder_id, customer_id, vehicle_id, platform_id,
          install_instructions,
          platform:catalog_platforms(name, chassis, years),
          tier:catalog_tiers(name, base_price_cents, lead_time_weeks)
        `)
        .eq('id', id!).single()
      if (error) throw error
      return data as unknown as {
        id: string
        stage: string
        price_cents: number | null
        created_at: string
        builder_id: string
        customer_id: string | null
        vehicle_id: string | null
        platform_id: string
        install_instructions: string | null
        platform: { name: string; chassis: string; years: string } | null
        tier: { name: string; base_price_cents: number | null; lead_time_weeks: number | null } | null
      }
    },
  })

  const buildOptions = useQuery({
    queryKey: ['build-options', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('build_options')
        .select('id, option_id, quantity, instruction, received_at, catalog_options(name, code, kit_sku, category_id)')
        .eq('build_id', id!)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as BuildOptionRow[]
    },
  })

  const pos = useQuery({
    queryKey: ['build-pos', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('id, number, status, currency, subtotal_cents, pdf_url, sent_at, sent_to, confirmed_at, received_at, supplier:suppliers(name, email)')
        .eq('build_id', id!)
        .order('number')
      if (error) throw error
      return (data ?? []) as unknown as PurchaseOrderRow[]
    },
  })

  const documents = useQuery({
    queryKey: ['build-docs', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('media')
        .select('id, storage_path, caption, created_at')
        .eq('build_id', id!)
        .eq('kind', 'document')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BuildDoc[]
    },
  })

  const saveInstructions = useMutation({
    mutationFn: async (md: string) => {
      const { error } = await supabase.from('builds').update({ install_instructions: md }).eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['build-detail', id] }),
    onError: (e: Error) => setErr(e.message),
  })

  const saveLine = useMutation({
    mutationFn: async (payload: { boId: string; instruction?: string | null; received_at?: string | null }) => {
      const upd: { instruction?: string | null; received_at?: string | null } = {}
      if ('instruction' in payload) upd.instruction = payload.instruction
      if ('received_at' in payload) upd.received_at = payload.received_at
      const { error } = await supabase.from('build_options').update(upd).eq('id', payload.boId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['build-options', id] }),
    onError: (e: Error) => setErr(e.message),
  })

  const generateContract = useMutation({
    mutationFn: async () => id ? await renderContractPdfToStorage(id) : '',
    onSuccess: () => qc.invalidateQueries({ queryKey: ['build-docs', id] }),
    onError: (e: Error) => setErr(e.message),
  })

  const generateBuildSheet = useMutation({
    mutationFn: async () => id ? await renderBuildSheetPdfToStorage(id) : '',
    onSuccess: () => qc.invalidateQueries({ queryKey: ['build-docs', id] }),
    onError: (e: Error) => { console.error('[build-sheet]', e); setErr(e.message) },
  })

  const regenerateAllPos = useMutation({
    mutationFn: async () => {
      if (!id) return
      const rpc = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: Error | null }> }
      const r = await rpc.rpc('generate_purchase_orders', { p_build_id: id })
      if (r.error) throw r.error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['build-pos', id] }),
    onError: (e: Error) => setErr(e.message),
  })

  const regeneratePoPdf = useMutation({
    mutationFn: async (poId: string) => await renderPurchaseOrderPdfToStorage(poId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['build-pos', id] }),
    onError: (e: Error) => setErr(e.message),
  })

  const emailPo = useMutation({
    mutationFn: async (payload: { poId: string; overrideTo?: string }) => {
      // Ensure PDF exists before sending.
      const po = (pos.data ?? []).find(p => p.id === payload.poId)
      if (!po?.pdf_url) await renderPurchaseOrderPdfToStorage(payload.poId)
      const session = (await supabase.auth.getSession()).data.session
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-po`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ po_id: payload.poId, override_to: payload.overrideTo || undefined }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error ?? `HTTP ${resp.status}`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['build-pos', id] }),
    onError: (e: Error) => setErr(e.message),
  })

  const markPo = useMutation({
    mutationFn: async (payload: { poId: string; status: 'confirmed' | 'received' }) => {
      const now = new Date().toISOString()
      const upd = payload.status === 'confirmed'
        ? { status: payload.status, confirmed_at: now }
        : { status: payload.status, received_at: now }
      const { error } = await supabase.from('purchase_orders').update(upd).eq('id', payload.poId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['build-pos', id] }),
    onError: (e: Error) => setErr(e.message),
  })

  if (build.isLoading || !build.data) {
    return <div className="p-8"><Spinner size={20} className="text-[var(--color-muted)]" /></div>
  }
  const b = build.data

  const currentInstructions = instructionsDraft ?? b.install_instructions ?? ''

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <Link to="/ops/builds" className="text-xs text-[var(--color-muted)] hover:underline">← Builds</Link>
        <h1 className="text-2xl mt-2 mb-4" style={{ fontFamily: 'var(--font-display)' }}>
          Build {b.id.slice(0, 8)}
        </h1>
        {err && <p className="text-xs text-[var(--color-danger)] mb-3">{err}</p>}

        <div className="grid grid-cols-2 gap-4 mb-6">
          <Row label="Platform" value={b.platform ? `${b.platform.name} · ${b.platform.chassis}` : '—'} />
          <Row label="Tier" value={b.tier?.name ?? '—'} />
          <Row label="Stage" value={b.stage} />
          <Row label="Total" value={b.price_cents != null ? `$${(b.price_cents / 100).toLocaleString()}` : '—'} />
        </div>

        <VehicleIntake
          buildId={b.id}
          builderId={b.builder_id}
          platformId={b.platform_id}
          customerId={b.customer_id}
          vehicleId={b.vehicle_id}
        />

        {/* Install instructions (markdown) */}
        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
          <h2 className="text-sm font-medium mb-2">Install instructions (markdown)</h2>
          <textarea
            className="w-full h-40 text-sm font-mono border border-[var(--color-border)] rounded px-3 py-2 bg-white"
            value={currentInstructions}
            onChange={e => setInstructionsDraft(e.target.value)}
            onBlur={() => {
              if (instructionsDraft != null && instructionsDraft !== (b.install_instructions ?? '')) {
                saveInstructions.mutate(instructionsDraft)
              }
            }}
            placeholder="e.g. ## Priority&#10;- Bodykit paint sign-off before mounting&#10;- Confirm wheel offset per supplier call"
          />
          <p className="text-xs text-[var(--color-muted)] mt-1">Supports headings (#, ##, ###), bullets, **bold**, *italic*.</p>
        </section>

        {/* Lines + per-line notes */}
        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
          <h2 className="text-sm font-medium mb-3">Build lines</h2>
          <ul className="divide-y divide-[var(--color-border)]">
            {(buildOptions.data ?? []).map(bo => (
              <li key={bo.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{bo.catalog_options?.name ?? bo.option_id.slice(0, 8)}</div>
                    <div className="text-xs text-[var(--color-muted)]">
                      {bo.catalog_options?.kit_sku ?? bo.catalog_options?.code ?? '—'} · Qty {bo.quantity}
                    </div>
                  </div>
                  <label className="text-xs inline-flex items-center gap-1 text-[var(--color-muted)]">
                    <input
                      type="checkbox"
                      checked={!!bo.received_at}
                      onChange={e => saveLine.mutate({
                        boId: bo.id,
                        received_at: e.target.checked ? new Date().toISOString() : null,
                      })}
                    />
                    Received
                  </label>
                </div>
                <input
                  className="mt-2 w-full text-xs border border-[var(--color-border)] rounded px-2 py-1 bg-white"
                  placeholder="Line instruction for the installer…"
                  defaultValue={bo.instruction ?? ''}
                  onBlur={e => {
                    if (e.target.value !== (bo.instruction ?? '')) {
                      saveLine.mutate({ boId: bo.id, instruction: e.target.value || null })
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        </section>

        {/* Orders tab */}
        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Orders</h2>
            <button
              onClick={() => regenerateAllPos.mutate()}
              disabled={regenerateAllPos.isPending}
              className="h-8 px-2 text-xs rounded border border-[var(--color-border)] inline-flex items-center gap-1 disabled:opacity-50"
            >
              {regenerateAllPos.isPending && <Spinner size={11} />}
              <RefreshCw size={12} /> Regenerate from lines
            </button>
          </div>
          {(pos.data ?? []).length === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">No purchase orders yet. Lines must have suppliers assigned, then click Regenerate.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {(pos.data ?? []).map(po => (
                <li key={po.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm">{po.supplier?.name ?? '—'} <span className="text-[var(--color-muted)]">· {po.number}</span></div>
                      <div className="text-xs text-[var(--color-muted)]">
                        {po.currency} {(po.subtotal_cents / 100).toLocaleString()}
                        {' · '}<StatusBadge status={po.status} />
                        {po.sent_at && <> · sent {new Date(po.sent_at).toLocaleDateString()}</>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {po.pdf_url && (
                        <a href={po.pdf_url} target="_blank" rel="noreferrer" className="text-xs text-[var(--color-accent)] hover:underline">Open PDF</a>
                      )}
                      <button
                        onClick={() => regeneratePoPdf.mutate(po.id)}
                        disabled={regeneratePoPdf.isPending}
                        className="h-7 px-2 text-xs rounded border border-[var(--color-border)] inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <RefreshCw size={11} /> Regenerate PDF
                      </button>
                      <EmailPoButton onSend={override => emailPo.mutate({ poId: po.id, overrideTo: override })} supplierEmail={po.supplier?.email ?? null} />
                      {po.status === 'sent' && (
                        <button onClick={() => markPo.mutate({ poId: po.id, status: 'confirmed' })}
                          className="h-7 px-2 text-xs rounded border border-[var(--color-border)] inline-flex items-center gap-1"
                        >
                          <CheckCircle size={11} /> Confirmed
                        </button>
                      )}
                      {(po.status === 'sent' || po.status === 'confirmed') && (
                        <button onClick={() => markPo.mutate({ poId: po.id, status: 'received' })}
                          className="h-7 px-2 text-xs rounded border border-[var(--color-border)] inline-flex items-center gap-1"
                        >
                          <PackageCheck size={11} /> Received
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Build sheet + contract */}
        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Documents</h2>
            <div className="flex gap-2">
              <button
                onClick={() => generateBuildSheet.mutate()}
                disabled={generateBuildSheet.isPending}
                className="h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {generateBuildSheet.isPending && <Spinner size={13} />}
                Generate build sheet
              </button>
              <button
                onClick={() => generateContract.mutate()}
                disabled={generateContract.isPending}
                className="h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {generateContract.isPending && <Spinner size={13} />}
                Generate contract
              </button>
            </div>
          </div>
          <ul className="space-y-1">
            {(documents.data ?? []).length === 0 ? (
              <li className="text-xs text-[var(--color-muted)]">No documents yet.</li>
            ) : (
              documents.data!.map(d => (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-2">
                    <FileText size={14} className="text-[var(--color-muted)]" />
                    {d.caption ?? d.storage_path}
                  </span>
                  <a
                    href={supabase.storage.from('media').getPublicUrl(d.storage_path).data.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[var(--color-accent)] hover:underline"
                  >
                    Open PDF
                  </a>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: 'draft' | 'sent' | 'confirmed' | 'received' }) {
  const bg = status === 'draft' ? '#D9D4C7'
    : status === 'sent' ? '#D7E4D9'
    : status === 'confirmed' ? '#C7DBD1'
    : '#B5CBB2'
  return (
    <span className="inline-block px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded" style={{ backgroundColor: bg }}>
      {status}
    </span>
  )
}

function EmailPoButton({ onSend, supplierEmail }: { onSend: (override?: string) => void; supplierEmail: string | null }) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-7 px-2 text-xs rounded border border-[var(--color-border)] inline-flex items-center gap-1"
      >
        <Mail size={11} /> Email PO
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-md p-4 w-80 text-sm" onClick={e => e.stopPropagation()}>
            <h3 className="font-medium mb-2">Email PO</h3>
            <p className="text-xs text-[var(--color-muted)] mb-2">
              Supplier: {supplierEmail ?? 'no email on file'}
            </p>
            <label className="block text-xs mb-1">Override recipient (optional)</label>
            <input
              className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm"
              placeholder={supplierEmail ?? 'test@humblehouse.dev'}
              value={to}
              onChange={e => setTo(e.target.value)}
            />
            <div className="flex gap-2 justify-end mt-3">
              <button onClick={() => setOpen(false)} className="h-8 px-3 text-xs rounded border border-[var(--color-border)]">Cancel</button>
              <button
                onClick={() => { onSend(to || undefined); setOpen(false); setTo('') }}
                className="h-8 px-3 text-xs rounded bg-[var(--color-accent)] text-white"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
