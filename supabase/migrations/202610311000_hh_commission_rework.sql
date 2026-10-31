-- Phase 6 polish: rework HH's margin model. Humble House sells the
-- job and manages the outsourced work — the Margin panel reports
-- HH's margin per job, with a sales commission paid to the rep who
-- closed the quote. The old hh_fee_pct line is replaced by a flat
-- commission with an optional bonus kicker above a threshold.

ALTER TABLE builder_terms
  DROP COLUMN IF EXISTS hh_fee_pct,
  ADD COLUMN commission_flat_cents              int NOT NULL DEFAULT 50000,  -- $500
  ADD COLUMN commission_bonus_cents             int NOT NULL DEFAULT 50000,  -- $500
  ADD COLUMN commission_bonus_threshold_cents   int NOT NULL DEFAULT 5000000; -- $50,000

-- Snapshot the commission on the quote so dashboard totals survive
-- later changes to the commission schedule.
ALTER TABLE quotes
  ADD COLUMN commission_cents int;
