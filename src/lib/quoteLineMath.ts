// Single source of truth for per-line arithmetic on a quote option.
//
// All three customer-facing surfaces — the /q page, the Lookbook PDF
// Investment table, and the renderPdf lookbook input builder — call
// this function with the same (qo, opt) inputs so a line price can
// never diverge between them. Drift between /q and the lookbook
// (Wide Track $27,091 vs $27,025 on Jimmie v2) is specifically what
// this prevents.
//
// Priority order for the parts component:
//   1. quote_options.parts_sell_cents — the save-time snapshot
//      (already × qty at save time for multi-unit lines).
//   2. catalog_options.parts_sell_cents × effective qty — fallback
//      for legacy quotes that pre-date the phase-5 snapshot column.
//      Only available when the caller has read access to the live
//      catalog (ops / renderPdf). /q callers pass undefined here.
//   3. quote_options.price_cents_at_selection × effective qty —
//      last-resort legacy fallback.
//
// Install is strictly the snapshot labour + materials. Never pulled
// from catalog_options.install_price_cents (the pre-fix /q bug).
//
// Effective qty collapses to 1 when sold_as_set is true, because a
// sold-as-set option's parts snapshot already represents the whole
// set.

export interface QuoteLineQo {
  parts_sell_cents: number | null
  labour_cents: number | null
  materials_cents: number | null
  price_cents_at_selection: number
  quantity: number | null
}

export interface QuoteLineOpt {
  sold_as_set: boolean
  parts_sell_cents?: number | null  // present only in operator contexts
}

export function lineCents(qo: QuoteLineQo, opt: QuoteLineOpt): number {
  const qty = qo.quantity ?? 1
  const effQty = opt.sold_as_set ? 1 : qty
  const partsSell = qo.parts_sell_cents
    ?? ((opt.parts_sell_cents ?? qo.price_cents_at_selection) * effQty)
  const install = (qo.labour_cents ?? 0) + (qo.materials_cents ?? 0)
  return partsSell + install
}
