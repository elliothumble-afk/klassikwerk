// Sales-tax computation shared between the client (quote editor) and
// the PDF renderers. Keep the formula here so there's exactly one
// implementation on both sides of save → render.

export interface TaxRates {
  tax_rate_pct: number        // e.g. 0.06
  surtax_pct: number          // e.g. 0.005
  surtax_cap_cents: number    // e.g. 500000 ($5,000)
}

export interface TaxLine {
  // Line total in cents. For sold-as-set lines this is the whole-set
  // total — the surtax cap applies to the set as one item.
  total_cents: number
}

export interface TaxResult {
  base_cents: number    // tier base + Σ line totals (the tax base)
  tax_cents: number     // base × rate + Σ per-line min(line, cap) × surtax
}

// Tier base participates in the tax base AND in the surtax (as a line
// in its own right). KlassikWerk / ECD pass 0 rates and the function
// returns tax_cents = 0.
export function computeQuoteTax(
  rates: TaxRates, tierBaseCents: number, lines: TaxLine[],
): TaxResult {
  const linesSum = lines.reduce((s, l) => s + Math.max(0, l.total_cents), 0)
  const base = tierBaseCents + linesSum
  if (rates.tax_rate_pct === 0 && rates.surtax_pct === 0) {
    return { base_cents: base, tax_cents: 0 }
  }
  const baseTax = Math.round(base * rates.tax_rate_pct)
  const cap = rates.surtax_cap_cents
  const perLineSurtax = lines.reduce(
    (s, l) => s + Math.round(Math.min(Math.max(0, l.total_cents), cap) * rates.surtax_pct),
    0,
  )
  const tierSurtax = Math.round(Math.min(tierBaseCents, cap) * rates.surtax_pct)
  return { base_cents: base, tax_cents: baseTax + perLineSurtax + tierSurtax }
}
