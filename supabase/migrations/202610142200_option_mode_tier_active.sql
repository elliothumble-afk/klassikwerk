-- Per-builder configurator mode + tier active flag.
--
-- option_mode = 'included_only' hides anything not covered by the tier
-- (KlassikWerk's model: tiers imply the spec, no à-la-carte).
-- option_mode = 'priced' is the default — every option in the group
-- shows and uses price_cents when not included in the chosen tier.
ALTER TABLE builder_terms
  ADD COLUMN option_mode text NOT NULL DEFAULT 'priced'
    CHECK (option_mode IN ('included_only', 'priced'));

ALTER TABLE catalog_tiers
  ADD COLUMN active boolean NOT NULL DEFAULT true;

-- KlassikWerk uses included-only; Werk tier is quote-only / inactive
UPDATE builder_terms
  SET option_mode = 'included_only'
  WHERE builder_id = '20000000-0000-0000-0000-000000000001';

UPDATE catalog_tiers
  SET active = false
  WHERE builder_id = '20000000-0000-0000-0000-000000000001'
    AND slug = 'werk';
