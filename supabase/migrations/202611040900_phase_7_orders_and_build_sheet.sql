-- Phase 7 — order sheets + build sheet.
--
-- Schema for turning accepted quotes into supplier purchase orders
-- and an installer-facing build sheet. Everything downstream of
-- "customer approves the quote":
--   suppliers (per builder)
--   catalog_options.supplier_id (default Kahn for CTC synced rows,
--     TR Wholesale for the Tyres category)
--   builds.install_instructions (markdown)
--   build_options.instruction (text) + build_options.received_at
--   purchase_orders + purchase_order_lines (per-supplier draft POs)

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references builders(id) on delete cascade,
  name text not null,
  email text,
  cc_email text,
  currency text not null default 'USD',
  address text,
  order_notes text,
  lead_time_days int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists suppliers_builder_name_idx
  on suppliers(builder_id, name);
alter table suppliers enable row level security;
drop policy if exists suppliers_builder_scope on suppliers;
create policy suppliers_builder_scope on suppliers
  for all to authenticated
  using (true) with check (true);

-- CTC suppliers: Kahn (GBP) for synced parts, TR (USD) for tyres.
-- Afzal's PO email left blank — Elliot fills it in before the first
-- real send.
insert into suppliers (builder_id, name, currency, email, order_notes, lead_time_days)
values
  ('20000000-0000-0000-0000-000000000004',
   'Chelsea Truck Company / Kahn Design',
   'GBP',
   null,
   'Please confirm part numbers for any CONFIRM PART NUMBER lines and quote lead time per line.',
   28),
  ('20000000-0000-0000-0000-000000000004',
   'TR Wholesale',
   'USD',
   null,
   'Confirm fitment and availability on each tyre line.',
   7)
on conflict (builder_id, name) do nothing;

alter table catalog_options
  add column if not exists supplier_id uuid references suppliers(id) on delete set null;

-- Default supplier for existing CTC rows. Synced → Kahn. Tyres
-- category → TR Wholesale (overrides the synced default).
update catalog_options co
set supplier_id = s.id
from suppliers s
where s.builder_id = co.builder_id
  and co.builder_id = '20000000-0000-0000-0000-000000000004'
  and s.name = 'Chelsea Truck Company / Kahn Design'
  and co.synced = true
  and co.supplier_id is null;

update catalog_options co
set supplier_id = s.id
from suppliers s, catalog_categories c
where s.builder_id = co.builder_id
  and c.builder_id = co.builder_id
  and co.builder_id = '20000000-0000-0000-0000-000000000004'
  and s.name = 'TR Wholesale'
  and c.name = 'Tyres'
  and co.category_id = c.id;

alter table builds
  add column if not exists install_instructions text;

alter table build_options
  add column if not exists instruction text,
  add column if not exists received_at timestamptz;

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references builds(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete restrict,
  number text not null,
  status text not null default 'draft'
    check (status in ('draft','sent','confirmed','received')),
  currency text not null,
  subtotal_cents bigint not null default 0,
  pdf_url text,
  sent_at timestamptz,
  sent_to text,
  confirmed_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchase_orders_build_idx on purchase_orders(build_id);
create unique index if not exists purchase_orders_number_idx on purchase_orders(number);
alter table purchase_orders enable row level security;
drop policy if exists purchase_orders_all on purchase_orders;
create policy purchase_orders_all on purchase_orders
  for all to authenticated
  using (true) with check (true);

create table if not exists purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  build_option_id uuid references build_options(id) on delete set null,
  sku text,
  description text not null,
  qty int not null default 1,
  unit_cost_cents bigint not null default 0,
  finish text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchase_order_lines_po_idx on purchase_order_lines(po_id);
alter table purchase_order_lines enable row level security;
drop policy if exists purchase_order_lines_all on purchase_order_lines;
create policy purchase_order_lines_all on purchase_order_lines
  for all to authenticated
  using (true) with check (true);

-- ─── generate_purchase_orders(build_id) ────────────────────────────
-- Called after build_options are populated. Groups the build's lines
-- by supplier, creates one draft PO per supplier, inserts a line per
-- build_option. Unit cost (in the supplier's currency):
--   synced option → web_price_cents × (1 − trade_discount_pct)
--     clamped at zero, rounded to nearest cent.
--   manual option → cost_cents (already in supplier currency).
-- Idempotent per (build_id, supplier_id): drops existing draft POs
-- for the build before re-creating.
create or replace function generate_purchase_orders(p_build_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_builder_id uuid;
  v_trade_discount numeric;
  v_po_number_seq int;
  v_count int := 0;
  v_supplier record;
  v_po_id uuid;
  v_subtotal bigint;
  v_po_number text;
begin
  select builder_id into v_builder_id from builds where id = p_build_id;
  if v_builder_id is null then
    raise exception 'build % not found', p_build_id;
  end if;

  select coalesce(trade_discount_pct, 0) into v_trade_discount
  from builder_terms where builder_id = v_builder_id;

  -- Replace existing drafts for a clean regeneration.
  delete from purchase_orders
   where build_id = p_build_id and status = 'draft';

  -- Count existing non-draft POs on the build so the number sequence
  -- doesn't collide. Numbers look like PO-{build-short}-{n}.
  select count(*) into v_po_number_seq
   from purchase_orders where build_id = p_build_id;

  for v_supplier in
    select distinct s.id, s.name, s.currency
    from build_options bo
    join catalog_options co on co.id = bo.option_id
    join suppliers s on s.id = co.supplier_id
    where bo.build_id = p_build_id
    order by s.name
  loop
    v_po_number_seq := v_po_number_seq + 1;
    v_po_number := 'PO-' || substr(p_build_id::text, 1, 8) || '-' || v_po_number_seq;
    v_subtotal := 0;

    insert into purchase_orders (build_id, supplier_id, number, status, currency, subtotal_cents)
    values (p_build_id, v_supplier.id, v_po_number, 'draft', v_supplier.currency, 0)
    returning id into v_po_id;

    -- Lines for this supplier.
    insert into purchase_order_lines (po_id, build_option_id, sku, description, qty, unit_cost_cents, finish, note)
    select
      v_po_id,
      bo.id,
      coalesce(co.kit_sku, co.code),
      co.name,
      bo.quantity,
      case
        when co.synced = true then
          greatest(0, round(coalesce(co.web_price_cents, 0) * (1 - v_trade_discount)))::bigint
        else
          coalesce(co.cost_cents, 0)
      end,
      -- Finish summary from quote_option_finishes if the build has a quote.
      (
        select string_agg(cf.name, ' · ' order by cfs.sort)
        from quote_options qo
        join quote_option_finishes qof on qof.quote_option_id = qo.id
        join catalog_finishes cf on cf.id = qof.finish_id
        join catalog_finish_sets cfs on cfs.id = qof.finish_set_id
        where qo.quote_id = (select quote_id from builds where id = p_build_id)
          and qo.option_id = bo.option_id
      ),
      case when co.kit_sku_placeholder then 'CONFIRM PART NUMBER' else null end
    from build_options bo
    join catalog_options co on co.id = bo.option_id
    where bo.build_id = p_build_id
      and co.supplier_id = v_supplier.id;

    -- Compute + stamp subtotal.
    select coalesce(sum(qty * unit_cost_cents), 0) into v_subtotal
    from purchase_order_lines where po_id = v_po_id;

    update purchase_orders
      set subtotal_cents = v_subtotal, updated_at = now()
      where id = v_po_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function generate_purchase_orders(uuid) to authenticated;
