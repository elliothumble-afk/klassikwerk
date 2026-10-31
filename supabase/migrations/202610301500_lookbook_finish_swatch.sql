-- Phase 6 polish: give finishes an optional hex colour the Lookbook
-- renderer can paint a swatch chip with. Patterns stay NULL (they're
-- rendered as text only); Body-colour paint stays NULL because it
-- inherits the quote's vehicle_colour.

ALTER TABLE catalog_finishes
  ADD COLUMN swatch_hex text;

DO $$
DECLARE
  ctc_id uuid := '20000000-0000-0000-0000-000000000004';
BEGIN
  UPDATE catalog_finishes f
     SET swatch_hex = v.hex
    FROM (VALUES
      ('Interior colour', 'Black',                        '#111111'),
      ('Interior colour', 'Tan',                          '#B08D57'),
      ('Interior colour', 'Cognac',                       '#8B4A1F'),
      ('Interior colour', 'Red',                          '#8A1C1C'),
      ('Interior colour', 'Blue',                         '#1F3A5F'),
      ('Interior colour', 'Ivory',                        '#EDE6D6'),
      ('Exterior finish',  'No finish (carbon / as supplied)', '#2E2E2E'),
      ('Exterior finish',  'Black Raptor tactile liner',  '#1A1A1A')
    ) AS v(set_name, finish_name, hex)
   WHERE f.name = v.finish_name
     AND f.finish_set_id IN (
       SELECT id FROM catalog_finish_sets
        WHERE builder_id = ctc_id AND name = v.set_name
     );
END $$;
