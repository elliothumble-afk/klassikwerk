-- Tyres on CTC — follow-up to the placeholder seed.
--
--   1. catalog_options.auto_add_with_group_id — when any option from
--      the referenced group is selected on the same platform, the
--      quote editor adds this option automatically, mirroring the
--      wheel's quantity. Ops can remove or swap it.
--
--   2. catalog_options.cost_cents — operator cost for a manual option.
--      The margin panel uses it when set; otherwise it falls back to
--      assuming cost = parts_sell (zero margin on the part itself).
--
--   3. Tyres group becomes single-select — one tyre per quote.
--
--   4. Reseed the placeholders:
--        Grenadier gets one BFGoodrich All-Terrain T/A KO3
--        33x12.50R20 LT (SKU 4929) at $410/tyre, auto-added with
--        wheels.
--        Defender 90/110/130 (2020+) get two 275/45R22 tyres with
--        blank prices — Pirelli Scorpion Zero All Season (SKU
--        2661900, auto-add default) and BFGoodrich Trail-Terrain T/A
--        (SKU 34341).

ALTER TABLE catalog_options
  ADD COLUMN auto_add_with_group_id uuid REFERENCES catalog_option_groups(id) ON DELETE SET NULL,
  ADD COLUMN cost_cents             int;

-- Make the Tyres group single-select.
UPDATE catalog_option_groups
   SET selection = 'single'
 WHERE builder_id = '20000000-0000-0000-0000-000000000004'
   AND slug = 'tyres';

DO $$
DECLARE
  ctc_id         uuid := '20000000-0000-0000-0000-000000000004';
  tyres_group_id uuid;
  alloy_group_id uuid;
  cat_tyres      uuid;
  grenadier      uuid;
  def_90         uuid;
  def_110        uuid;
  def_130        uuid;
  bfg_grenadier_id uuid;
  pirelli_id     uuid;
  bfg_defender_id uuid;
BEGIN
  SELECT id INTO tyres_group_id FROM catalog_option_groups
   WHERE builder_id = ctc_id AND slug = 'tyres';
  SELECT id INTO alloy_group_id FROM catalog_option_groups
   WHERE builder_id = ctc_id AND external_id = 'shopify:group:alloy-wheels';
  SELECT id INTO cat_tyres FROM catalog_categories
   WHERE builder_id = ctc_id AND name = 'Tyres';

  SELECT id INTO grenadier FROM catalog_platforms
   WHERE builder_id = ctc_id AND slug = 'ineos-grenadier-2023-onwards';
  SELECT id INTO def_90    FROM catalog_platforms
   WHERE builder_id = ctc_id AND slug = 'land-rover-defender-90-2020-onwards';
  SELECT id INTO def_110   FROM catalog_platforms
   WHERE builder_id = ctc_id AND slug = 'land-rover-defender-110-2020-onwards';
  SELECT id INTO def_130   FROM catalog_platforms
   WHERE builder_id = ctc_id AND slug = 'land-rover-defender-130-2020-onwards';

  -- Drop the old Grenadier + Defender 2020 placeholders. Their
  -- catalog_option_platforms rows cascade via the option FK.
  DELETE FROM catalog_options
   WHERE builder_id = ctc_id
     AND slug IN (
       'tyre-grenadier-285-70-r17',
       'tyre-grenadier-275-65-r20',
       'tyre-defender-2020-275-55-r20',
       'tyre-defender-2020-285-45-r22',
       'tyre-defender-2020-275-40-r23'
     );

  -- Grenadier BFG — priced at $410/tyre, auto-add on wheels.
  INSERT INTO catalog_options
    (builder_id, group_id, slug, name, code, kit_sku, price_cents, included_in_tier_ids,
     sort, active, synced, category_id, source_currency,
     manual_parts_sell_cents, auto_add_with_group_id)
  VALUES
    (ctc_id, tyres_group_id,
     'tyre-grenadier-bfg-ko3-33x12-50-r20',
     'BFGoodrich All-Terrain T/A KO3 33x12.50R20 LT',
     '4929', '4929', 0, '{}', 10, true, false, cat_tyres, 'USD',
     41000, alloy_group_id)
  RETURNING id INTO bfg_grenadier_id;

  INSERT INTO catalog_option_platforms (option_id, platform_id)
  VALUES (bfg_grenadier_id, grenadier);

  -- Defender 275/45R22: Pirelli (auto-add default) + BFG. Prices
  -- blank — ops sets them when they get the TR Wholesale list.
  INSERT INTO catalog_options
    (builder_id, group_id, slug, name, code, kit_sku, price_cents, included_in_tier_ids,
     sort, active, synced, category_id, source_currency,
     manual_parts_sell_cents, auto_add_with_group_id)
  VALUES
    (ctc_id, tyres_group_id,
     'tyre-defender-2020-pirelli-scorpion-zero-275-45-r22',
     'Pirelli Scorpion Zero All Season 275/45R22',
     '2661900', '2661900', 0, '{}', 20, true, false, cat_tyres, 'USD',
     NULL, alloy_group_id)
  RETURNING id INTO pirelli_id;

  INSERT INTO catalog_options
    (builder_id, group_id, slug, name, code, kit_sku, price_cents, included_in_tier_ids,
     sort, active, synced, category_id, source_currency,
     manual_parts_sell_cents, auto_add_with_group_id)
  VALUES
    (ctc_id, tyres_group_id,
     'tyre-defender-2020-bfg-trail-terrain-275-45-r22',
     'BFGoodrich Trail-Terrain T/A 275/45R22',
     '34341', '34341', 0, '{}', 30, true, false, cat_tyres, 'USD',
     NULL, NULL)
  RETURNING id INTO bfg_defender_id;

  INSERT INTO catalog_option_platforms (option_id, platform_id)
  VALUES
    (pirelli_id, def_90),  (pirelli_id, def_110),  (pirelli_id, def_130),
    (bfg_defender_id, def_90), (bfg_defender_id, def_110), (bfg_defender_id, def_130);
END $$;
