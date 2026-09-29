# KlassikWerk — Phase 1 brief

Scaffold, schema, catalog admin. Run this end to end, open one PR, stop.

## Accounts (personal, not ECD)

- GitHub: new repo `klassikwerk` under Elliot's personal account. No ECD org, no ECD collaborators.
- Supabase: new project `klassikwerk` in the same personal organization as NowImportable. Region us-east-1.
- Netlify: new site `klassikwerk` on the same personal team as NowImportable. Link to the repo, deploy previews on every PR.
- Stripe: new account or separate business under Elliot's personal Stripe login. Test keys only in Phase 1.
- Nothing in this repo references ECD, ecd-connect, or any ECD Supabase project. Grep before opening the PR.

## Stack

- Vite, React 19, TypeScript, Tailwind v4, react-router v7, @tanstack/react-query, @supabase/supabase-js, zod
- No component library. Plain Tailwind. Design tokens in `src/styles/tokens.css`: warm off-white background, near-black text, one accent (deep green #2E3B2B), serif display font for headings (Fraunces via Google Fonts), sans for body (Inter).
- Migrations: `supabase/migrations/YYYYMMDDHHMM_description.sql`, forward-only.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. `.env.example` committed, `.env` ignored.

## Routes

```
/                      public shell (Phase 2 fills it)
/portal/*              customer shell, auth required, role customer
/ops/*                 back office shell, auth required, role ops
/ops/catalog           catalog admin (this phase)
/auth/login /auth/callback
```

Auth: Supabase magic link only. `profiles` row created by trigger on signup with `role` default `customer`. Elliot's email seeded as `ops`.

## Schema

All tables `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at` (trigger). RLS on every table.

**Catalog**
- `catalog_platforms`: `slug`, `name`, `chassis` (W463 / R129 / W124), `years`, `hero_image_url`, `sort`, `active`
- `catalog_tiers`: `slug`, `name` (Klassik / Klassik Plus / Werk), `base_price_cents`, `lead_time_weeks`, `description`, `quote_only bool`, `sort`
- `catalog_option_groups`: `platform_id nullable` (null = all platforms), `slug`, `name`, `selection` (single / multi), `required bool`, `sort`. Seed groups: exterior colour, leather, walnut, wheels, seats, audio, extras.
- `catalog_options`: `group_id`, `slug`, `name`, `code` (e.g. Hydes 6113, MB 359), `price_cents`, `included_in_tier_ids uuid[]`, `swatch_image_url`, `sort`, `active`
- `catalog_option_platforms`: `option_id`, `platform_id` (restrict an option to platforms; empty = all)

**Core (created now, used from Phase 2)**
- `profiles`: `user_id fk auth.users`, `role` (customer / ops / partner), `full_name`, `phone`
- `customers`: `profile_id`, `address jsonb`, `source` (web / humble_house / referral)
- `vehicles`: `customer_id`, `platform_id`, `vin`, `year`, `mileage`, `colour_original`, `notes`
- `builds`: `customer_id`, `vehicle_id`, `platform_id`, `tier_id`, `stage` enum (configured, reserved, intake, samples, contract, build, delivery, aftercare, closed), `slot_year`, `slot_number`, `price_cents`, `notes`
- `build_options`: `build_id`, `option_id`, `price_cents_at_selection`
- `build_stage_events`: `build_id`, `from_stage`, `to_stage`, `by_profile_id`, `note`
- `media`: `build_id nullable`, `option_id nullable`, `storage_path`, `kind` (swatch / hero / build_photo / document), `caption`

Storage bucket `media`, public read for `swatch` and `hero`, authenticated for the rest.

**RLS**
- Catalog tables: public read where `active`, ops write.
- Core tables: customer reads rows where `customer_id` resolves to their profile; ops reads and writes all; partner role reserved, no access yet.

## Seed

Seed `supabase/seed.sql` with:
- 3 platforms: W463 G-Class (1999–2006), R129 SL (1990–2002), W124 E-Class (1992–1996)
- 3 tiers: Klassik $70,000 / 12 wk, Klassik Plus $110,000 / 18 wk, Werk quote_only
- Options: exterior colours Alanite Green (MB 6113... use code `MB-ALANITE`), Chalcedon Blue 347, Tanzanite Blue 359; leather Hydes Thema 6113 Greige, Chalk, 2617 Anthracite; walnut Classic Burl; wheels Period-correct refinish (included in Plus), new set; seats Standard retrim (included), Scheel-Mann (G only, +$6,000); audio Blaupunkt Frankfurt RCM 82 DAB (included), hidden retractable screen (+$4,500); extras retro carphone (included).

## Catalog admin (`/ops/catalog`)

One page, three tabs: Platforms, Tiers, Options.
- Tables with inline edit, add row, deactivate. Drag to reorder updates `sort`.
- Options tab grouped by option group; each row shows swatch thumbnail, name, code, price, included-in-tier checkboxes, platform restriction chips.
- Swatch upload straight to the `media` bucket, URL written back to `swatch_image_url`.
- Optimistic updates with react-query; zod validation on every form.
- Empty and error states designed, not default.

## Done means

- PR `feat/phase-1` open against `main`, Netlify deploy preview green.
- Migrations applied to the Supabase project, seed run.
- Elliot can log in via magic link, land on `/ops/catalog`, edit a price, upload a swatch, and see it persist after reload.
- README documents: the three surfaces, how to run locally, how to add a migration, which accounts this project lives in.
- No TODOs, no placeholder components, no console errors on the preview.

Report back with the preview URL and any decision you had to make that this brief did not cover.
