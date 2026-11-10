# Humble House builder webhook contract

External builders (ECD Connect first) push lifecycle events for the
quotes they own into Humble House via the `builder-webhook` edge
function. HH processes them idempotently, renders a read-only summary
under `/ops/quotes/:id`, and books the sales rep's commission.

This doc is the authoritative contract. Any field or status not
listed here is not understood on HH's side and will either be ignored
or rejected.

## Endpoint

```
POST https://<project>.supabase.co/functions/v1/builder-webhook
```

The URL and the shared `webhook_secret` live on the builder page in
HH Ops → **Builder webhook** panel. **Rotate** generates a fresh
32-byte hex secret; the plaintext is shown once at rotation and
stored hashed-at-rest by Postgres.

## Transport

- Method: `POST`
- `Content-Type: application/json`
- Required headers:
  - `X-Builder-Id: <uuid>` — the builder row this delivery belongs to.
  - `X-Builder-Signature: sha256=<hex>` — `HMAC_SHA256(raw_body, webhook_secret)`,
    lower-case hex, no prefix other than `sha256=`.

HH compares signatures in constant time. Invalid or missing
signatures return **401** with no DB side effects. Missing or unknown
`X-Builder-Id` returns **401**. Unknown `event_type` returns **400**.
Transient errors return **5xx** — Connect SHOULD retry those; HH's
idempotency guard will deduplicate.

### Secret format

32 cryptographically random bytes, hex-encoded (64 lowercase hex
characters). Rotation replaces the secret atomically; deliveries
signed with the old secret after rotation start failing 401.

## Event envelope

```json
{
  "event_id": "evt_01HQZ…",
  "event_type": "quote.upserted",
  "payload": { … }
}
```

- `event_id` — stable per-event id on the builder's side.
- `event_type` — one of the types in the next section.
- `payload` — event-specific object. All fields documented below sit
  on `payload` directly; no further nesting unless noted.

### Idempotency

Uniqueness is enforced on `(builder_id, event_id)`. Replays — same
envelope, same `event_id` — return `200` with:

```json
{ "ok": true, "result": "duplicate" }
```

…and are a strict no-op. Each envelope is persisted in
`builder_webhook_events` before the handler runs; handler errors are
stamped on that row for audit.

On success:

```json
{ "ok": true, "result": "processed" }
```

## Event types

Every payload below is a field of the envelope's `payload` object.

### `quote.upserted` — upsert a quote (`source='builder'`)

| field              | type   | notes                                                                            |
|--------------------|--------|----------------------------------------------------------------------------------|
| `external_id`      | string | **required.** Stable id in the builder's system; `(builder_id, external_id)` is unique. |
| `external_url`     | string | Deep link back to the quote in the builder's app. Rendered as "Open in Connect". |
| `version`          | number | Version counter in the source system. Defaults to 1.                             |
| `status`           | string | One of `draft`, `sent`, `approved`, `superseded`, `declined`, `expired`, `void`. |
| `price_cents`      | number | Pre-tax total.                                                                   |
| `tax_cents`        | number | Tax component.                                                                   |
| `total_cents`      | number | Incl. tax. Falls back to `price_cents + tax_cents` if omitted.                   |
| `pdf_url`          | string | Optional. Direct link to the builder's PDF.                                      |
| `sent_at`          | ISO    | Optional.                                                                        |
| `approved_at`      | ISO    | Optional.                                                                        |
| `customer_email`   | string | OR `customer.email`. Resolves/creates `customers.email`.                         |
| `customer_name`    | string | OR `customer.full_name`.                                                         |
| `rep_email`        | string | Resolves a HH ops rep via `profiles` (role in `ops`/`operator`) ↔ `auth.users.email`. |
| `platform_name`    | string | Matched case-insensitive against the builder's `catalog_platforms.name`; falls back to the first active platform. |
| `hh_quote_id`      | uuid   | Optional explicit link to a native HH quote — stored in `quotes.notes`.          |

A matching `leads` row is created automatically if none exists
(`source='builder'`, `stage='quoted'`), grouped by
`(builder_id, customer_id)`.

### `contract.upserted` — upsert a contract

| field                        | type    | notes                                                  |
|------------------------------|---------|--------------------------------------------------------|
| `external_id`                | string  | **required.** `(builder_id, external_id)` is unique.   |
| `linked_quote_external_id`   | string  | Matches a quote's `external_id` — populates `contracts.quote_id`. |
| `status`                     | string  | Free-form; defaults to `generated`.                    |
| `signed_at`                  | ISO     | Optional.                                              |
| `document_url`               | string  | Link to the signed PDF.                                |
| `payment_schedule`           | array   | Opaque payment schedule from the builder.              |

### `payment.received` — append a payment row

| field                  | type   | notes                                                     |
|------------------------|--------|-----------------------------------------------------------|
| `quote_external_id`    | string | **required.** Resolves to `quotes.id`.                    |
| `external_id`          | string | Optional. When present, used for per-quote idempotency.   |
| `amount_cents`         | number | Required.                                                 |
| `received_at`          | ISO    | Defaults to `now()`.                                      |
| `stage`                | string | e.g. `reservation`, `milestone`, `final`.                 |
| `reference`            | string | Stripe charge id or wire reference.                       |

### `commission.upserted` — upsert the rep's commission

| field                | type   | notes                                                        |
|----------------------|--------|--------------------------------------------------------------|
| `external_id`        | string | **required.** `(builder_id, external_id)` is unique.         |
| `quote_external_id`  | string | Links to the builder-quote.                                  |
| `rep_email`          | string | Resolves to a HH ops rep.                                    |
| `status`             | string | `pending`, `earned`, `paid`, `void`. Defaults to `pending`.  |
| `amount_cents`       | number | Required.                                                    |
| `earned_at`          | ISO    | Optional.                                                    |
| `description`        | string | Free-form.                                                   |

**Paid is HH-owned.** If HH has already marked a commission `paid` and
Connect later sends a non-paid status, HH keeps `paid` and sets
`commissions.conflict = true` so the admin can reconcile. The
commissions admin page (`/ops/commissions`) highlights conflict rows.

### `build.milestone` — append a milestone

| field                | type   | notes                                                     |
|----------------------|--------|-----------------------------------------------------------|
| `quote_external_id`  | string | **required.** Resolves to `quotes.id`.                    |
| `name`               | string | **required.**                                             |
| `reached_at`         | ISO    | Defaults to `now()`.                                      |
| `external_id`        | string | Optional. When present, used for per-quote idempotency.   |

Unknown `event_type` values are rejected **400**.

## Backfill

For bootstrapping and reconciliation, HH exposes:

```
POST https://<project>.supabase.co/functions/v1/builder-webhook/backfill
Body: { "builder_id": "<uuid>" }
```

HH calls the builder's `backfill_url` (configured on the builder
page) and streams the returned events through the same handlers.
Already-seen `event_id` values are skipped. The **Pull everything
from Connect** button on the builder page invokes this.

### Outbound call to the builder

HH's outbound backfill call uses **the same signature scheme as
inbound deliveries** so Connect only implements one verifier:

- Method: `POST`
- Headers:
  - `X-Builder-Id: <uuid>`
  - `X-Builder-Signature: sha256=<hex>`
  - `Content-Type: application/json`
- Body: `{ "builder_id": "<uuid>", "since": null }` (`since` is
  reserved for a future incremental cursor; builders may ignore it
  for now).
- Signature: `HMAC_SHA256(raw_request_body, webhook_secret)`

### Builder response

The builder MUST return `200 OK` with:

```json
{
  "events": [
    { "event_id": "…", "event_type": "…", "payload": { … } },
    …
  ]
}
```

…i.e. an array of envelopes exactly matching the inbound shape. HH
dispatches each through the regular handlers, so the same
idempotency and validation rules apply. Pagination, if needed, is
the builder's responsibility (on subsequent releases HH will send
`since` to request only events after a timestamp).

### Backfill HH response

```json
{ "ok": true, "processed": 42, "skipped": 7 }
```

`skipped` counts events whose `event_id` was already in
`builder_webhook_events` for this builder.

## Status codes

| code | meaning                                                                 |
|------|-------------------------------------------------------------------------|
| 200  | Delivered. Body includes `{ok:true, result:"processed" \| "duplicate"}`. |
| 400  | Malformed envelope: missing `event_id` / `event_type`, unknown type.     |
| 401  | Missing / invalid signature, or unknown `X-Builder-Id`.                  |
| 500  | Transient server-side error; retrying is safe (idempotent).              |

## Open questions for the Connect side

- **Payload field naming** — `rep_email` vs nested `rep.email`: HH
  accepts only `rep_email`. If Connect prefers nested, extend
  Connect's side or we widen the schema together.
- **`event_id` collisions** — HH enforces per-builder uniqueness;
  two builders may legitimately share an id.
- **Retries** — Connect SHOULD retry on 5xx. HH returns 200 on
  duplicate deliveries, 4xx on bad signature/shape (don't retry),
  5xx on transient errors (retry with backoff).
