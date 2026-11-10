-- Lock pricing internals. The public builder landing + /q page do not
-- need cost-basis columns; today anon can SELECT * on builder_terms,
-- catalog_options, catalog_categories and origins, exposing labour
-- rates, FX, commissions, landed/web prices and origin tariffs.
--
-- Strategy:
--   • builder_terms: full table revoked from anon. Public UI reads a
--     thin builder_terms_public view that exposes only presentation
--     fields. Authenticated/service_role keep full access via the
--     existing RLS policy.
--   • catalog_options / catalog_categories: table-level revoke +
--     column-level grants to anon for the public-safe subset. Hidden
--     columns become a 42501 permission error if anon tries to read
--     them, even with select='*'.
--   • origins: whole-table revoke from anon — every column is
--     cost-basis.
--
-- Authenticated roles (ops rep + operator) are unchanged: they keep
-- full column access via the default role grants, and RLS still
-- scopes by builder.

-- ─── builder_terms: public view + revoke ───────────────────────────
-- Public fields: everything the /q page, configurator, QuotePdf and
-- LookbookPdf actually render. See git log for the usage audit.
create or replace view builder_terms_public
  with (security_invoker = true)
as
select
  builder_id,
  currency,
  payment_mode,
  option_mode,
  reservation_cents,
  payment_schedule,
  quote_validity_days,
  quote_intro_copy,
  brochure_url,
  lead_time_copy,
  warranty_text,
  governing_law,
  tax_rate_pct,
  surtax_pct,
  surtax_cap_cents,
  tax_label,
  created_at,
  updated_at
from builder_terms;

grant select on builder_terms_public to anon, authenticated;

-- Column-level grants so the security_invoker view actually works for
-- anon (the view runs as the caller; without column access on the
-- base table it fails 42501). This also lets code read the public
-- subset off the base table directly if ever needed, but keeps the
-- cost-basis columns off the anon surface.
revoke select on builder_terms from anon;
grant select (
  builder_id, currency, payment_mode, option_mode,
  reservation_cents, payment_schedule, quote_validity_days,
  quote_intro_copy, brochure_url, lead_time_copy,
  warranty_text, governing_law,
  tax_rate_pct, surtax_pct, surtax_cap_cents, tax_label,
  created_at, updated_at
) on builder_terms to anon;

-- ─── catalog_options: column grants ────────────────────────────────
revoke select on catalog_options from anon;
grant select (
  id, builder_id, group_id, category_id, slug, name, code, description,
  price_cents, parts_sell_cents, install_price_cents,
  lead_image_url, swatch_image_url,
  kit_sku, kit_sku_placeholder, sold_as_set,
  included_in_tier_ids, sort, active,
  auto_add_with_group_id,
  external_id, synced,
  created_at, updated_at
) on catalog_options to anon;

-- ─── catalog_categories: column grants ─────────────────────────────
revoke select on catalog_categories from anon;
grant select (
  id, builder_id, name, sort,
  lookbook_section, lookbook_sort, shopify_tags,
  created_at, updated_at
) on catalog_categories to anon;

-- ─── origins: whole table off anon ─────────────────────────────────
revoke select on origins from anon;
