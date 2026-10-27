-- Three additions to Phase 5:
--
--   1. Per-line finishes (interior colour, exterior paint/liner) via
--      catalog_finish_sets × catalog_finishes. Hours and materials
--      overrides replace the category values for a single quote line.
--
--   2. Manual Tyres on CTC. A new "Tyres" option group that the sync
--      never touches, a Tyres category (1h install, no paint), and
--      eleven placeholder sizes with blank prices (ops sets them in
--      the catalog admin). Manual options on a cost_based builder
--      interpret their price as parts_sell directly — no FX, no
--      landing. Only category labour is added. For that we need
--      catalog_options.manual_parts_sell_cents.
--
--   3. Cleanup: delete Chelsea Edition / Chelsea Wide Track tiers,
--      rewrite builder_brand.process_copy for a kit-fitting business.

-- ─── 1. Finishes schema ────────────────────────────────────────────
CREATE TABLE catalog_finish_sets (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id                  uuid NOT NULL REFERENCES builders(id) ON DELETE CASCADE,
  name                        text NOT NULL,
  applies_to_category_ids     uuid[] NOT NULL DEFAULT '{}',
  sort                        int NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (builder_id, name)
);
CREATE INDEX catalog_finish_sets_builder_idx ON catalog_finish_sets (builder_id);
CREATE TRIGGER trg_catalog_finish_sets_updated_at BEFORE UPDATE ON catalog_finish_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE catalog_finish_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_finish_sets_ops_read ON catalog_finish_sets FOR SELECT USING (auth_is_operator());
CREATE POLICY catalog_finish_sets_ops_write ON catalog_finish_sets FOR ALL
  USING (auth_can_write_builder(builder_id))
  WITH CHECK (auth_can_write_builder(builder_id));

CREATE TABLE catalog_finishes (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finish_set_id               uuid NOT NULL REFERENCES catalog_finish_sets(id) ON DELETE CASCADE,
  name                        text NOT NULL,
  -- Nullable overrides. Null = use the option's category value.
  paint_hours_override        numeric,
  materials_cents_override    int,
  sort                        int NOT NULL DEFAULT 0,
  active                      boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_finishes_set_idx ON catalog_finishes (finish_set_id);
CREATE TRIGGER trg_catalog_finishes_updated_at BEFORE UPDATE ON catalog_finishes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE catalog_finishes ENABLE ROW LEVEL SECURITY;
-- The policy walks up to the owning builder via the finish set.
CREATE POLICY catalog_finishes_ops_read ON catalog_finishes FOR SELECT USING (auth_is_operator());
CREATE POLICY catalog_finishes_ops_write ON catalog_finishes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM catalog_finish_sets fs
     WHERE fs.id = catalog_finishes.finish_set_id
       AND auth_can_write_builder(fs.builder_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM catalog_finish_sets fs
     WHERE fs.id = catalog_finishes.finish_set_id
       AND auth_can_write_builder(fs.builder_id)
  ));

-- Snapshot the finish on the quote line so a sent quote doesn't drift
-- when the finish is renamed or deleted later.
ALTER TABLE quote_options
  ADD COLUMN finish_id    uuid REFERENCES catalog_finishes(id) ON DELETE SET NULL,
  ADD COLUMN finish_note  text;

-- ─── 2. Manual-option sell price ───────────────────────────────────
-- For cost_based builders, a manual (non-synced) option's price is
-- the parts_sell price the ops user entered — not computed from a
-- web price. Null when the sell price hasn't been set.
ALTER TABLE catalog_options
  ADD COLUMN manual_parts_sell_cents int;

-- ─── Seed CTC: finishes, Tyres, tier + process cleanup ─────────────
DO $$
DECLARE
  ctc_id          uuid := '20000000-0000-0000-0000-000000000004';

  -- Looked up by name
  cat_body        uuid; cat_wheel_arch  uuid; cat_front_bumper uuid;
  cat_bonnet      uuid; cat_bonnet_vent uuid; cat_side_vent    uuid;
  cat_roof_spoil  uuid; cat_grille      uuid; cat_door_mask    uuid;
  cat_leather     uuid; cat_steering    uuid; cat_trim_kit     uuid;
  cat_carpet      uuid; cat_tyres       uuid;
  tyres_group_id  uuid;
  interior_set    uuid;
  exterior_set    uuid;

  grenadier       uuid; defender_110    uuid; defender_90      uuid;
  defender_130    uuid; g350            uuid; g63              uuid;
  jl_2            uuid; jl_4            uuid;
  lc_250          uuid; lc70_2          uuid; lc70_4           uuid;
  new_opt_id      uuid;
BEGIN
  SELECT id INTO cat_body        FROM catalog_categories WHERE builder_id=ctc_id AND name='Body kit';
  SELECT id INTO cat_wheel_arch  FROM catalog_categories WHERE builder_id=ctc_id AND name='Wheel arches';
  SELECT id INTO cat_front_bumper FROM catalog_categories WHERE builder_id=ctc_id AND name='Front bumper';
  SELECT id INTO cat_bonnet      FROM catalog_categories WHERE builder_id=ctc_id AND name='Bonnet';
  SELECT id INTO cat_bonnet_vent FROM catalog_categories WHERE builder_id=ctc_id AND name='Bonnet vents';
  SELECT id INTO cat_side_vent   FROM catalog_categories WHERE builder_id=ctc_id AND name='Side vents';
  SELECT id INTO cat_roof_spoil  FROM catalog_categories WHERE builder_id=ctc_id AND name='Roof spoiler';
  SELECT id INTO cat_grille      FROM catalog_categories WHERE builder_id=ctc_id AND name='Grille';
  SELECT id INTO cat_door_mask   FROM catalog_categories WHERE builder_id=ctc_id AND name='Door mask';
  SELECT id INTO cat_leather     FROM catalog_categories WHERE builder_id=ctc_id AND name='Leather interior';
  SELECT id INTO cat_steering    FROM catalog_categories WHERE builder_id=ctc_id AND name='Steering wheel';
  SELECT id INTO cat_trim_kit    FROM catalog_categories WHERE builder_id=ctc_id AND name='Interior trim kit';
  SELECT id INTO cat_carpet      FROM catalog_categories WHERE builder_id=ctc_id AND name='Floor carpet';

  -- Finish sets
  INSERT INTO catalog_finish_sets (builder_id, name, applies_to_category_ids, sort)
  VALUES (ctc_id, 'Interior colour',
          ARRAY[cat_leather, cat_steering, cat_trim_kit, cat_carpet]::uuid[],
          10)
  ON CONFLICT (builder_id, name) DO UPDATE
    SET applies_to_category_ids = EXCLUDED.applies_to_category_ids
  RETURNING id INTO interior_set;

  INSERT INTO catalog_finish_sets (builder_id, name, applies_to_category_ids, sort)
  VALUES (ctc_id, 'Exterior finish',
          ARRAY[cat_body, cat_wheel_arch, cat_front_bumper, cat_bonnet,
                cat_bonnet_vent, cat_side_vent, cat_roof_spoil, cat_grille,
                cat_door_mask]::uuid[],
          20)
  ON CONFLICT (builder_id, name) DO UPDATE
    SET applies_to_category_ids = EXCLUDED.applies_to_category_ids
  RETURNING id INTO exterior_set;

  -- Interior colour finishes (no overrides — ops picks a colour, no
  -- hours or materials change).
  INSERT INTO catalog_finishes (finish_set_id, name, sort) VALUES
    (interior_set, 'Black',   10),
    (interior_set, 'Tan',     20),
    (interior_set, 'Cognac',  30),
    (interior_set, 'Red',     40),
    (interior_set, 'Blue',    50),
    (interior_set, 'Ivory',   60),
    (interior_set, 'Custom',  70);

  -- Exterior finishes.
  INSERT INTO catalog_finishes (finish_set_id, name, paint_hours_override, materials_cents_override, sort) VALUES
    (exterior_set, 'No finish (carbon / as supplied)',   0,    0,     10),
    (exterior_set, 'Black Raptor tactile liner',         6,    35000, 20),
    (exterior_set, 'Colour-matched Raptor tactile liner', 8,   50000, 30),
    (exterior_set, 'Body-colour paint',                  NULL, NULL,  40);

  -- ─── Tyres category ─────────────────────────────────────────────
  INSERT INTO catalog_categories (builder_id, name, install_hours, paint_hours, paint_materials_cents, freight_cents, hts_duty_pct, sort)
  VALUES (ctc_id, 'Tyres', 1, 0, 0, 0, 0, 320)
  ON CONFLICT (builder_id, name) DO NOTHING
  RETURNING id INTO cat_tyres;
  IF cat_tyres IS NULL THEN
    SELECT id INTO cat_tyres FROM catalog_categories WHERE builder_id=ctc_id AND name='Tyres';
  END IF;

  -- ─── Manual Tyres group ────────────────────────────────────────
  -- synced=false so the Shopify sync won't touch or delete it.
  INSERT INTO catalog_option_groups
    (builder_id, slug, name, selection, required, platform_id, sort, active, allow_quantity, synced, external_id)
  VALUES (ctc_id, 'tyres', 'Tyres', 'multi', false, NULL, 40, true, true, false, NULL)
  ON CONFLICT (builder_id, slug) DO UPDATE
    SET allow_quantity = true, active = true, synced = false
  RETURNING id INTO tyres_group_id;

  -- Platform IDs we need to attach each tyre to.
  SELECT id INTO grenadier    FROM catalog_platforms WHERE builder_id=ctc_id AND slug='ineos-grenadier-2023-onwards';
  SELECT id INTO defender_90  FROM catalog_platforms WHERE builder_id=ctc_id AND slug='land-rover-defender-90-2020-onwards';
  SELECT id INTO defender_110 FROM catalog_platforms WHERE builder_id=ctc_id AND slug='land-rover-defender-110-2020-onwards';
  SELECT id INTO defender_130 FROM catalog_platforms WHERE builder_id=ctc_id AND slug='land-rover-defender-130-2020-onwards';
  SELECT id INTO g350         FROM catalog_platforms WHERE builder_id=ctc_id AND slug='mercedes-benz-g-wagon-g350-400-2018-onwards';
  SELECT id INTO g63          FROM catalog_platforms WHERE builder_id=ctc_id AND slug='mercedes-benz-g-wagon-g63-2018-onwards';
  SELECT id INTO jl_2         FROM catalog_platforms WHERE builder_id=ctc_id AND slug='jeep-wrangler-jl-2-door-2018-onwards';
  SELECT id INTO jl_4         FROM catalog_platforms WHERE builder_id=ctc_id AND slug='jeep-wrangler-jl-4-door-2018-onwards';
  SELECT id INTO lc_250       FROM catalog_platforms WHERE builder_id=ctc_id AND slug='toyota-land-cruiser-250-2024-onwards';
  SELECT id INTO lc70_2       FROM catalog_platforms WHERE builder_id=ctc_id AND slug='toyota-land-cruiser-70-2-door-2023-onwards';
  SELECT id INTO lc70_4       FROM catalog_platforms WHERE builder_id=ctc_id AND slug='toyota-land-cruiser-70-4-door-2023-onwards';

  -- Helper: insert a tyre option and link it to one or more platforms.
  -- price_cents stays 0 so the configurator shows "Set a price" until
  -- ops enters a value.
  CREATE TEMP TABLE _tyre_seed(name text, slug text, platforms uuid[], sort int) ON COMMIT DROP;
  INSERT INTO _tyre_seed(name, slug, platforms, sort) VALUES
    ('Grenadier 285/70R17',    'tyre-grenadier-285-70-r17',  ARRAY[grenadier],                  10),
    ('Grenadier 275/65R20',    'tyre-grenadier-275-65-r20',  ARRAY[grenadier],                  20),
    ('Defender (2020+) 275/55R20', 'tyre-defender-2020-275-55-r20', ARRAY[defender_90, defender_110, defender_130], 30),
    ('Defender (2020+) 285/45R22', 'tyre-defender-2020-285-45-r22', ARRAY[defender_90, defender_110, defender_130], 40),
    ('Defender (2020+) 275/40R23', 'tyre-defender-2020-275-40-r23', ARRAY[defender_90, defender_110, defender_130], 50),
    ('G-Wagon 285/45R22',      'tyre-gwagon-285-45-r22',     ARRAY[g350, g63],                  60),
    ('G-Wagon 285/40R23',      'tyre-gwagon-285-40-r23',     ARRAY[g350, g63],                  70),
    ('Wrangler JL 285/70R17',  'tyre-jl-285-70-r17',         ARRAY[jl_2, jl_4],                 80),
    ('Wrangler JL 275/55R20',  'tyre-jl-275-55-r20',         ARRAY[jl_2, jl_4],                 90),
    ('Land Cruiser 265/70R17', 'tyre-lc-265-70-r17',         ARRAY[lc_250, lc70_2, lc70_4],    100),
    ('Land Cruiser 285/60R20', 'tyre-lc-285-60-r20',         ARRAY[lc_250, lc70_2, lc70_4],    110);

  INSERT INTO catalog_options
    (builder_id, group_id, slug, name, code, price_cents, included_in_tier_ids,
     sort, active, synced, category_id, source_currency, manual_parts_sell_cents)
  SELECT ctc_id, tyres_group_id, t.slug, t.name, NULL, 0, '{}',
         t.sort, true, false, cat_tyres, 'USD', NULL
    FROM _tyre_seed t
   ON CONFLICT (builder_id, slug) DO NOTHING;

  INSERT INTO catalog_option_platforms (option_id, platform_id)
  SELECT o.id, UNNEST(t.platforms)
    FROM _tyre_seed t
    JOIN catalog_options o ON o.builder_id = ctc_id AND o.slug = t.slug
   ON CONFLICT DO NOTHING;

  -- ─── 3. Tier cleanup ───────────────────────────────────────────
  DELETE FROM catalog_tiers
   WHERE builder_id = ctc_id
     AND slug IN ('chelsea-edition', 'chelsea-wide-track');

  -- ─── CTC process stages (brand copy) ───────────────────────────
  -- Rewritten for a kit-fitting workflow: no donor-sourcing or long
  -- resto build, just the eight stages the customer actually sees.
  UPDATE builder_brand
     SET process_copy = jsonb_build_array(
       jsonb_build_object('label', 'Consultation',       'copy', 'We talk through the vehicle you own (or plan to buy) and the look you want.'),
       jsonb_build_object('label', 'Quote',              'copy', 'A fixed quote with parts, finishes, fitting labour and lead time — valid 30 days.'),
       jsonb_build_object('label', 'Deposit & kit order','copy', 'A reservation deposit confirms the slot and triggers the kit order from Chelsea.'),
       jsonb_build_object('label', 'Vehicle intake',     'copy', 'Drop the vehicle at the shop; we photograph intake condition and confirm the plan.'),
       jsonb_build_object('label', 'Fit & finish',       'copy', 'Our partner shop fits the kit and applies the chosen finish — typically four to eight weeks.'),
       jsonb_build_object('label', 'Sign-off',           'copy', 'You inspect the finished vehicle alongside the technician who built it; nothing ships until you approve.'),
       jsonb_build_object('label', 'Collection',         'copy', 'Pick up the vehicle or we arrange enclosed transport anywhere in the US.'),
       jsonb_build_object('label', 'Aftercare',          'copy', 'Twelve months of workmanship cover plus priority service for anything that needs attention.')
     )::jsonb
   WHERE builder_id = ctc_id;
END $$;
