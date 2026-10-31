-- Sync hardening — ops-override locks, auto-FX, structured sync report.

-- Daily FX refresh needs a per-builder opt-out so an operator can
-- pin an fx_rate manually (e.g. a forward contract). fx_last_updated_at
-- lets the Terms UI show "Rate 1.2712 · updated 31 Oct".
ALTER TABLE builder_terms
  ADD COLUMN fx_auto             boolean     NOT NULL DEFAULT true,
  ADD COLUMN fx_last_updated_at  timestamptz;

-- Catalog overrides the sync must respect. category_locked already
-- exists; add description_locked and origin_locked. Catalog admin
-- flips the lock when ops edits the value; sync skips any locked
-- column on re-sync.
ALTER TABLE catalog_options
  ADD COLUMN description_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN origin_locked      boolean NOT NULL DEFAULT false;

-- Structured sync summary: {new_options[], removed_options[],
-- price_changes[] (|Δ| > 5%), uncategorised[]}. The Costing page
-- shows the last three runs with an expandable change list; the
-- sync edge function emails the same summary to HH_INBOX_EMAIL.
ALTER TABLE sync_runs
  ADD COLUMN summary jsonb;
