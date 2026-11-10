-- Phase 8 polish:
--   • canonical commission description = "<customer> — <platform> v<N> — $<total>"
--   • one commission per (customer, platform): newer approved version
--     voids the commission on the superseded version. Backfill applies
--     the same rule.

-- ─── book_native_commission(uuid) — new description + group-void ────
create or replace function book_native_commission(p_quote_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote    record;
  v_rep      uuid;
  v_name     text;
  v_platform text;
  v_total    bigint;
  v_desc     text;
  v_rows     int := 0;
begin
  select q.id, q.builder_id, q.commission_cents, q.sales_rep_profile_id,
         q.commissions_booked_at, q.version, q.lead_id, q.platform_id,
         coalesce(q.total_cents, q.price_cents + coalesce(q.tax_cents, 0)) as total_cents,
         (select customer_id from leads l where l.id = q.lead_id) as customer_id
    into v_quote
    from quotes q where q.id = p_quote_id;

  if v_quote.id is null or v_quote.commissions_booked_at is not null then
    return 0;
  end if;

  if coalesce(v_quote.commission_cents, 0) <= 0 then
    update quotes set commissions_booked_at = now() where id = p_quote_id;
    return 0;
  end if;

  v_rep := v_quote.sales_rep_profile_id;
  if v_rep is null then
    select by_profile_id into v_rep
      from quote_events
     where quote_id = p_quote_id and kind = 'created'
       and by_profile_id is not null
     order by created_at limit 1;
  end if;

  select c.full_name     into v_name     from customers        c where c.id = v_quote.customer_id;
  select p.name          into v_platform from catalog_platforms p where p.id = v_quote.platform_id;
  v_total := v_quote.total_cents;
  v_desc := coalesce(v_name, '—') || ' — ' || coalesce(v_platform, '—')
         || ' v' || v_quote.version
         || ' — $' || to_char(v_total / 100, 'FM999,999,990')
         || '.' || lpad((v_total % 100)::text, 2, '0');

  -- Void previous native commissions on the same (customer, platform)
  -- group so only one live commission exists per group.
  update commissions c
     set status = 'void',
         updated_at = now(),
         notes = coalesce(c.notes || E'\n', '')
               || '[auto ' || to_char(now(), 'YYYY-MM-DD') || '] superseded by quote v'
               || v_quote.version
   where c.source = 'native'
     and c.status in ('pending', 'earned')
     and c.quote_id is distinct from v_quote.id
     and exists (
       select 1 from quotes q2
         join leads l on l.id = q2.lead_id
       where q2.id = c.quote_id
         and l.customer_id = v_quote.customer_id
         and q2.platform_id = v_quote.platform_id
     );

  insert into commissions (builder_id, profile_id, quote_id, source,
                           description, amount_cents, status, earned_at)
  values (v_quote.builder_id, v_rep, v_quote.id, 'native',
          v_desc, v_quote.commission_cents, 'earned', now());

  v_rows := 1;
  update quotes set commissions_booked_at = now() where id = p_quote_id;
  return v_rows;
end;
$$;

grant execute on function book_native_commission(uuid) to authenticated;

-- ─── Rewrite existing native commission descriptions ───────────────
update commissions c
   set description = sub.new_desc,
       updated_at  = now()
  from (
    select c2.id,
           coalesce(cu.full_name, '—')
         || ' — ' || coalesce(cp.name, '—')
         || ' v' || q.version
         || ' — $' || to_char(coalesce(q.total_cents, q.price_cents + coalesce(q.tax_cents, 0)) / 100, 'FM999,999,990')
         || '.' || lpad((coalesce(q.total_cents, q.price_cents + coalesce(q.tax_cents, 0)) % 100)::text, 2, '0') as new_desc
      from commissions c2
       join quotes            q  on q.id  = c2.quote_id
       left join leads        l  on l.id  = q.lead_id
       left join customers    cu on cu.id = l.customer_id
       left join catalog_platforms cp on cp.id = q.platform_id
     where c2.source = 'native' and c2.quote_id is not null
  ) sub
 where c.id = sub.id;

-- ─── Void older-version native commissions in same (customer, platform) group ──
with ranked as (
  select c.id,
         row_number() over (
           partition by l.customer_id, q.platform_id
           order by q.version desc, c.earned_at desc nulls last
         ) as rn
    from commissions c
    join quotes q on q.id = c.quote_id
    join leads  l on l.id = q.lead_id
   where c.source = 'native' and c.status in ('pending', 'earned')
)
update commissions c
   set status     = 'void',
       updated_at = now(),
       notes      = coalesce(c.notes || E'\n', '')
                 || '[auto ' || to_char(now(), 'YYYY-MM-DD') || '] superseded by newer version in group'
  from ranked r
 where c.id = r.id and r.rn > 1;
