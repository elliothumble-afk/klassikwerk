# Phase 4 — Synced builders (ECD Connect)

A builder's catalog, terms, brand and contract can come from an external feed instead of the HH admin. ECD is the first synced builder; its feed is served by ECD Connect. Branch `feat/phase-4` from `main`. One PR. Save this file under `docs/briefs/`.

## Schema

- `builders`: add `catalog_source` enum (`manual` | `connect`, default `manual`), `catalog_source_url`, `catalog_source_token` (stored encrypted via Vault or as an Edge Function secret keyed by builder slug — pick one, document it), `lead_intake_url`, `last_synced_at`, `last_sync_status`, `last_sync_error`.
- Every catalog table (`catalog_platforms`, `catalog_tiers`, `catalog_option_groups`, `catalog_options`, `catalog_option_platforms`, `catalog_platform_gallery`), plus `builder_brand`, `builder_terms`, `contract_templates`: add `synced boolean default false` and `external_id text`. Unique `(builder_id, external_id)` where not null.
- `sync_runs`: `builder_id`, `started_at`, `finished_at`, `status`, `counts jsonb` (inserted/updated/deactivated per table), `error`.

## Sync

- Edge Function `sync-builder-catalog`: takes `builder_id`. Fetches the feed with the bearer token, validates against a zod schema, then upserts in dependency order (brand, terms, contract template as a new version if the body hash changed, platforms, tiers, groups, options, option-platforms). Anything previously synced but absent from the feed → `active = false`, never deleted. Sets `synced = true`, `external_id` from the feed slugs. Writes a `sync_runs` row. Idempotent.
- Trigger: "Sync now" button on `/ops/builders/:id`, and a nightly cron (`pg_cron` calling the function via `pg_net`, or Supabase scheduled function — document which).
- Synced rows are read-only in the catalog admin, brand, terms and contract editors: inputs disabled, a banner "Managed by ECD Connect — last synced <time>", with the Sync now button.
- The builder wizard gains a first step: Manual or Connect. Connect asks for feed URL, token and lead-intake URL, tests the feed, and pulls brand from it rather than asking.

## Quote handoff

- On quote approval for a builder with `lead_intake_url`, Edge Function `push-quote-to-builder` POSTs the spec (customer, platform/tier/option slugs, price, quote PDF URL, HH quote id, notes) to the builder's intake endpoint. Logs to `zoho_sync_log`-style table `builder_push_log` with retry from the quote page. The lead's timeline shows "Sent to ECD Connect".
- `option_mode` for ECD = `priced` (upgrades carry prices); KlassikWerk stays `included_only`. The configurator already handles both.

## Seed

- Add builder `ecd` (ECD Auto Design), `catalog_source = connect`, URLs and token from Elliot, `active = false` until first sync succeeds.

## Done means

- Adding ECD through the wizard pulls brand, terms, contract and all four platforms with options; Sync now re-runs cleanly; removing an option in Connect deactivates it here on the next sync.
- A quote for a Defender 110 renders a branded ECD PDF with the 25/25/25/25 schedule and ECD contract wording.
- Approving it creates a lead in Connect's CRM.
- README documents the feed contract and how to add another synced builder.
