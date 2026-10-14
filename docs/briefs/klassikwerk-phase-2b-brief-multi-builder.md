# Phase 2b — Multi-builder platform

Turn the KlassikWerk app into a white-label platform where any builder can be loaded with its own catalog, branding, pricing, payment schedule and contract wording. KlassikWerk is builder #1 and the demo content. Humble House is the operator.

Read `docs/briefs/klassikwerk-phase-1-brief.md` and `klassikwerk-phase-2-brief.md` first. Check `git log` and the open PRs: if Phase 2 is mid-build, finish it on `feat/phase-2` first, merge, then branch `feat/phase-2b` from `main`. If Phase 2 is already merged, branch from `main`. One PR. Save this file as `docs/briefs/klassikwerk-phase-2b-brief-multi-builder.md`.

## The model

```
operators            Humble House (one row now; the platform owner)
builders             KlassikWerk, Theon Design, Morgan …  (operator_id)
  builder_brand      logo, wordmark, colours, fonts, tone copy, domain
  builder_terms      payment schedule, warranty text, governing law, lead-time copy
  contract_templates versioned contract body per builder, merge fields
  catalog_*          every catalog table gains builder_id
builds               gains builder_id; customers can have builds with several builders
```

Everything a customer or ops user sees is resolved from one builder context. Nothing about KlassikWerk is hard-coded anywhere after this phase: grep for "KlassikWerk", "Klassik", "Mercedes", "G-Class", "Hydes", "Blaupunkt" in `src/` — every hit becomes data.

## Schema

- `operators`: `slug`, `name`, `brand jsonb`. Seed: humble-house.
- `builders`: `operator_id`, `slug`, `name`, `legal_name`, `active`, `sort`. Seed: klassikwerk.
- `builder_brand`: `builder_id`, `logo_url`, `wordmark_text`, `color_accent`, `color_bg`, `color_text`, `font_display`, `font_body`, `tagline`, `hero_copy`, `process_copy jsonb` (the eight stages, builder-worded), `custom_domain`. Seed from current Phase 1 tokens and copy.
- `builder_terms`: `builder_id`, `reservation_cents`, `payment_schedule jsonb` (ordered list of `{label, percent, trigger}`), `warranty_text`, `governing_law`, `lead_time_copy`, `currency`. Seed KlassikWerk: 10,000 reservation; 50 / 40 / 10 at contract / paint-and-interior sign-off / delivery; 12 months 12,000 miles workmanship; Florida.
- `contract_templates`: `builder_id`, `version`, `title`, `body_markdown`, `merge_fields jsonb`, `is_current`. Seed one KlassikWerk Work Authorization template with merge fields: customer name, address, vehicle, VIN, configuration table, price, payment schedule, warranty, governing law, signature block.
- Add `builder_id` (not null, fk) to `catalog_platforms`, `catalog_tiers`, `catalog_option_groups`, `catalog_options`, `catalog_platform_gallery`, `builds`. Backfill all existing rows to klassikwerk. Unique constraints become `(builder_id, slug)`.
- `profiles.role` gains `operator` (sees all builders) alongside `ops` (scoped to builders in `profile_builders`). Add `profile_builders (profile_id, builder_id)`. Elliot is `operator`.
- `customers` unchanged; builds link customer to builder.

RLS: public read of catalog where `active` and builder `active`; customer reads own builds; `ops` reads/writes rows whose `builder_id` is in their `profile_builders`; `operator` reads/writes everything.

## Builder resolution (public)

- Path-based by default: `/b/:builderSlug/...` for every public route (home, platforms, process, configure, reserve).
- `/` with no builder is the operator landing: Humble House header, list of active builders as cards, each linking into its branded site.
- If `builder_brand.custom_domain` matches `window.location.hostname`, resolve the builder from the domain and drop the `/b/:slug` prefix. Document the Netlify domain-alias step in README.
- Builder context is a React provider; brand tokens are applied as CSS variables on `:root` from `builder_brand` so the whole public surface restyles per builder. Fonts load from Google Fonts by name.

## Configurator and reservation

Unchanged in behaviour, but every query is scoped by builder, prices and reservation amount come from `builder_terms`, success page copy and the confirmation email come from the builder's brand and terms. Stripe Checkout metadata carries `builder_id`. One Stripe account for now (Humble House's); add `builders.stripe_account_id` nullable for later Connect split, unused in this phase.

## Contract generation

- Edge Function `render-contract`: takes `build_id`, loads the builder's current `contract_templates` row, merges fields from build / customer / vehicle / configuration / terms, renders Markdown to PDF (use a server-side Markdown → HTML → PDF path; pick a library that runs in Deno and document it), stores it in `media` as kind `document`, returns the URL.
- `/ops/builds/:id` gains "Generate contract" and shows generated versions. DocuSign send is Phase 3; stop at the PDF.
- `/ops/builders/:id/contract` — edit the template body (Markdown editor with a merge-field picker), save as a new version, set current. Show a live preview rendered against a sample build.

## Ops back office

- Sidebar gains a builder switcher at the top (operator sees all; ops sees theirs). Every ops page is scoped to the selected builder.
- `/ops/builders` (operator only): list, add, activate. Add-builder wizard: name and slug → brand (logo upload, colours with live preview, fonts, tagline) → terms (schedule editor) → contract template (starts from a generic template) → done, with a link to the builder's public site.
- `/ops/builders/:id/brand`, `/terms`, `/contract` as edit pages for the above.
- Catalog admin unchanged, now scoped to the selected builder.
- Clone: on the Platforms tab, "Copy from builder…" to copy a platform with its option groups and options into the current builder, for fast onboarding of similar builders.

## Demo readiness

The whole point is to drop a builder in live in front of them. Seed a second builder, `demo-builder`, inactive, with a neutral brand (grey, generic fonts, "Your Builder" wordmark), one platform, one tier and six options, so the add-builder flow can be shown without touching KlassikWerk. Operator can activate it for a demo and deactivate after.

## Done means

- PR open, preview green, no console errors.
- `/` shows the Humble House operator page; `/b/klassikwerk` is pixel-identical to the pre-phase KlassikWerk site; `/b/demo-builder` renders the neutral brand.
- Grep for the hard-coded strings above returns only seed files and briefs.
- Operator can add a builder end to end in the wizard and see its public site.
- Catalog admin, builds list, configurator, reservation all work scoped to the selected builder, including Stripe test checkout and the confirmation email in the builder's branding.
- Generate contract on a KlassikWerk build produces a PDF with every merge field filled.
- README documents the builder model, how to add a builder, and the custom-domain step.

Report the preview URL and any decision this brief did not cover.
