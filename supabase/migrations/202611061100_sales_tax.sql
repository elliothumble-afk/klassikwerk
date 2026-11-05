-- Sales tax on quotes.
--
-- Four new builder_terms fields drive the tax calc per builder:
--   tax_rate_pct, surtax_pct, surtax_cap_cents, tax_label.
-- CTC gets Florida / Orange County rates (6% + 0.5% capped at $5k per
-- line); KlassikWerk, ECD and anyone else default to 0% / empty label
-- so their quotes render exactly as before.
--
-- quotes.tax_cents is a snapshot (same rules as the rest of the quote
-- snapshot — written at save time, never recomputed by sync). The
-- lookbook / /q / contract read it verbatim. quotes.total_cents is
-- price_cents + tax_cents, surfaced as a stored column so the
-- payment-schedule maths doesn't have to re-add the pieces.

alter table builder_terms
  add column if not exists tax_rate_pct     numeric not null default 0,
  add column if not exists surtax_pct       numeric not null default 0,
  add column if not exists surtax_cap_cents bigint  not null default 0,
  add column if not exists tax_label        text    not null default '';

update builder_terms
   set tax_rate_pct = 0.06,
       surtax_pct = 0.005,
       surtax_cap_cents = 500000,
       tax_label = 'Florida sales tax (Orange County)'
 where builder_id = '20000000-0000-0000-0000-000000000004';

alter table quotes
  add column if not exists tax_cents   bigint not null default 0,
  add column if not exists total_cents bigint not null default 0;

-- Backfill: for every CTC quote, recompute tax_cents from its stored
-- snapshot so historical rows match what the lookbook will render
-- going forward. Uses the same formula as compute_quote_tax below.
--
-- Base = tier.base_price_cents + Σ (parts_sell + labour + materials).
-- Tax  = base × tax_rate
--      + Σ min(line_total, cap) × surtax_pct  (treating the tier as a line)
create or replace function compute_quote_tax(p_quote_id uuid)
returns bigint
language plpgsql
stable
as $$
declare
  v_builder_id uuid;
  v_tier_base  bigint := 0;
  v_rate       numeric;
  v_surtax     numeric;
  v_cap        bigint;
  v_lines_sum  bigint := 0;
  v_line_surtax bigint := 0;
  v_base       bigint;
  v_tier_surtax bigint;
  v_tax        bigint;
begin
  select q.builder_id,
         coalesce(t.base_price_cents, 0)
    into v_builder_id, v_tier_base
    from quotes q
    left join catalog_tiers t on t.id = q.tier_id
   where q.id = p_quote_id;
  if v_builder_id is null then return 0; end if;

  select tax_rate_pct, surtax_pct, surtax_cap_cents
    into v_rate, v_surtax, v_cap
    from builder_terms
   where builder_id = v_builder_id;
  if v_rate is null or (v_rate = 0 and v_surtax = 0) then return 0; end if;

  -- Σ line totals and Σ per-line capped surtax.
  select coalesce(sum(line_total), 0),
         coalesce(sum(round(least(line_total, v_cap) * v_surtax)), 0)
    into v_lines_sum, v_line_surtax
    from (
      select (coalesce(parts_sell_cents, 0)
            + coalesce(labour_cents, 0)
            + coalesce(materials_cents, 0))::bigint as line_total
        from quote_options
       where quote_id = p_quote_id
    ) l;

  v_base := v_tier_base + v_lines_sum;
  v_tier_surtax := round(least(v_tier_base, v_cap) * v_surtax)::bigint;
  v_tax := round(v_base * v_rate)::bigint + v_line_surtax + v_tier_surtax;
  return v_tax;
end;
$$;

update quotes q
   set tax_cents = compute_quote_tax(q.id),
       total_cents = price_cents + compute_quote_tax(q.id)
 where q.builder_id = '20000000-0000-0000-0000-000000000004';

-- Zero-rate builders stay at 0/price_cents.
update quotes
   set total_cents = price_cents
 where total_cents = 0 and price_cents > 0;
