# Phase 5 — Cost-based pricing for synced builders

Quotes for Chelsea Truck Company (and any Shopify-synced builder) currently price an option as `web price × fx × markup`. Replace that with the Build House costing model: **parts sell at the builder's retail price in USD plus landing costs, and every line carries its install and paint labour**, with cost rules set once per category rather than per item. Branch `feat/phase-5` from `main` (merge PR #7 first). One PR. Save this file as `docs/briefs/klassikwerk-phase-5-brief-cost-based-pricing.md` and the seed as `docs/seeds/ctc-categories-seed.csv`.

The reference model is `CTC-Build-House-Costing.xlsx` (sheets Assumptions, Origins, Categories, Catalog, Quote Calculator). Match its arithmetic exactly; it is the spec.

## Schema

- `origins` (per builder): `name`, `tariff_pct`, `s232_aluminium_pct`, `notes`. Seed CTC: United Kingdom 10% / 0%; Taiwan 15% / 50%; China 45% / 50%.
- `catalog_categories` (per builder): `name`, `install_hours`, `paint_hours`, `paint_materials_cents`, `freight_cents`, `hts_duty_pct`, `default_origin_id`, `shopify_tags text[]` (filter-tag values that map to this category), `sort`. Seed CTC from the CSV (30 rows).
- `catalog_options`: add `category_id` (nullable fk), `origin_id` (nullable override), `web_price_cents` (retail in source currency, as synced), `source_currency` (default GBP). Keep `price_cents` as the **computed sell price** so nothing downstream changes.
- `builder_terms`: add `trade_discount_pct` (0.25), `labour_rate_cents` (20000), `paint_rate_cents` (20000), `partner_shop_rate_cents` (11000, internal), `mpf_pct` (0.003464), `brokerage_cents` (15000), `items_per_shipment` (6), `aluminium_share_pct` (0.40), `hh_fee_pct` (0.05, internal), `pricing_mode` enum `simple | cost_based` (CTC = cost_based; KlassikWerk and ECD stay `simple`, untouched). Drop `kit_markup` from the Terms UI for cost_based builders (keep the column).
- `quote_options`: add a cost snapshot taken at save time — `parts_sell_cents`, `landed_cost_cents`, `labour_cents`, `materials_cents`, `partner_cost_cents`. Quotes must not reprice when terms change later.

## Pricing (cost_based)

Per option, in USD:
```
retail_usd      = web_price × fx_rate
kit_cost        = retail_usd × (1 − trade_discount)
freight         = category.freight
duty            = kit_cost × category.hts_duty_pct
tariff          = kit_cost × origin.tariff_pct
s232            = category is wheels ? kit_cost × aluminium_share × origin.s232_pct : 0
fees            = kit_cost × mpf_pct + brokerage / items_per_shipment
landed          = kit_cost + freight + duty + tariff + s232 + fees
parts_sell      = retail_usd + freight + duty + tariff + s232 + fees
labour          = install_hours × labour_rate + paint_hours × paint_rate
install_price   = labour + paint_materials
price_cents     = parts_sell + install_price            ← stored on catalog_options
```
Origin = option override, else category default. Quantity (sets of 4/5) multiplies parts only, not labour. `sold_as_set` options price once.

A DB function `reprice_builder(builder_id)` recomputes `price_cents` for every option; the sync calls it at the end of each run, and saving Terms, a Category or an Origin calls it too. `price_cents` is never written by hand for cost_based builders.

## Sync

- Store `web_price_cents` and `source_currency` from the Shopify variant.
- Assign `category_id` by matching the product's `filter-exterior=` / `filter-interior=` tag values against `catalog_categories.shopify_tags` (first match wins, in the category sort order). Wheels group → Alloy wheels. No match → category "Other" and a flag in the sync report.
- Never overwrite a category or origin that an ops user has set by hand (track `category_locked`).

## Ops

- `/ops/builders/:id/costing`: three tabs — Terms (the new fields), Categories (editable grid, the seed values, item count per category), Origins. Saving any of them reprices and shows "Repriced 212 options".
- Catalog admin: option row shows category (dropdown) and origin override; a cost drawer shows the full breakdown above for that option.
- Quote editor: unchanged for the customer-facing numbers; add an internal "Margin" panel (ops only) — sale price, parts landed, partner labour, HH fee at `hh_fee_pct`, gross margin after HH in $ and %. Red below 20%, amber below 25%.
- Quote PDF and `/q` page: each line shows one price (parts + fitting). Add a single footnote: "Prices include import shipping, duties and fitting." Contract configuration table unchanged.
- Dashboard: average margin after HH across sent quotes, per builder.

## Done means

- CTC Grenadier quote with WAKMF9268M1F-KIT, 5× WAKRF9468M1F-1, LSCIC24SDWS3N, ECIG2DSSCB and the Chelsea Conversion base at $1,500 totals **$44,312** and the margin panel shows **$11,345 / 25.6% after HH** — the same as the workbook's Quote Calculator.
- Changing the Body kit install hours in Categories changes that quote's new-line price immediately; an already-sent quote keeps its snapshot.
- KlassikWerk and ECD quotes are byte-identical to before this phase.
- README documents the pricing formula and how to calibrate categories from a real job.

Report the preview URL and any decision this brief did not cover.
