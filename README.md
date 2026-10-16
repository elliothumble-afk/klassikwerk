# KlassikWerk

White-label bespoke-restoration platform. Humble House is the operator; each
builder (KlassikWerk is builder #1) gets its own catalog, brand, terms, and
contract wording.

## Surfaces

| Surface | URL | Description |
|---------|-----|-------------|
| **GitHub** | github.com/elliothumble/afk/klassikwerk | Source code, PRs |
| **Supabase** | app.supabase.com/project/vvuccbskbswtfvxplxxm | Database, auth, storage, edge functions |
| **Netlify** | klassikwerk.netlify.app | Hosting, deploy previews |

## Builder model

```
operators            Humble House (one row today; the platform owner)
builders             KlassikWerk, Theon Design, Morgan …   (operator_id)
  builder_brand      logo, wordmark, colours, fonts, tone copy, custom_domain
  builder_terms      reservation, payment_schedule, warranty, governing law
  contract_templates versioned contract body per builder, merge fields
  catalog_*          every catalog table is scoped by builder_id
builds               scoped by builder_id (one customer can have multiple builders)
```

Public routes resolve a builder in one of two ways:

1. **Path**: `/b/:builderSlug/...` for home, platforms, process, configure, reserve.
2. **Custom domain**: if `builder_brand.custom_domain` matches the request
   hostname, the whole app is scoped to that builder and the `/b/:slug` prefix
   is dropped. `/` becomes the builder home.

The React `BuilderProvider` writes brand tokens to `:root` as CSS variables so
every component on the public surface restyles per builder. Fonts are loaded
from Google Fonts by name.

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Copy env and fill in values
cp .env.example .env

# 3. Start dev server
npm run dev
```

## Adding a migration

Migrations are forward-only SQL files in `supabase/migrations/`.

```bash
touch supabase/migrations/$(date +%Y%m%d%H%M)_your_description.sql
supabase db push --linked
```

## Running the seed

```bash
supabase db push --linked --include-seed
```

The seed inserts the Humble House operator, KlassikWerk builder (brand + terms
+ contract template), a demo builder, and the KlassikWerk catalog. Seed and
migration use fixed UUIDs so cross-references stay stable.

## Adding a new builder

Operators do this in-app:

1. Sign in as `operator` (see role setup below).
2. Go to **Ops → Builders → Add builder**.
3. Walk the four-step wizard: identity → brand → terms → contract. The brand
   step previews live.
4. On "Done", open the public site at `/b/<slug>` to verify.

To onboard a near-copy of an existing builder, open the new builder's
**Catalog → Platforms** tab and use **Copy from builder…** to clone a platform
with its option groups and options.

### Custom domain

To put a builder on their own domain:

1. In **Ops → Builders → <builder> → Brand**, set `custom_domain` to the
   hostname (e.g. `theondesign.com`).
2. In Netlify (site settings → Domain management), add the domain as a
   **Domain alias** of the main site and point its DNS at Netlify.
3. Visit the domain — the app auto-detects the match and serves the builder's
   routes at `/`.

## Edge functions

Live in `supabase/functions/`:

- `send-quote` — emails the customer a link to `/q/:token` plus the
  pre-generated `quotes.pdf_url` via Resend; logs `quote_events.sent`;
  moves lead to `quoted`; fires `zoho-push`. Degrades to a sent-locally
  flow when `RESEND_API_KEY` is unset so previews still progress.
- `get-quote` — public: looks up a quote by its random token so `/q/:token`
  can render a branded read-only view (no login).
- `approve-quote` — public: flips the quote to `approved`, logs the event,
  fires `zoho-push`.
- `zoho-lead-webhook` — public (shared-secret): Zoho Workflow Rule POSTs here
  when a lead becomes Warm; upserts the customer, upserts a `leads` row at
  stage `warm`, logs to `zoho_sync_log`. Idempotent.
- `zoho-push` — called from send-quote / approve-quote / stage changes to
  update the Zoho lead status and append a note. Refreshes the access token
  from the `zoho_tokens` cache. Writes an error to `zoho_sync_log` when the
  Zoho secrets are absent, so `/ops/settings/zoho` surfaces it clearly.

Deploy:

```bash
supabase functions deploy send-quote
supabase functions deploy get-quote --no-verify-jwt
supabase functions deploy approve-quote --no-verify-jwt
supabase functions deploy zoho-lead-webhook --no-verify-jwt
supabase functions deploy zoho-push
```

Secrets:

```bash
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set RESEND_FROM=quotes@yourdomain
supabase secrets set HH_INBOX_EMAIL=elliot.humble@gmail.com
supabase secrets set PUBLIC_SITE_URL=https://klassikwerk.netlify.app
supabase secrets set ZOHO_CLIENT_ID=... ZOHO_CLIENT_SECRET=... ZOHO_REFRESH_TOKEN=...
supabase secrets set ZOHO_DC=us ZOHO_WEBHOOK_SECRET=...
```

### Quote and contract PDFs

Both PDFs are rendered **client-side** with
[`@react-pdf/renderer`](https://react-pdf.org). The same pattern ECD
Connect uses:

- `src/lib/pdf/QuotePdf.tsx` — brochure-style quote (brand header,
  platform hero, specification grouped by option group with swatch
  thumbnails, pricing with the reservation deposit on top of the
  payment schedule, process stages, operator contact block).
- `src/lib/pdf/ContractPdf.tsx` — contract chrome around the merged
  Markdown body of the builder's current `contract_templates` row.
- `src/lib/pdf/renderPdf.ts` — fetches the data, calls
  `pdf(doc).toBlob()`, uploads the blob to the `media` bucket, and
  updates `quotes.pdf_url` (quote) or inserts a `media` row (contract).
- `src/lib/pdf/fonts.ts` — registers the builder's `font_display` and
  `font_body` from fontsource (`cdn.jsdelivr.net/npm/@fontsource/<slug>`).

**Generate PDF** on `/ops/quotes/:id` and **Generate contract** on
`/ops/builds/:id` run the renderer in the browser; `send-quote` just
emails a link to `quotes.pdf_url`. No HTML-to-PDF edge function and no
third-party conversion service is involved.

The Supabase service role is read from `SUPABASE_SERVICE_ROLE_KEY` and is set
by Supabase automatically for deployed functions.

## The quote flow

1. Public landing (`/b/:slug`) captures an inquiry → `leads.stage = 'inquiry'`.
2. Zoho CRM Workflow Rule fires `zoho-lead-webhook` once the lead is warm →
   `leads.stage = 'warm'` with `zoho_lead_id` set.
3. From **Ops → Leads → :id**, click **Start quote** → **Ops → Quotes → new**
   with the lead pre-filled. Pick platform, tier, options; **Save draft**
   creates `quotes` v1 and moves the lead to `quoting`.
4. **Generate PDF** calls `render-quote`. **Send** calls `send-quote`, which
   emails the customer the PDF + the `/q/:token` link; lead moves to
   `quoted`.
5. The customer opens `/q/:token`, reviews the quote, clicks **Approve**.
   `approve-quote` flips the quote to `approved` and logs the event.
6. In Ops, **Create contract** on the approved quote creates a `builds` row
   (stage `contract`, copying `quote_options` → `build_options`) and the
   lead moves to `contract_sent`. The build page's **Generate contract**
   produces the signed PDF via `render-contract` as before.
7. **Revise** on any quote marks it `superseded`, clones a new version `n+1`
   as a fresh draft, and sets the lead to `revising`.

## Zoho setup for Tom

Exact clicks. "Zoho" below means Zoho CRM in the `us` data centre.

### A. Create a Self Client (OAuth app)

1. Open `https://api-console.zoho.com` and sign in with your CRM account.
2. Click **Add Client** → **Self Client** → **Create**.
3. Click the new row → **Client Secret** tab. Copy the **Client ID** and
   **Client Secret**. Paste them into a secure note.

### B. Generate a refresh token

1. Still on the Self Client page, open the **Generate Code** tab.
2. In **Scope** paste exactly:
   `ZohoCRM.modules.leads.ALL,ZohoCRM.modules.notes.CREATE,ZohoCRM.settings.fields.READ`
3. **Time Duration**: 10 minutes. **Scope Description**: `KlassikWerk`.
4. Click **Create**. Copy the **Grant Token** that appears.
5. In a terminal, exchange it for a refresh token:
   ```bash
   curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=<CLIENT_ID>" \
     -d "client_secret=<CLIENT_SECRET>" \
     -d "code=<GRANT_TOKEN>"
   ```
6. The response has `refresh_token` — keep it; grant tokens are single-use.
7. Set the secrets in Supabase:
   ```bash
   supabase secrets set ZOHO_CLIENT_ID=<CLIENT_ID> \
     ZOHO_CLIENT_SECRET=<CLIENT_SECRET> \
     ZOHO_REFRESH_TOKEN=<REFRESH_TOKEN> \
     ZOHO_DC=us \
     ZOHO_WEBHOOK_SECRET="$(openssl rand -hex 24)"
   ```
   Note the webhook secret — you'll paste it into the Zoho workflow below.

### C. Workflow Rule: Warm → webhook

1. In Zoho CRM, go to **Setup → Automation → Workflow Rules → Create Rule**.
2. **Module**: Leads. **Rule name**: `KlassikWerk — warm`. Click **Next**.
3. **When**: On a record action → **Edit**. Click **Next**.
4. **Condition**: `Lead Status is Warm`. Click **Next**.
5. **Instant Actions** → **Webhooks** → **New Webhook**.
6. **Name**: `KlassikWerk warm webhook`. **URL**: paste the URL from
   **Ops → Zoho sync** (the `/functions/v1/zoho-lead-webhook` endpoint).
   Append `?secret=<the ZOHO_WEBHOOK_SECRET you set above>`.
7. **Method**: POST. **URL Format**: JSON.
8. **Body** — click **Custom Parameters** and add these keys (left) mapped
   to lead fields (right):
   - `lead_id` → `${Leads.Lead Id}`
   - `email` → `${Leads.Email}`
   - `first_name` → `${Leads.First Name}`
   - `last_name` → `${Leads.Last Name}`
   - `phone` → `${Leads.Phone}`
   - `lead_source` → `${Leads.Lead Source}`
   - `builder` → `${Leads.<builder picklist>}` (whichever field you keep the
     builder choice in)
   - `message` → `${Leads.Description}`
9. **Save** the webhook, **Associate** it to the rule, then **Save** the
   rule.
10. Flip a test Lead to **Warm**. Watch `/ops/settings/zoho` — a green
    `inbound · lead · success` row should appear within a few seconds.

## Roles

The `profiles.role` enum is `customer | ops | partner | operator`.

- **customer** (default on signup) — portal access only.
- **ops** — scoped to builders listed in `profile_builders`.
- **operator** — unrestricted; sees every builder in Ops and can add new ones.

Set Elliot to `operator` once after the first magic-link login (the migration
already attempts this, but it is a no-op if the auth user doesn't exist yet):

```sql
UPDATE profiles SET role = 'operator'
  WHERE user_id = (SELECT id FROM auth.users WHERE email = 'elliot.humble@gmail.com');
```

## Stack

- **Frontend**: Vite · React 19 · TypeScript · Tailwind v4 · react-router v7
- **Data**: Supabase (Postgres + Auth + Storage + Edge Functions) · @tanstack/react-query
- **Forms**: react-hook-form · zod
- **DnD**: @dnd-kit
- **PDF**: pdf-lib (Deno) in the `render-contract` edge function

## Accounts

All infrastructure lives under Elliot's personal accounts — no ECD org, no ECD
Supabase project.
