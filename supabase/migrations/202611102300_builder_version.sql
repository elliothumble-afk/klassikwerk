-- Connect's `version` is per-Connect-lead (always 1 when the source
-- quote has no lead). HH groups builder quotes under one lead per
-- (builder_id, customer_id), so multiple incoming v1s collide on
-- the quotes_lead_id_version_key UNIQUE constraint.
--
-- Fix: preserve Connect's version in a dedicated column and let HH
-- mint its own monotonically-increasing version per lead.

alter table quotes
  add column if not exists builder_version int;

comment on column quotes.builder_version is
  'For source=builder quotes, the version as reported by the source system (Connect). HH''s quotes.version is HH''s own monotonic version within the lead.';
