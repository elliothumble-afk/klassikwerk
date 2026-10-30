# Phase 6 — Lookbook quote PDF

Branch `feat/phase-6` from `main`, one PR. Save this as
`docs/briefs/klassikwerk-phase-6-brief-lookbook-pdf.md`. Copy
`~/Downloads/Mitchells_Defender_110_Package.pdf` to `docs/seeds/` and
match its structure, type scale and palette exactly: 16:9 landscape,
deep green (`#2B4A3E`) and cream (`#F2EFE6`) pages, serif display
(Cormorant Garamond, bundled TTF), DM Sans body, small-caps bronze
section labels (`#8B6B3E`).

## Data

- Sync captures Shopify `body_html` → `catalog_options.description`
  (plain text; first two sentences used as page copy) and all product
  images → `catalog_option_images (option_id, url, sort)`. Ops can
  override the description and pick the lead image in the catalog
  edit modal.
- `catalog_categories` gains `lookbook_section` and `lookbook_sort`.
  Seed CTC:
  - Body kit / Front bumper / Grille / Bonnet → **The Face**
  - Wheel arches / Roof spoiler / Roof light bar / Roof rack →
    **The Silhouette**
  - Bonnet vents / Side vents / Storage box / Door mask →
    **Carbon Accents**
  - Spare wheel cover / Decals / Fuel cap / Side steps / Side ladder
    → **The Finishing Touch**
  - Exhaust / Suspension → **Underneath**
  - Leather interior / Steering wheel / Floor mats / Floor carpet /
    Interior trim kit / Interior hardware / Pedals / Gear shift trim
    → **Inside**
  - Alloy wheels / Tyres → **Wheels**
- `catalog_platforms` gains `lookbook_copy` (one paragraph for "The
  Foundation"); `hero_image_url` already exists. Seed a sentence for
  each CTC platform.
- `quotes` gains `theme_words` (e.g. "Carbon · Bronze · All-Terrain")
  and `vehicle_colour` — the customer's existing vehicle colour; we
  do not repaint the car. Both editable on the quote editor;
  `vehicle_colour` also on the lead.
- `builder_brand` gains `lookbook_statement`; seed CTC
  "Finished to order, built in Florida."
- `profiles` gains `title` and `phone`; the PDF signs off with the
  ops user who sent the quote.

## PDF — cost_based builders only

Replaces the quote PDF for cost_based builders only; KlassikWerk and
ECD unchanged.

1. **Cover** — builder logo, "PREPARED FOR {first name}", "The
   {platform name}", "A {builder} commission, curated by {operator}",
   theme words.
2. **Your {platform}** — platform name + `lookbook_copy`; right
   column a single swatch card for the vehicle colour (plus the
   interior colour if a leather interior is on the quote).
3. **The Mood** — platform hero image full-bleed; beneath it
   swatches for the vehicle colour and each finish chosen on the
   quote (Exposed Carbon, Black Raptor, wheel finish…).
4. **One page per selected option**, image alternating left/right,
   section label from `lookbook_section`, name, description, then
   the chosen finish and note as the small line. Options in "Wheels"
   render together as cards on one page titled "Your Wheels" with
   the size from the Shopify tag; tyres as a sentence beneath.
5. **Statement** — green page with
   `builder_brand.lookbook_statement`.
6. **At a Glance** — the table exactly as the reference: Base
   vehicle, Vehicle colour, then one row per `lookbook_section`
   listing the option names.
7. **Investment** — table Item · Finish · Qty · Price grouped by
   section, prices including fitting as today; Chelsea Conversion
   base line; subtotal; payment schedule from `builder_terms`;
   validity date; footnote "Prices include import shipping, duties
   and fitting."
8. **Closing** — builder logo, "Let's design yours together.", the
   sending ops user's name, title, phone, email.

Page order follows `lookbook_sort`.

## Done means

The Grenadier test quote renders as a 12+ page lookbook with every
image present, no placeholder text, and the Investment total equals
the quote total. Report the preview.
