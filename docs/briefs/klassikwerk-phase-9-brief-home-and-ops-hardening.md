# Phase 9 — Home page, Connect polish, scheduled jobs and key rotation

Three pieces, one PR `feat/phase-9` from `main`. Save this file as `docs/briefs/klassikwerk-phase-9-brief-home-and-ops-hardening.md`. Test only on `Test*` customers; never print a key, token or password in output.

## 1. Home (`/ops`, before any builder is chosen)

The team sells across builders, so the first screen is cross-builder. The builder selector stays where it is; Home sits above it.

- **My work** — for the signed-in user: leads waiting for a quote, quotes sent and unanswered (with days since sent), builds in progress. Each row links into the right builder context.
- **Pipeline this month** — one row per builder: quotes sent / approved / value, deals signed, payments received. Includes Connect-sourced ECD quotes.
- **My commissions** — unpaid and paid year-to-date, link to `/ops/me`.
- **Recent activity** — last 20 events across builders: sent, approved, contract signed, payment received, build milestone, Connect events included. Each links to the quote.
- Admins see team totals; reps see their own.

## 2. Connect quotes polish

- Badge reads **Connect** (builder name on hover), not "BUILDER".
- Version column shows the Connect reference (QV2-…) for Connect quotes; HH's counter is only on the summary page.
- Void / superseded / expired quotes sort below live ones and are collapsed under "Show closed (n)".
- Summary page: status timeline (sent → signed → payments → milestones) reads top to bottom with dates.

## 3. Scheduled jobs

- Create the Supabase secret API key for server jobs if not already done in this PR's key work (see 4), store it in Vault as `service_key`, and schedule with pg_cron from the README SQL: nightly `sync-builder-catalog` for every `catalog_source='shopify'` builder at 03:00 America/New_York, daily `refresh-fx-rates` at 06:00. Each run writes to `sync_runs` and the sync report email goes out as before. `/ops/builders/:id` shows last run and next run.
- Add a weekly "Pull everything from Connect" for each builder with a `backfill_url`, Sundays 04:00, as a safety net for missed deliveries.

## 4. Key rotation (do this first, before anything else in the PR)

- Create a new Supabase **secret** API key (new-style `sb_secret_…`) via the Management API using the CLI access token. Update every consumer: edge function secrets, the Playwright test runner's env, `.env.local` (git-ignored), the GitHub Action secret if one exists. Remove any legacy `service_role` JWT from scripts, docs and `.env*` files; grep the repo and git history for `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` and report every hit.
- Then **disable the legacy service_role key** in the project's API settings so the exposed key stops working. Confirm with a request using the old key → 401.
- The database password is rotated by Elliot in the dashboard (Settings → Database → Reset). The repo and CC must not need it: confirm `supabase db push --linked` works with the CLI access token alone.
- Report: which consumers were updated, that the old key returns 401, and anything that still needs the old key.

## Done means

- Home renders for an admin and for a rep with correct scoping; all links resolve.
- Connect quotes list and summary match section 2; existing CTC flows unchanged (re-render Jimmie v2 read-only, totals identical).
- `cron.job` shows the three schedules; running each function by hand succeeds and shows under last run.
- Old service_role key returns 401; all tests green with the new key; no key material in the PR, logs or report.

Report the preview URL and any decision this brief did not cover.
