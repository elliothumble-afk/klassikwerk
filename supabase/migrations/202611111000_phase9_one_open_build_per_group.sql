-- Phase 9 §4 — enforce one open build per quote group.
--
-- Jimmie McCurry's duplicate build ($112,313) was created against a
-- pre-fix drifted total, running alongside his real $112,078 build on
-- the same quote. This guard prevents the recurrence.
--
-- "Quote group" = (customer_id, platform_id). A build is "open" when
-- its stage is NOT in the closed set. Only one open build may exist
-- per group at any time; closed/won builds don't block.

create or replace function _hh_build_group_guard()
returns trigger
language plpgsql
as $$
declare
  conflict_id uuid;
begin
  -- Only enforce on open-stage builds. The build_stage enum has stages
  -- (configured / contract / production / delivered / closed); we lock
  -- out a second open row for anything that isn't 'closed'.
  if new.stage = 'closed' then
    return new;
  end if;
  select b.id into conflict_id
    from builds b
   where b.customer_id = new.customer_id
     and b.platform_id = new.platform_id
     and b.stage <> 'closed'
     and b.id is distinct from new.id
   limit 1;
  if conflict_id is not null then
    raise exception using
      errcode = '23505',
      message = 'Open build already exists for this customer + platform (id=' || conflict_id || '). Close it before starting another.',
      hint = 'One open build per (customer_id, platform_id). Set the existing build to closed or delete it first.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_one_open_build_per_group on builds;
create trigger trg_one_open_build_per_group
  before insert or update of stage, customer_id, platform_id on builds
  for each row execute function _hh_build_group_guard();
