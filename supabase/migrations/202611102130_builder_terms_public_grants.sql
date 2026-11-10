-- Follow-up to 202611102100: the builder_terms_public view uses
-- security_invoker=true so RLS still scopes to active builders. That
-- means the view runs as the caller, so anon also needs column-level
-- SELECT grants on the base builder_terms table — otherwise the view
-- fails 42501 even though the view itself is granted to anon.

grant select (
  builder_id, currency, payment_mode, option_mode,
  reservation_cents, payment_schedule, quote_validity_days,
  quote_intro_copy, brochure_url, lead_time_copy,
  warranty_text, governing_law,
  tax_rate_pct, surtax_pct, surtax_cap_cents, tax_label,
  created_at, updated_at
) on builder_terms to anon;
