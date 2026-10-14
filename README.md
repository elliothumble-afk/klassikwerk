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

Two functions live in `supabase/functions/`:

- `render-contract` — merges a build's data into the builder's current
  contract template, renders a PDF with `pdf-lib`, uploads it to the `media`
  bucket, and records a `media` row. Returns `{ url, path }`.
- `create-reservation-checkout` — creates a Stripe Checkout Session for the
  builder's reservation deposit. Stripe metadata carries `builder_id` so a
  future Connect split can route to each builder's `stripe_account_id`. If
  `STRIPE_SECRET_KEY` isn't set the function returns `{ url: null }` and the
  frontend falls back to a demo success page.

Deploy both:

```bash
supabase functions deploy render-contract
supabase functions deploy create-reservation-checkout
# Set the Stripe secret in test mode:
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
```

The Supabase service role is read from `SUPABASE_SERVICE_ROLE_KEY` and is set
by Supabase automatically for deployed functions.

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
