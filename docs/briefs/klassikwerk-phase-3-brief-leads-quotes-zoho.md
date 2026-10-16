# Phase 3 — Leads, quotes, Zoho sync

The model changes: Humble House (HH) is the only ops user, sells personally, and configures quotes for customers. The public configurator goes. Zoho CRM owns top-of-funnel; this system owns every lead from "warm" onward.

Read `docs/briefs/klassikwerk-phase-2b-brief-multi-builder.md` first. Branch `feat/phase-3` from `main` (merge PR #2 first if it isn't). One PR. Save this file as `docs/briefs/klassikwerk-phase-3-brief-leads-quotes-zoho.md`.

## Public side (per builder, `/b/:slug` or custom domain)

Reduce to a landing: hero, three platform cards with gallery, process strip, and an inquiry form (name, email, phone, platform of interest, message). Form creates a `leads` row at stage `inquiry` and emails HH. Remove `/configure`, `/reserve` and the Reserve button; keep the routes redirecting to `/b/:slug`. Operator landing at `/` becomes a Sign in page only.

## Schema

- `leads`: `builder_id`, `customer_id` (nullable until converted), `zoho_lead_id` unique nullable, `source` (zoho / site / design_centre / referral), `stage` enum (inquiry, warm, quoting, quoted, revising, contract_sent, won, lost), `owner_profile_id`, `platform_interest_id` nullable, `notes`, `lost_reason`.
- `customers`: add `zoho_contact_id` nullable.
- `builders`: add `zoho_product_id` nullable.
- `quotes`: `lead_id`, `builder_id`, `version` int, `platform_id`, `tier_id`, `price_cents`, `status` (draft, sent, approved, superseded), `pdf_url`, `sent_at`, `approved_at`, `notes`.
- `quote_options`: `quote_id`, `option_id`, `price_cents_at_selection`.
- `quote_events`: `quote_id`, `kind` (created, sent, viewed, revised, approved), `by_profile_id`, `note`.
- `builds`: add `quote_id` fk. A build is created only when a quote is approved and a contract is sent.
- `builder_terms`: add `quote_validity_days` (default 30), `quote_intro_copy`, `brochure_url`.
- `zoho_sync_log`: `direction`, `object`, `object_id`, `payload jsonb`, `status`, `error`, timestamps.

RLS as Phase 2b: ops scoped by `profile_builders`, operator sees all.

## Ops

- Sidebar: Leads, Quotes, Builds, Catalog, Builders.
- `/ops/leads`: board by stage, filters by builder and owner. Lead detail: contact, source, Zoho link, timeline, "Start quote".
- `/ops/quotes/new?lead=`: the Phase 2b configurator moved behind login, builder-scoped, with price live. Saves a quote version. Buttons: Save draft, Generate PDF, Send.
- Quote PDF: builder-branded cover, customer details, configuration table with images where swatches exist, price breakdown, validity date, payment schedule from `builder_terms`, intro copy, HH contact block. Edge Function `render-quote` reusing the `render-contract` PDF path.
- Send: email via Resend to the customer with the PDF and brochure link, from a builder-branded template; logs `quote_events.sent`. Includes a tracked link to `/q/:token` (public, read-only quote page with Approve button — no login). Approve sets status, logs the event, moves lead to `quoted`→ on approve `contract_sent` is the next manual step.
- Revise: clones the quote as version n+1, previous marked `superseded`.
- "Create contract" on an approved quote: creates the `builds` row from it and opens the Phase 2b Generate contract flow.
- Dashboard at `/ops`: leads by stage, quotes awaiting reply, builds in progress, per builder.

## Zoho sync

Edge Functions, secrets `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_DC` (us), `ZOHO_WEBHOOK_SECRET`.

- `zoho-lead-webhook` (no JWT, verifies shared secret): receives Zoho CRM workflow POST when a lead's status becomes Warm. Payload fields: lead id, name, email, phone, company, lead source, builder picklist. Upserts `customers` by email, upserts `leads` by `zoho_lead_id` at stage `warm`, maps builder via `builders.zoho_product_id` (fallback: unassigned, flagged in ops). Logs to `zoho_sync_log`. Idempotent.
- `zoho-push`: called by a DB trigger via `pg_net` (or by the app after the write) when `leads.stage` or `quotes.status` changes. Updates the Zoho lead's status field and adds a note ("Quote v2 sent, $110,000"). Token refresh handled inside the function and cached in a `zoho_tokens` table.
- `/ops/settings/zoho`: shows connection status, last sync, failed items with retry, and the webhook URL + secret to paste into Zoho.
- README section "Zoho setup for Tom": create a Self Client in Zoho API Console (scopes `ZohoCRM.modules.leads.ALL`, `ZohoCRM.modules.notes.CREATE`, `ZohoCRM.settings.fields.READ`), generate a grant code, exchange for refresh token; create a Workflow Rule on Leads: on edit, when Lead Status = Warm, action Webhook to our URL with the listed fields. Write it as numbered clicks, nothing assumed.

## Done means

- PR open, preview green, no console errors.
- `/b/klassikwerk` is a landing with a working inquiry form; a submission appears in `/ops/leads`.
- A manual POST to `zoho-lead-webhook` with a sample payload creates a warm lead attached to the right builder.
- From a lead: build a quote, generate PDF (branded, every field filled), send (email arrives), open `/q/:token`, approve, see the lead move; revise creates v2; Create contract produces a build and contract PDF.
- Stage changes write to `zoho_sync_log` with a clear error when Zoho secrets are absent, and succeed when they are.
- README has the Tom section and the quote flow documented.

Report the preview URL and any decision this brief did not cover.
