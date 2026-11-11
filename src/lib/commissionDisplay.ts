// Per-quote commission display helper.
//
// A quote's commission row (if any) is in the `commissions` table.
// Native CTC quotes don't get a row until the quote is approved —
// before that we compute a "pending" view from the snapshot HH writes
// onto `quotes.commission_cents` at save time (flat + optional bonus).
// Builder-source quotes (Connect/ECD) always get a row driven by
// commission.upserted, so there's nothing to compute.

export type CommissionStatus = 'pending' | 'earned' | 'paid' | 'void'

export interface CommissionDisplay {
  amountCents: number
  status: CommissionStatus
  // true when the row came from a persisted commissions record;
  // false when derived from quotes.commission_cents.
  booked: boolean
}

interface QuoteLike {
  id: string
  source: 'native' | 'builder' | string
  commission_cents: number | null
}

interface CommissionRow {
  quote_id: string | null
  amount_cents: number
  status: CommissionStatus
}

// Pick the one commission to show per quote. Non-void rows win over
// everything; among non-void rows we pick the highest amount (Connect
// re-sends the latest amount per external_id, but if a mis-synced
// duplicate ever appears we prefer the bigger figure rather than
// silently showing the smaller one).
export function commissionForQuote(
  quote: QuoteLike,
  rows: CommissionRow[] | undefined,
): CommissionDisplay | null {
  const booked = (rows ?? [])
    .filter(r => r.quote_id === quote.id && r.status !== 'void')
    .sort((a, b) => b.amount_cents - a.amount_cents)[0]
  if (booked) {
    return { amountCents: booked.amount_cents, status: booked.status, booked: true }
  }
  // Only native quotes get a computed pending — builder quotes rely on
  // Connect having sent a commission.upserted. If one hasn't arrived
  // yet, that's "—" rather than a fiction.
  if (quote.source === 'native' && (quote.commission_cents ?? 0) > 0) {
    return { amountCents: quote.commission_cents!, status: 'pending', booked: false }
  }
  return null
}

// Sum of non-void commissions across a set of quotes. Consistent with
// commissionForQuote's one-per-quote rule.
export function sumCommissions(
  quotes: QuoteLike[],
  rows: CommissionRow[] | undefined,
): number {
  let total = 0
  for (const q of quotes) {
    const c = commissionForQuote(q, rows)
    if (c) total += c.amountCents
  }
  return total
}

export function formatCommission(c: CommissionDisplay): string {
  return `$${(c.amountCents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function commissionBadgeBg(status: CommissionStatus): string {
  switch (status) {
    case 'pending': return '#E6E1D4'
    case 'earned':  return '#D7E4D9'
    case 'paid':    return '#B5CBB2'
    case 'void':    return '#E8D7D7'
  }
}
