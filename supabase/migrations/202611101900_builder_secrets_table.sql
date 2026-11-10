-- Move operator-only secrets + service URLs off the builders table.
--
-- The builders table has a public-read RLS policy so brand landing
-- pages can resolve a builder by slug or custom domain. Postgres RLS
-- gates rows, not columns, so webhook_secret / catalog_source_token /
-- catalog_source_url / backfill_url were readable by anyone with the
-- anon key. The webhook signing secret is a forgery risk; the Shopify
-- bearer token is the keys to the catalog kingdom. Service URLs
-- aren't credentials but leak integration topology.
--
-- Fix: lift those four columns into a sibling table with its own
-- RLS (operators only). Edge functions bypass RLS via the service
-- role. Public code paths that don't need these columns are unchanged.

create table if not exists builder_secrets (
  builder_id           uuid primary key references builders(id) on delete cascade,
  webhook_secret       text,
  catalog_source_token text,
  catalog_source_url   text,
  backfill_url         text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger trg_builder_secrets_updated_at
  before update on builder_secrets
  for each row execute function update_updated_at();

alter table builder_secrets enable row level security;

-- Operator-only. Service role bypasses RLS automatically.
drop policy if exists builder_secrets_operator_read on builder_secrets;
create policy builder_secrets_operator_read
  on builder_secrets for select
  using (auth_is_operator());

drop policy if exists builder_secrets_operator_write on builder_secrets;
create policy builder_secrets_operator_write
  on builder_secrets for all
  using (auth_is_operator())
  with check (auth_is_operator());

-- Explicit column-level revoke on top of RLS: even if someone later
-- relaxes the SELECT policy, anon still can't read.
revoke select on builder_secrets from anon;

-- ─── Copy existing values ─────────────────────────────────────────
insert into builder_secrets (builder_id, webhook_secret, catalog_source_token, catalog_source_url, backfill_url)
select id, webhook_secret, catalog_source_token, catalog_source_url, backfill_url
  from builders
 where webhook_secret is not null
    or catalog_source_token is not null
    or catalog_source_url is not null
    or backfill_url is not null
on conflict (builder_id) do update set
  webhook_secret       = coalesce(excluded.webhook_secret,       builder_secrets.webhook_secret),
  catalog_source_token = coalesce(excluded.catalog_source_token, builder_secrets.catalog_source_token),
  catalog_source_url   = coalesce(excluded.catalog_source_url,   builder_secrets.catalog_source_url),
  backfill_url         = coalesce(excluded.backfill_url,         builder_secrets.backfill_url),
  updated_at           = now();

-- ─── Drop columns from the public-read table ─────────────────────
alter table builders
  drop column if exists webhook_secret,
  drop column if exists catalog_source_token,
  drop column if exists catalog_source_url,
  drop column if exists backfill_url;
