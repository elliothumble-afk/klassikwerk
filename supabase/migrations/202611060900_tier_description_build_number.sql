-- Three small changes bundled:
--   1. Chelsea Truck Company "Chelsea Conversion" tier description.
--   2. "Paint protection" category sorts after Tyres so Protection is
--      the last row in both At a Glance and the Investment table.
--   3. builds.build_number — single int, sequential per builder,
--      auto-assigned on insert, backfilled by creation order.

-- 1. Tier description — covers the Humble House project-management
--    scope + the numbered CTC build plaque + certificate.
update catalog_tiers
   set description = 'Vehicle intake and pre-fit inspection, Humble House project management of the build across suppliers and the fitting shop, parts receiving and QC, final detail and handover with build documentation. Each conversion receives a numbered Chelsea Truck Company build plaque fitted to the vehicle and a matching framed certificate of authenticity.'
 where builder_id = '20000000-0000-0000-0000-000000000004'
   and slug = 'chelsea-conversion';

-- 2. Protection category sort. The existing CTC categories cap at 320
--    ("Paint protection") with Tyres at 320 too; everything else is
--    ≤ 300. Bump Paint protection to 9999 so it sorts last in the
--    lookbook. The same categories.lookbook_sort drives section
--    order in both At a Glance and the Investment table.
update catalog_categories
   set lookbook_sort = 9999
 where builder_id = '20000000-0000-0000-0000-000000000004'
   and name = 'Paint protection';

-- 3. builds.build_number. Nullable so the column adds cleanly, then
--    backfilled per-builder by created_at order, then enforced via a
--    unique index + trigger.
alter table builds
  add column if not exists build_number int;

-- Backfill: window by builder, number in creation order.
with ranked as (
  select id,
         row_number() over (partition by builder_id order by created_at, id) as n
    from builds
   where build_number is null
)
update builds b
   set build_number = r.n
  from ranked r
 where b.id = r.id;

create unique index if not exists builds_builder_number_idx
  on builds (builder_id, build_number)
  where build_number is not null;

-- Trigger assigns the next per-builder number on insert when the
-- caller doesn't supply one. Race-safe via the unique index — a
-- concurrent insert that picks the same n will fail and the client
-- can retry; in practice ops creates builds one at a time.
create or replace function assign_build_number()
returns trigger
language plpgsql
as $$
begin
  if new.build_number is null then
    select coalesce(max(build_number), 0) + 1
      into new.build_number
      from builds
     where builder_id = new.builder_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_build_number on builds;
create trigger trg_assign_build_number
  before insert on builds
  for each row execute function assign_build_number();
