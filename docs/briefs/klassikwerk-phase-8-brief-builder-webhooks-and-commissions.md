# Phase 8 — Builder webhooks (ECD Connect → HH) and commissions ledger

ECD quotes and contracts are always created in ECD Connect. The HH platform must show them read-only, kept current by webhooks from Connect, in the same Quotes list and dashboard the team already uses. Separately, every commission the HH sales team earns — CTC jobs quoted here, ECD jobs reported by Connect — lands in one ledger each rep can see on their own profile, and HH can mark paid. Branch `feat/phase-8` from `main`. One PR. Save this file as `docs/briefs/klassikwerk-phase-8-brief-builder-webhooks-and-commissions.md`.

## Inbound webhook

- Edge function `builder-webhook`. Per builder: `builders.webhook_secret` (random 32 bytes, shown once in `/ops/builders/:id` with a Rotate button). Verify `X-Builder-Signature: sha256=<hmac of raw body>` and reject with 401 otherwise. Idempotent on `event_id`; store every delivery in `builder_webhook_events` (builder_id, event_id, event_type, payload jsonb, received_at, processed_at, error) for replay and debugging.
- Event types and the upsert each performs:
  - `quote.upserted` — upsert `quotes` by (`builder_id`, `external_id`) with `source='builder'`: customer (match existing by email, else create), platform/vehicle text, version, status (draft | sent | approved | declined | expired), `price_cents`, `tax_cents`, `total_cents`, `pdf_url`, `external_url` (open in Connect), sent_at / approved_at, sales rep (by email → `ops_users`).
  - `contract.upserted` — upsert `contracts` by (`builder_id`, `external_id`): status (generated | sent | signed | void), signed_at, `document_url`, payment schedule (jsonb), linked quote external_id.
  - `payment.received` — append to `quote_payments`: amount_cents, received_at, stage label, reference.
  - `commission.upserted` — see ledger below.
  - `build.milestone` — append to `quote_milestones`: name, reached_at (shown on the summary page timeline).
- Any payload may carry `hh_quote_id` (set when the lead/quote was pushed from here via `push-quote-to-builder`); when present, link the builder quote to that HH quote so the customer's grouped row shows both.
- Backfill: `POST /functions/v1/builder-webhook/backfill` (ops only) calls the builder's `backfill_url` with the shared secret and processes the returned event array through the same handler. Button on the builder page: "Pull everything from Connect".

## Read-only quotes

- `source='builder'` quotes appear in the grouped Quotes list with a builder badge, open to a summary page (not the editor): header, status, totals incl. tax, payment schedule with amounts received, contract status + document link, milestone timeline, "Open in Connect" button. No edit, save, regenerate, approve or version actions. The `/q` public page is not used for these.
- Dashboard counts and values include them per builder exactly like native quotes.

## Commissions ledger

- Table `commissions`: id, builder_id, ops_user_id (the rep), quote_id (nullable), external_id (nullable, Connect's commission id), source (`native` | `builder`), description, amount_cents, status (`pending` | `earned` | `paid` | `void`), earned_at, paid_at, paid_by (ops user), paid_reference (text), notes. Unique on (builder_id, external_id) where external_id not null.
- Native (CTC): when a quote is approved, create rows from the existing commission snapshot (`commission_cents` flat + bonus) as `earned`; voiding/declining the quote voids them. Replace the current dashboard commission-per-rep calculation with a view over this table so numbers agree everywhere.
- Builder (ECD): `commission.upserted` upserts by external_id — amount, rep (by email), description, earned_at, status as Connect reports it (Connect decides when it is earned). HH owns `paid`: Connect cannot un-pay; if Connect sends `void` after HH marked paid, keep `paid` and flag it in the row (`conflict=true`) for review.
- `/ops/commissions` (admin): table filterable by rep, builder, status, period; totals per rep; bulk "Mark paid" with reference and date; export CSV.
- `/ops/me` (every ops user): their own commissions — pending, earned, paid, with the quote/customer each relates to and year-to-date totals. Reps see only their own rows (RLS).

## Done means

- Replaying a recorded Connect payload set (quote → contract → payment → commission) produces one grouped customer row, a complete summary page, and a commission row on the rep's `/ops/me`.
- Marking a commission paid updates the admin table, the rep's page and the dashboard in the same request; Connect replaying the same `commission.upserted` does not change `paid`.
- An invalid signature is rejected and logged; a duplicate `event_id` is a no-op.
- CTC quotes and the dashboard are unchanged except that commission figures now come from the ledger and match the previous values for existing approved quotes.
- README documents the event contract (types, fields, signature, idempotency, backfill) so Connect can be built against it.

Test only on `Test*` customers. Report the preview URL and any decision this brief did not cover.
