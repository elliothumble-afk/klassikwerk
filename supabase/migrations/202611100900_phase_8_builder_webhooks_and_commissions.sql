-- Phase 8 — builder webhooks (ECD Connect → HH) and commissions ledger.
--
-- ECD quotes land in Connect. HH shows them read-only, kept current
-- by webhooks. Every commission a HH rep earns — CTC jobs quoted
-- here, ECD jobs reported by Connect — lives in one ledger each rep
-- can see, HH marks paid.

-- ─── Webhook plumbing ──────────────────────────────────────────────

alter table builders
  add column if not exists webhook_secret text,
  add column if not exists backfill_url text;

create table if not exists builder_webhook_events (
  id            uuid primary key default gen_random_uuid(),
  builder_id    uuid not null references builders(id) on delete cascade,
  event_id      text not null,
  event_type    text not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);
create unique index if not exists builder_webhook_events_unique_idx
  on builder_webhook_events (builder_id, event_id);
create index if not exists builder_webhook_events_received_idx
  on builder_webhook_events (received_at desc);
alter table builder_webhook_events enable row level security;
drop policy if exists builder_webhook_events_all on builder_webhook_events;
create policy builder_webhook_events_all on builder_webhook_events
  for all to authenticated using (true) with check (true);

-- ─── Quotes: source + external link + rep ──────────────────────────

alter table quotes
  add column if not exists source text not null default 'native'
    check (source in ('native', 'builder')),
  add column if not exists external_id text,
  add column if not exists external_url text,
  add column if not exists sales_rep_profile_id uuid references profiles(id),
  -- Milestone: when HH-side logic has already written commission rows
  -- for an approved native quote. Prevents double-insert on repeated
  -- approvals.
  add column if not exists commissions_booked_at timestamptz;

create unique index if not exists quotes_builder_external_idx
  on quotes (builder_id, external_id)
  where external_id is not null;

-- Builder quotes may carry 'declined' / 'expired' / 'void' status.
-- quote_status is a Postgres enum; extend it in-place.
do $$
begin
  alter type quote_status add value if not exists 'declined';
exception when duplicate_object then null;
end $$;
do $$
begin
  alter type quote_status add value if not exists 'expired';
exception when duplicate_object then null;
end $$;
do $$
begin
  alter type quote_status add value if not exists 'void';
exception when duplicate_object then null;
end $$;

-- ─── Contracts (new table, keyed by builder external_id) ───────────

create table if not exists contracts (
  id                        uuid primary key default gen_random_uuid(),
  builder_id                uuid not null references builders(id) on delete cascade,
  external_id               text,
  quote_id                  uuid references quotes(id) on delete set null,
  linked_quote_external_id  text,
  status                    text not null default 'generated'
    check (status in ('generated', 'sent', 'signed', 'void')),
  signed_at                 timestamptz,
  document_url              text,
  payment_schedule          jsonb not null default '[]'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists contracts_builder_external_idx
  on contracts (builder_id, external_id) where external_id is not null;
create index if not exists contracts_quote_idx on contracts (quote_id);
alter table contracts enable row level security;
drop policy if exists contracts_all on contracts;
create policy contracts_all on contracts for all to authenticated using (true) with check (true);

-- ─── Payments + milestones (per-quote event streams) ───────────────

create table if not exists quote_payments (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references quotes(id) on delete cascade,
  amount_cents  bigint not null,
  received_at   timestamptz not null,
  stage         text,
  reference     text,
  external_id   text,
  created_at    timestamptz not null default now()
);
create unique index if not exists quote_payments_external_idx
  on quote_payments (quote_id, external_id) where external_id is not null;
alter table quote_payments enable row level security;
drop policy if exists quote_payments_all on quote_payments;
create policy quote_payments_all on quote_payments for all to authenticated using (true) with check (true);

create table if not exists quote_milestones (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references quotes(id) on delete cascade,
  name        text not null,
  reached_at  timestamptz not null,
  external_id text,
  created_at  timestamptz not null default now()
);
create unique index if not exists quote_milestones_external_idx
  on quote_milestones (quote_id, external_id) where external_id is not null;
alter table quote_milestones enable row level security;
drop policy if exists quote_milestones_all on quote_milestones;
create policy quote_milestones_all on quote_milestones for all to authenticated using (true) with check (true);

-- ─── Commissions ledger ────────────────────────────────────────────

create table if not exists commissions (
  id             uuid primary key default gen_random_uuid(),
  builder_id     uuid not null references builders(id) on delete cascade,
  profile_id    uuid references profiles(id),
  quote_id       uuid references quotes(id) on delete set null,
  external_id    text,
  source         text not null check (source in ('native', 'builder')),
  description    text,
  amount_cents   bigint not null default 0,
  status         text not null default 'pending'
    check (status in ('pending', 'earned', 'paid', 'void')),
  earned_at      timestamptz,
  paid_at        timestamptz,
  paid_by        uuid references profiles(id),
  paid_reference text,
  notes          text,
  -- Flagged when HH marked paid and Connect later sent void. Reviewed
  -- by hand; the paid status is NOT overwritten by a late void.
  conflict       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists commissions_builder_external_idx
  on commissions (builder_id, external_id) where external_id is not null;
create index if not exists commissions_rep_idx on commissions (profile_id);
create index if not exists commissions_quote_idx on commissions (quote_id);
alter table commissions enable row level security;
drop policy if exists commissions_rw_all on commissions;
drop policy if exists commissions_rep_read_own on commissions;
-- Admin / ops writes everything; reps read only their own rows.
-- profiles.role: 'operator' = admin, 'rep' = sales rep.
create policy commissions_rw_all on commissions
  for all to authenticated
  using (true) with check (true);

-- Rep-per-period summary view used by the dashboard commission card.
-- Pending / earned contribute to "forecast"; paid contributes to
-- "paid". Native and builder rows roll up together.
create or replace view rep_commission_totals as
select
  c.profile_id,
  c.builder_id,
  sum(case when c.status in ('pending', 'earned') then c.amount_cents else 0 end) as forecast_cents,
  sum(case when c.status = 'paid'                 then c.amount_cents else 0 end) as paid_cents,
  sum(case when c.status = 'void'                 then c.amount_cents else 0 end) as void_cents,
  count(*) filter (where c.status = 'pending') as pending_rows,
  count(*) filter (where c.status = 'earned')  as earned_rows,
  count(*) filter (where c.status = 'paid')    as paid_rows,
  count(*) filter (where c.status = 'void')    as void_rows
from commissions c
group by c.profile_id, c.builder_id;

grant select on rep_commission_totals to authenticated;

-- ─── book_native_commission(quote_id) ──────────────────────────────
-- Called from the approve-quote edge function when a native quote
-- flips to 'approved'. Reads the quote's commission_cents snapshot
-- and inserts one row into commissions with source='native',
-- status='earned', earned_at=now(). Idempotent via commissions_booked_at.
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
  v_rows     int := 0;
begin
  select q.id, q.builder_id, q.commission_cents, q.sales_rep_profile_id,
         q.commissions_booked_at, q.version, q.lead_id,
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
  -- Rep resolution: sales_rep snapshot on the quote, else the ops
  -- user who created the quote (first quote_events.by_profile_id for
  -- kind='created'), else null.
  v_rep := v_quote.sales_rep_profile_id;
  if v_rep is null then
    select by_profile_id into v_rep
      from quote_events
     where quote_id = p_quote_id and kind = 'created'
       and by_profile_id is not null
     order by created_at limit 1;
  end if;
  select c.full_name into v_name from customers c where c.id = v_quote.customer_id;
  insert into commissions (builder_id, profile_id, quote_id, source,
                           description, amount_cents, status, earned_at)
  values (v_quote.builder_id, v_rep, v_quote.id, 'native',
          coalesce('Quote v' || v_quote.version || ' — ' || coalesce(v_name, 'customer'),
                   'Native commission'),
          v_quote.commission_cents, 'earned', now());
  v_rows := 1;
  update quotes set commissions_booked_at = now() where id = p_quote_id;
  return v_rows;
end;
$$;

-- ─── void_native_commissions(quote_id) ─────────────────────────────
-- Called when a native quote flips away from 'approved' (void /
-- declined). Flips commissions.status → 'void' for its native rows.
create or replace function void_native_commissions(p_quote_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update commissions
     set status = 'void', updated_at = now()
   where quote_id = p_quote_id
     and source = 'native'
     and status in ('pending', 'earned');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function book_native_commission(uuid) to authenticated;
grant execute on function void_native_commissions(uuid) to authenticated;

-- ─── Backfill native commissions for existing approved CTC quotes ──
-- One row per approved quote with commission_cents > 0 that doesn't
-- already have a native commission on file.
insert into commissions (builder_id, profile_id, quote_id, source,
                         description, amount_cents, status, earned_at)
select q.builder_id,
       coalesce(q.sales_rep_profile_id,
         (select by_profile_id from quote_events qe
           where qe.quote_id = q.id and qe.kind = 'created'
             and qe.by_profile_id is not null
           order by created_at limit 1)),
       q.id,
       'native',
       'Quote v' || q.version || ' — backfill',
       q.commission_cents,
       'earned',
       coalesce(q.approved_at, q.updated_at)
  from quotes q
 where q.status = 'approved'
   and coalesce(q.commission_cents, 0) > 0
   and q.source = 'native'
   and not exists (
     select 1 from commissions c
      where c.quote_id = q.id and c.source = 'native'
   );

update quotes
   set commissions_booked_at = now()
 where id in (select quote_id from commissions where source = 'native' and status = 'earned');
