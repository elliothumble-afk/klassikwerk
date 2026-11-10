-- The initial lockdown in 202611102100 only revoked anon from
-- builder_terms. authenticated (which covers logged-in customers on
-- the portal) still had the default GRANT ALL and the permissive
-- `builder_terms_public_read` policy, so any portal customer could
-- read labour_rate_cents or commission_bonus_cents.
--
-- Fix: tighten RLS so only staff (operator or ops rep linked to the
-- builder) can SELECT the base table. The public view switches to
-- security_invoker=false so it bypasses RLS as the owner — public
-- callers get only the presentation subset and only for active
-- builders, enforced inside the view body.

-- ─── Base table RLS: staff only ────────────────────────────────────
drop policy if exists builder_terms_public_read on builder_terms;
drop policy if exists builder_terms_write       on builder_terms;

create policy builder_terms_staff_read on builder_terms
  for select
  using (auth_can_write_builder(builder_id));

create policy builder_terms_staff_write on builder_terms
  for all
  using (auth_can_write_builder(builder_id))
  with check (auth_can_write_builder(builder_id));

-- ─── Public view: owner-run, inline active filter ──────────────────
-- security_invoker = false means the view runs as the view owner
-- (postgres via the migration), which bypasses RLS. The `where
-- b.active` clause preserves the "inactive builders are invisible"
-- behaviour the previous RLS policy enforced.
--
-- security_barrier = true hardens against function-based side-channel
-- leaks (a function in a user's WHERE can't see a row the view meant
-- to hide).
create or replace view builder_terms_public
  with (security_invoker = false, security_barrier = true)
as
select
  bt.builder_id,
  bt.currency,
  bt.payment_mode,
  bt.option_mode,
  bt.reservation_cents,
  bt.payment_schedule,
  bt.quote_validity_days,
  bt.quote_intro_copy,
  bt.brochure_url,
  bt.lead_time_copy,
  bt.warranty_text,
  bt.governing_law,
  bt.tax_rate_pct,
  bt.surtax_pct,
  bt.surtax_cap_cents,
  bt.tax_label,
  bt.created_at,
  bt.updated_at
from builder_terms bt
join builders b on b.id = bt.builder_id
where b.active;

grant select on builder_terms_public to anon, authenticated;

-- Base-table column grants from 202611102130 are no longer needed
-- (anon reads strictly through the view now) but kept as a safety
-- net so a direct ?select=currency query from legacy code paths
-- still returns rather than erroring. Hidden cost columns remain
-- un-granted.
