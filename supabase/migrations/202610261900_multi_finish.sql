-- Multi-finish per quote line.
--
-- A single option can now sit under more than one applicable finish
-- set (e.g. a Leather interior gets both an Interior colour pick and
-- an Interior pattern pick). Replace the one-finish-per-line column
-- with a join table.

CREATE TABLE quote_option_finishes (
  quote_option_id uuid NOT NULL REFERENCES quote_options(id) ON DELETE CASCADE,
  finish_set_id   uuid NOT NULL REFERENCES catalog_finish_sets(id) ON DELETE RESTRICT,
  finish_id       uuid NOT NULL REFERENCES catalog_finishes(id) ON DELETE RESTRICT,
  PRIMARY KEY (quote_option_id, finish_set_id)
);
CREATE INDEX quote_option_finishes_option_idx ON quote_option_finishes (quote_option_id);

ALTER TABLE quote_option_finishes ENABLE ROW LEVEL SECURITY;
-- Read is open to operators like the parent quote; write goes through
-- the builder-ownership check on the parent quote.
CREATE POLICY qof_ops_read ON quote_option_finishes FOR SELECT USING (auth_is_operator());
CREATE POLICY qof_ops_write ON quote_option_finishes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM quote_options qo
     WHERE qo.id = quote_option_finishes.quote_option_id
       AND EXISTS (
         SELECT 1 FROM quotes q
          WHERE q.id = qo.quote_id
            AND auth_can_write_builder(q.builder_id)
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM quote_options qo
     WHERE qo.id = quote_option_finishes.quote_option_id
       AND EXISTS (
         SELECT 1 FROM quotes q
          WHERE q.id = qo.quote_id
            AND auth_can_write_builder(q.builder_id)
       )
  ));

-- The old single-finish column is dropped. Any prior quotes that had
-- a finish_id picked lose it — Phase 5 just shipped so no customer
-- quote relies on it yet.
ALTER TABLE quote_options DROP COLUMN finish_id;

-- ─── CTC seed updates ──────────────────────────────────────────────
DO $$
DECLARE
  ctc_id     uuid := '20000000-0000-0000-0000-000000000004';
  interior_colour_set uuid;
  interior_pattern_set uuid;
  cat_leather uuid;
BEGIN
  SELECT id INTO interior_colour_set FROM catalog_finish_sets
   WHERE builder_id = ctc_id AND name = 'Interior colour';
  SELECT id INTO cat_leather FROM catalog_categories
   WHERE builder_id = ctc_id AND name = 'Leather interior';

  -- Interior colour → Black, Tan, Custom. Delete the rest.
  IF interior_colour_set IS NOT NULL THEN
    DELETE FROM catalog_finishes
     WHERE finish_set_id = interior_colour_set
       AND name NOT IN ('Black', 'Tan', 'Custom');
  END IF;

  -- "Interior pattern" set on Leather interior only.
  INSERT INTO catalog_finish_sets (builder_id, name, applies_to_category_ids, sort)
  VALUES (ctc_id, 'Interior pattern', ARRAY[cat_leather]::uuid[], 15)
  ON CONFLICT (builder_id, name) DO UPDATE
    SET applies_to_category_ids = EXCLUDED.applies_to_category_ids
  RETURNING id INTO interior_pattern_set;

  -- Six pattern finishes, no overrides.
  INSERT INTO catalog_finishes (finish_set_id, name, sort) VALUES
    (interior_pattern_set, 'Comfort',       10),
    (interior_pattern_set, 'Sport',         20),
    (interior_pattern_set, 'Clam Shell',    30),
    (interior_pattern_set, 'Designo',       40),
    (interior_pattern_set, '3D Modular',    50),
    (interior_pattern_set, 'Herringbone',   60)
  ON CONFLICT DO NOTHING;
END $$;
