-- Phase 9 §5 — relax quotes.tier_id to nullable.
--
-- Externally-managed builders (ECD) don't keep tiers in HH, so
-- builder-sourced quotes stored during a webhook upsert may carry
-- a null tier_id. Native HH quotes still require a tier at save
-- time; we enforce that in QuoteEditor, not in the DB schema.

alter table quotes
  alter column tier_id drop not null;
