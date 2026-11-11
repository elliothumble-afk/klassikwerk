-- Phase 9 §5 — builders.managed_externally.
--
-- An externally-managed builder (ECD today) runs its quote lifecycle
-- entirely in Connect. HH mirrors the quotes via webhooks and surfaces
-- the pipeline, but never maintains catalog tiers/options, never
-- authors a native quote, never generates PDFs and never produces a
-- build/PO. The ops sidebar reflects this by hiding catalog, builds,
-- costing, contract and the pricing section of terms.
--
-- For managed builders HH still needs:
--   • Platforms (with aliases) for webhook `platform_name` resolution
--   • Brand (logo/colours shown on summaries + Connect)
--   • Builder webhook panel (secret, backfill URL)
--   • Scheduled jobs panel (weekly Connect backfill status)

alter table builders
  add column if not exists managed_externally boolean not null default false;

-- Flag ECD (Connect-driven) as externally managed.
update builders
   set managed_externally = true
 where id = '20000000-0000-0000-0000-000000000003'
   and managed_externally = false;
