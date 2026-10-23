-- Some wheels ship as a 4-wheel kit SKU — the price IS the price of
-- four, and the operator never wants to multiply it. Mark those rows
-- so the quote editor hides the Set-of chooser and renders the line
-- as "Set of 4" at the kit price.

ALTER TABLE catalog_options
  ADD COLUMN sold_as_set boolean NOT NULL DEFAULT false;

-- Backfill: any existing synced wheel option whose kit_sku ends in
-- -KIT is already a kit. The sync will rewrite this on every run but
-- we flip it now so the migration leaves the DB correct without
-- waiting for a re-sync.
UPDATE catalog_options o
   SET sold_as_set = true
  FROM catalog_option_groups g
 WHERE o.group_id = g.id
   AND o.synced = true
   AND g.allow_quantity = true
   AND o.kit_sku ILIKE '%-KIT';
