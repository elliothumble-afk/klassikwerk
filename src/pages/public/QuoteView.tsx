import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { invokeFn } from '@/lib/fnInvoke'
import { Spinner } from '@/components/ui/Spinner'

interface QuoteData {
  quote: {
    id: string
    version: number
    price_cents: number
    status: 'draft' | 'sent' | 'approved' | 'superseded'
    pdf_url: string | null
    token: string
    created_at: string
    approved_at: string | null
    lead: { customer: { full_name: string | null; email: string | null } | null } | null
    builder: { id: string; name: string; legal_name: string | null; slug: string }
    platform: { name: string; chassis: string; years: string } | null
    tier: { name: string; base_price_cents: number | null } | null
  }
  brand: {
    wordmark_text: string | null
    logo_url: string | null
    tagline: string | null
    color_accent: string
    color_bg: string
    color_text: string
    font_display: string
    font_body: string
  } | null
  terms: {
    currency: string
    payment_schedule: { label: string; percent: number; trigger: string }[]
    warranty_text: string | null
    quote_validity_days: number
    quote_intro_copy: string | null
    pricing_mode?: 'simple' | 'cost_based'
  } | null
  quote_options: {
    option_id: string
    price_cents_at_selection: number
    quantity: number
    finish_note: string | null
    catalog_options: {
      name: string
      code: string | null
      sold_as_set: boolean
      parts_sell_cents: number | null
      install_price_cents: number | null
    } | null
    quote_option_finishes: {
      finish_set_id: string
      catalog_finish_sets: { sort: number } | null
      catalog_finishes: { name: string } | null
    }[]
  }[]
}

function money(cents: number | null | undefined, currency = 'usd'): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export function QuoteView() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<QuoteData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)

  async function load() {
    try {
      const result = await invokeFn<QuoteData>('get-quote', { token })
      setData(result)
      setApproved(result.quote.status === 'approved')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  useEffect(() => {
    if (token) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Apply brand variables inline
  useEffect(() => {
    if (!data?.brand) return
    const root = document.documentElement
    root.style.setProperty('--color-accent', data.brand.color_accent)
    root.style.setProperty('--color-background', data.brand.color_bg)
    root.style.setProperty('--color-foreground', data.brand.color_text)
    root.style.setProperty('--font-display', `'${data.brand.font_display}', Georgia, serif`)
    root.style.setProperty('--font-body', `'${data.brand.font_body}', system-ui, sans-serif`)
  }, [data?.brand])

  async function approve() {
    if (!token || approving) return
    setApproving(true)
    setErr(null)
    try {
      await invokeFn('approve-quote', { token })
      setApproved(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setApproving(false)
    }
  }

  if (err) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-sm text-[var(--color-danger)]">{err}</p>
      </main>
    )
  }
  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Spinner size={20} className="text-[var(--color-muted)]" />
      </main>
    )
  }

  const { quote, brand, terms, quote_options } = data
  const customer = quote.lead?.customer
  const currency = terms?.currency ?? 'usd'
  const validityDays = terms?.quote_validity_days ?? 30
  const validUntil = new Date(new Date(quote.created_at).getTime() + validityDays * 86400_000)
    .toISOString().slice(0, 10)

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-foreground)' }}>
      <header className="border-b border-[var(--color-border)]">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {brand?.logo_url ? (
            <img src={brand.logo_url} alt={brand.wordmark_text ?? quote.builder.name} className="h-8 w-auto" />
          ) : (
            <h1 className="text-2xl" style={{ fontFamily: 'var(--font-display)' }}>
              {brand?.wordmark_text ?? quote.builder.name}
            </h1>
          )}
          {brand?.tagline && <p className="text-xs text-[var(--color-muted)] mt-1">{brand.tagline}</p>}
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-3xl" style={{ fontFamily: 'var(--font-display)' }}>Quote v{quote.version}</h2>
            <p className="text-sm text-[var(--color-muted)]">
              Prepared for {customer?.full_name ?? customer?.email ?? '—'}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-[var(--color-muted)]">Total</div>
            <div className="text-3xl" style={{ fontFamily: 'var(--font-display)' }}>
              {money(quote.price_cents, currency)}
            </div>
          </div>
        </div>

        <p className="text-sm text-[var(--color-muted)] mb-6">Valid until {validUntil}</p>

        {terms?.quote_intro_copy && (
          <p className="text-sm text-[var(--color-muted)] mb-6">{terms.quote_intro_copy}</p>
        )}

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
          <h3 className="text-sm font-medium mb-3">Vehicle</h3>
          <p className="text-sm">
            {quote.platform?.name} · {quote.platform?.chassis} · {quote.platform?.years}
          </p>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
          <h3 className="text-sm font-medium mb-3">Configuration</h3>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-[var(--color-border)]">
                <td className="py-2 pr-3 text-[var(--color-muted)]">Tier</td>
                <td className="py-2 pr-3">{quote.tier?.name}</td>
                <td className="py-2 text-right">{money(quote.tier?.base_price_cents, currency)}</td>
              </tr>
              {quote_options.map(qo => {
                const qty = qo.quantity ?? 1
                const soldAsSet = qo.catalog_options?.sold_as_set ?? false
                const effectiveQty = soldAsSet ? 1 : qty
                const parts = qo.catalog_options?.parts_sell_cents
                const install = qo.catalog_options?.install_price_cents
                const costBased = parts != null && install != null
                const extended = costBased
                  ? parts * effectiveQty + install
                  : qo.price_cents_at_selection * effectiveQty
                const qtyLabel = soldAsSet
                  ? 'Set of 4'
                  : qty === 5 ? 'Set of 5 incl. spare'
                  : qty === 4 ? 'Set of 4'
                  : null
                const finishNames = (qo.quote_option_finishes ?? [])
                  .slice()
                  .sort((a, b) => (a.catalog_finish_sets?.sort ?? 0) - (b.catalog_finish_sets?.sort ?? 0))
                  .map(x => x.catalog_finishes?.name)
                  .filter((v): v is string => !!v)
                const finishBits: string[] = [...finishNames]
                if (qo.finish_note) finishBits.push(qo.finish_note)
                const finishLabel = finishBits.length ? finishBits.join(', ') : null
                return (
                  <tr key={qo.option_id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2 pr-3 text-[var(--color-muted)]">Option</td>
                    <td className="py-2 pr-3">
                      <div>
                        {qo.catalog_options?.name}
                        {finishLabel ? ` — ${finishLabel}` : ''}
                        {qo.catalog_options?.code ? ` · ${qo.catalog_options.code}` : ''}
                      </div>
                      {qtyLabel && <div className="text-xs text-[var(--color-muted)]">{qtyLabel}</div>}
                    </td>
                    <td className="py-2 text-right">
                      {extended > 0 ? money(extended, currency) : 'Included'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {terms?.pricing_mode === 'cost_based' && quote_options.length > 0 && (
            <p className="mt-3 text-xs text-[var(--color-muted)]">
              Prices include import shipping, duties and fitting.
            </p>
          )}
        </div>

        {(terms?.payment_schedule?.length ?? 0) > 0 && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
            <h3 className="text-sm font-medium mb-3">Payment schedule</h3>
            <table className="w-full text-sm">
              <tbody>
                {terms!.payment_schedule.map((p, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2 pr-3">{p.label}</td>
                    <td className="py-2 text-[var(--color-muted)]">{p.trigger}</td>
                    <td className="py-2 text-right">{p.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {terms?.warranty_text && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
            <h3 className="text-sm font-medium mb-2">Warranty</h3>
            <p className="text-sm text-[var(--color-muted)]">{terms.warranty_text}</p>
          </div>
        )}

        {quote.pdf_url && (
          <p className="text-sm mb-6">
            <a href={quote.pdf_url} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">
              Download PDF
            </a>
          </p>
        )}

        <div className="mt-10 p-6 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-accent-light)] text-center">
          {approved ? (
            <>
              <h3 className="text-xl mb-1" style={{ fontFamily: 'var(--font-display)' }}>Approved</h3>
              <p className="text-sm text-[var(--color-muted)]">We'll be in touch about the contract.</p>
            </>
          ) : quote.status === 'superseded' ? (
            <p className="text-sm text-[var(--color-muted)]">This version has been superseded.</p>
          ) : (
            <>
              <h3 className="text-xl mb-3" style={{ fontFamily: 'var(--font-display)' }}>Approve this quote?</h3>
              <p className="text-sm text-[var(--color-muted)] mb-4">
                Clicking Approve lets us begin contract preparation.
              </p>
              <button
                onClick={approve}
                disabled={approving}
                className="h-10 px-6 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {approving && <Spinner size={14} />}
                Approve
              </button>
            </>
          )}
        </div>

        <p className="text-xs text-[var(--color-muted)] text-center mt-6">
          © {new Date().getFullYear()} {quote.builder.legal_name ?? quote.builder.name}
        </p>
      </section>
    </main>
  )
}
