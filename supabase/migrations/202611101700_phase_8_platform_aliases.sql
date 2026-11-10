-- Phase 8 polish: platform aliases + no-silent-fallback for builder
-- webhook quotes.
--
-- Problem: resolvePlatform used to fall back to the first active
-- platform when platform_name didn't match. That hides errors and
-- misroutes Connect quotes. New rule:
--   • match catalog_platforms.name case-insensitively, OR
--   • match an entry in catalog_platforms.aliases (case-insensitive).
-- If neither matches, store platform_id = null and surface the raw
-- platform_name in quotes.external_platform_name so the UI can show
-- it verbatim while an operator fixes up the catalog.

alter table catalog_platforms
  add column if not exists aliases text[] not null default '{}'::text[];

create index if not exists catalog_platforms_aliases_idx
  on catalog_platforms using gin (aliases);

alter table quotes
  alter column platform_id drop not null,
  add column if not exists external_platform_name text;

-- Case-insensitive alias match helper. Returns the platform id for a
-- given builder + incoming name, or null.
create or replace function resolve_platform_by_alias(
  p_builder_id uuid,
  p_name       text
) returns uuid
language sql
stable
as $$
  with target as (select lower(trim(coalesce(p_name, ''))) as n)
  select cp.id
    from catalog_platforms cp, target
   where cp.builder_id = p_builder_id
     and target.n <> ''
     and (
       lower(cp.name) = target.n
       or exists (
         select 1 from unnest(cp.aliases) a
          where lower(a) = target.n
       )
     )
   limit 1;
$$;

grant execute on function resolve_platform_by_alias(uuid, text) to authenticated;

-- ─── Seeds ─────────────────────────────────────────────────────────

-- "Land Rover Defender" → ECD Defender 110 alias.
update catalog_platforms
   set aliases = array(select distinct unnest(aliases || array['Land Rover Defender'])),
       updated_at = now()
 where builder_id = '20000000-0000-0000-0000-000000000003'
   and name = 'Defender 110';

-- Chevrolet K5 Blazer platform on ECD. slug is unique per-builder;
-- chassis + years are required text fields (no deeper catalog data
-- is needed for webhook-only quotes).
insert into catalog_platforms (builder_id, slug, name, chassis, years, aliases, active, sort)
values ('20000000-0000-0000-0000-000000000003', 'chevrolet-k5-blazer',
        'Chevrolet K5 Blazer', 'K5', '1969-1991',
        array['K5 Blazer', 'Chevy K5'], true, 100)
on conflict (builder_id, slug) do update
  set aliases = excluded.aliases,
      updated_at = now();
