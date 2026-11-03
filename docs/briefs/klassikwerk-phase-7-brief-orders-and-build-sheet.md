# KlassikWerk — Phase 7 brief

**Scope:** order sheets (per-supplier purchase orders) + build sheet.
Everything downstream of "customer approves the quote" — turning
accepted lines into supplier POs and an installer-facing build sheet.

## Schema

- `suppliers`: `(id, builder_id, name, email, cc_email, currency,
  address, order_notes, lead_time_days, created_at, updated_at)`.
- Seed for CTC:
  - **Chelsea Truck Company / Kahn Design** — GBP, email blank for
    Elliot to fill (CTC confirms Afzal's order address).
  - **TR Wholesale** — USD.
- `catalog_options.supplier_id` nullable FK.
  - Synced Shopify options default to Kahn.
  - Manual options are chosen in the catalog edit modal; tyres
    default to TR Wholesale.
- `builds.install_instructions` text (markdown).
- `build_options.instruction` text, `build_options.received_at`
  timestamptz.
- `purchase_orders`: `(id, build_id, supplier_id, number, status,
  currency, subtotal_cents, pdf_url, sent_at, sent_to,
  confirmed_at, received_at, created_at, updated_at)`.
  - `status`: `draft | sent | confirmed | received`.
- `purchase_order_lines`: `(id, po_id, build_option_id, sku,
  description, qty, unit_cost_cents, finish, note, created_at,
  updated_at)`.

## Purchase orders

- On build creation (QuoteEditor "Create contract"), generate one
  **draft** PO per supplier referenced by the build's lines.
- Unit cost = our cost in the supplier's currency:
  - Synced options → `web_price_cents × (1 − trade_discount_pct)`
    in GBP for Kahn.
  - Manual options → `cost_cents` directly.
- Lines with `kit_sku_placeholder=true` get a red "CONFIRM PART
  NUMBER" flag in the PDF.
- PDF (portrait, HH letterhead from `operators.brand`): PO number,
  date, supplier block, ship-to (HH operator contact), vehicle
  (platform, year, VIN if known), lines (SKU · description ·
  finish/variant · qty · unit · total), subtotal, notes from
  `suppliers.order_notes`, "Please confirm availability and lead
  time."
- Build page gains an **Orders** tab:
  - PO list with status badges.
  - Regenerate (re-renders PDF).
  - Email PO (Resend; to `supplier.email` + `cc_email`; PDF
    attached; from the sending ops user via Resend; logs
    `sent_at` / `sent_to`).
  - Mark Confirmed / Received with a date.

## Build sheet

- PDF (portrait) for the installer, regenerated on demand from the
  build page.
- Header: build number, customer name, vehicle (platform, year,
  colour, VIN, mileage in), key dates, HH contact.
- "Instructions" section = `builds.install_instructions` rendered
  from markdown.
- Lines grouped by lookbook section:
  - Thumbnail, name, SKU, qty, finish + finish note, per-line
    instruction, install hours, paint hours, materials.
  - Three checkboxes per line: received · fitted · checked.
  - Tyres and wheels grouped together with sizes.
- Footer: sign-off boxes for installer and HH inspector.
- Build page:
  - Markdown textarea for `install_instructions`.
  - Per-line instruction field in the build's option list.
  - "Generate build sheet" button; PDFs stored in media with
    version numbers.

## Done

Approve Jimmie's quote → build created with 2 draft POs (Kahn in
GBP with ~16 lines, TR Wholesale in USD with the tyres) → Email PO
sends to a test address with the PDF → build sheet renders with
instructions and per-line notes. Playwright test for the PO totals
matching the build's parts cost.
