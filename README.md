# KlassikWerk

Bespoke Mercedes-Benz restoration configurator. Phase 1: scaffold, schema, and catalog admin.

## Surfaces

| Surface | URL | Description |
|---------|-----|-------------|
| **GitHub** | github.com/elliothumble/klassikwerk | Source code, PRs |
| **Supabase** | app.supabase.com/project/vvuccbskbswtfvxplxxm | Database, auth, storage |
| **Netlify** | klassikwerk.netlify.app | Hosting, deploy previews |

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Copy env and fill in values
cp .env.example .env
# Edit .env with your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Start dev server
npm run dev
```

## Adding a migration

Migrations are forward-only SQL files in `supabase/migrations/`.

```bash
# Create a new migration file (use current timestamp)
touch supabase/migrations/$(date +%Y%m%d%H%M)_your_description.sql

# Edit the file, then push to the remote Supabase project
supabase db push --linked
```

## Running the seed

```bash
# Apply seed data to the linked Supabase project
supabase db push --linked --include-seed
```

The seed inserts platforms, tiers, option groups, and catalog options with fixed UUIDs so cross-references remain stable.

## Setting Elliot's ops role

After logging in for the first time via magic link, run this in the Supabase SQL editor:

```sql
UPDATE profiles
SET role = 'ops'
WHERE user_id = (
  SELECT id FROM auth.users
  WHERE email = 'elliot.humble@gmail.com'
);
```

## Stack

- **Frontend**: Vite · React 19 · TypeScript · Tailwind v4 · react-router v7
- **Data**: Supabase (Postgres + Auth + Storage) · @tanstack/react-query
- **Forms**: react-hook-form · zod
- **DnD**: @dnd-kit

## Accounts

All infrastructure lives under Elliot's personal accounts — no ECD org, no ECD Supabase project.
