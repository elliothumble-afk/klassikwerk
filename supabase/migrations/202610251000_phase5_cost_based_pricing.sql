-- Phase 5: cost-based pricing for Shopify-synced builders.
--
-- Introduces origins + catalog_categories. Options gain category_id,
-- origin override, web_price_cents (source-currency retail), and
-- category_locked (so ops edits aren't overwritten by sync).
-- builder_terms gets the cost model inputs + pricing_mode. quote_options
-- gets a cost snapshot so an already-sent quote never reprices.
--
-- CTC is seeded as cost_based with three origins and the thirty
-- categories from docs/seeds/ctc-categories-seed.csv. KlassikWerk and
-- ECD stay simple — their existing price_cents behaviour is untouched.

-- ─── Origins ────────────────────────────────────────────────────────
CREATE TABLE origins (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id         uuid NOT NULL REFERENCES builders(id) ON DELETE CASCADE,
  name               text NOT NULL,
  tariff_pct         numeric NOT NULL DEFAULT 0,
  s232_aluminium_pct numeric NOT NULL DEFAULT 0,
  notes              text,
  sort               int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (builder_id, name)
);
CREATE INDEX origins_builder_idx ON origins (builder_id);
CREATE TRIGGER trg_origins_updated_at BEFORE UPDATE ON origins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE origins ENABLE ROW LEVEL SECURITY;
CREATE POLICY origins_ops_read ON origins FOR SELECT USING (auth_is_operator());
CREATE POLICY origins_ops_write ON origins FOR ALL
  USING (auth_can_write_builder(builder_id))
  WITH CHECK (auth_can_write_builder(builder_id));

-- ─── Categories ─────────────────────────────────────────────────────
CREATE TABLE catalog_categories (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id             uuid NOT NULL REFERENCES builders(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  install_hours          numeric NOT NULL DEFAULT 0,
  paint_hours            numeric NOT NULL DEFAULT 0,
  paint_materials_cents  int NOT NULL DEFAULT 0,
  freight_cents          int NOT NULL DEFAULT 0,
  hts_duty_pct           numeric NOT NULL DEFAULT 0,
  default_origin_id      uuid REFERENCES origins(id) ON DELETE SET NULL,
  shopify_tags           text[] NOT NULL DEFAULT '{}',
  sort                   int NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (builder_id, name)
);
CREATE INDEX catalog_categories_builder_idx ON catalog_categories (builder_id);
CREATE TRIGGER trg_catalog_categories_updated_at BEFORE UPDATE ON catalog_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE catalog_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_categories_ops_read ON catalog_categories FOR SELECT USING (auth_is_operator());
CREATE POLICY catalog_categories_ops_write ON catalog_categories FOR ALL
  USING (auth_can_write_builder(builder_id))
  WITH CHECK (auth_can_write_builder(builder_id));

-- ─── catalog_options additions ─────────────────────────────────────
ALTER TABLE catalog_options
  ADD COLUMN category_id       uuid REFERENCES catalog_categories(id) ON DELETE SET NULL,
  ADD COLUMN origin_id         uuid REFERENCES origins(id) ON DELETE SET NULL,
  ADD COLUMN web_price_cents   int,
  ADD COLUMN source_currency   text NOT NULL DEFAULT 'GBP',
  ADD COLUMN category_locked   boolean NOT NULL DEFAULT false,
  -- Pre-computed splits so the quote editor can multiply parts by qty
  -- without multiplying labour. Populated by reprice_builder; stays
  -- NULL for simple-mode builders (where price_cents is authoritative).
  ADD COLUMN parts_sell_cents   int,
  ADD COLUMN install_price_cents int,
  -- landed_cost = our cost of the parts after discount, duties, freight,
  -- fees. Snapshotted into quote_options so the margin panel can show
  -- our true cost per line.
  ADD COLUMN landed_cost_cents  int;

-- ─── builder_terms additions ───────────────────────────────────────
CREATE TYPE pricing_mode AS ENUM ('simple', 'cost_based');

ALTER TABLE builder_terms
  ADD COLUMN trade_discount_pct    numeric NOT NULL DEFAULT 0,
  ADD COLUMN labour_rate_cents     int NOT NULL DEFAULT 20000,
  ADD COLUMN paint_rate_cents      int NOT NULL DEFAULT 20000,
  ADD COLUMN partner_shop_rate_cents int NOT NULL DEFAULT 11000,
  ADD COLUMN mpf_pct               numeric NOT NULL DEFAULT 0.003464,
  ADD COLUMN brokerage_cents       int NOT NULL DEFAULT 15000,
  ADD COLUMN items_per_shipment    int NOT NULL DEFAULT 6,
  ADD COLUMN aluminium_share_pct   numeric NOT NULL DEFAULT 0.40,
  ADD COLUMN hh_fee_pct            numeric NOT NULL DEFAULT 0.05,
  ADD COLUMN pricing_mode          pricing_mode NOT NULL DEFAULT 'simple';

-- ─── quote_options snapshot ────────────────────────────────────────
-- Taken at save time so a sent/approved quote never reprices when
-- Terms or Categories change later.
ALTER TABLE quote_options
  ADD COLUMN parts_sell_cents    int,
  ADD COLUMN landed_cost_cents   int,
  ADD COLUMN labour_cents        int,
  ADD COLUMN materials_cents     int,
  ADD COLUMN partner_cost_cents  int;

-- ─── Seed CTC ───────────────────────────────────────────────────────
DO $$
DECLARE
  ctc_id  uuid := '20000000-0000-0000-0000-000000000004';
  uk_id   uuid;
  tw_id   uuid;
BEGIN
  -- Mark CTC cost_based + seed cost-model values.
  UPDATE builder_terms
     SET pricing_mode = 'cost_based',
         trade_discount_pct   = 0.25,
         labour_rate_cents    = 20000,
         paint_rate_cents     = 20000,
         partner_shop_rate_cents = 11000,
         mpf_pct              = 0.003464,
         brokerage_cents      = 15000,
         items_per_shipment   = 6,
         aluminium_share_pct  = 0.40,
         hh_fee_pct           = 0.05,
         fx_rate              = 1.27,
         kit_markup           = 1.00
   WHERE builder_id = ctc_id;

  -- Chelsea Conversion tier base = $1,500 flat per job (Assumptions!B14).
  UPDATE catalog_tiers
     SET base_price_cents = 150000
   WHERE builder_id = ctc_id
     AND slug = 'chelsea-conversion';

  -- Origins.
  INSERT INTO origins (builder_id, name, tariff_pct, s232_aluminium_pct, notes, sort) VALUES
    (ctc_id, 'United Kingdom', 0.10, 0.00, 'US–UK Economic Prosperity Deal: UK auto parts at 10% headline.', 10),
    (ctc_id, 'Taiwan',         0.15, 0.50, 'US–Taiwan Agreement on Reciprocal Trade; Section 232 derivative duty applies.', 20),
    (ctc_id, 'China',          0.45, 0.50, 'Reciprocal + IEEPA + Section 232 stack. Placeholder — verify per HTS.', 30)
  ON CONFLICT (builder_id, name) DO NOTHING;

  SELECT id INTO uk_id FROM origins WHERE builder_id = ctc_id AND name = 'United Kingdom';
  SELECT id INTO tw_id FROM origins WHERE builder_id = ctc_id AND name = 'Taiwan';

  -- Categories (30 from the seed CSV).
  INSERT INTO catalog_categories
    (builder_id, name, install_hours, paint_hours, paint_materials_cents, freight_cents, hts_duty_pct, default_origin_id, shopify_tags, sort)
  VALUES
    (ctc_id, 'Body kit',          24,   16, 150000, 120000, 0.025, uk_id, ARRAY['body-kits'], 10),
    (ctc_id, 'Wheel arches',      10,    6,  60000,  50000, 0.025, uk_id, ARRAY['wheel-arches'], 20),
    (ctc_id, 'Roof conversion',   16,    4,  30000,  60000, 0.025, uk_id, ARRAY['sun-roof'], 30),
    (ctc_id, 'Front bumper',       4,    3,  25000,  30000, 0.025, uk_id, ARRAY['front-bumper'], 40),
    (ctc_id, 'Grille',             2,    1,   8000,  12000, 0.025, uk_id, ARRAY['grilles'], 50),
    (ctc_id, 'Bonnet',             4,    4,  35000,  40000, 0.025, uk_id, ARRAY['bonnet'], 60),
    (ctc_id, 'Bonnet vents',       2,    1,   6000,   8000, 0.025, uk_id, ARRAY['bonnet-vents'], 70),
    (ctc_id, 'Side vents',         2,    1,   6000,   8000, 0.025, uk_id, ARRAY['side-vents'], 80),
    (ctc_id, 'Lighting',           3,    0,      0,  10000, 0.025, uk_id, ARRAY['lighting'], 90),
    (ctc_id, 'Roof light bar',     4,    0,      0,  15000, 0.025, uk_id, ARRAY['roof-light'], 100),
    (ctc_id, 'Roof rack',          4,    0,      0,  35000, 0.025, uk_id, ARRAY['roof-rack-and-side-ladder'], 110),
    (ctc_id, 'Side ladder',        2,    0,      0,  12000, 0.025, uk_id, ARRAY['side-ladder'], 120),
    (ctc_id, 'Roof spoiler',       2,    2,  12000,  15000, 0.025, uk_id, ARRAY['roof-spoiler'], 130),
    (ctc_id, 'Exhaust',            4,    0,      0,  25000, 0.025, uk_id, ARRAY['exhausts'], 140),
    (ctc_id, 'Suspension',         6,    0,      0,  25000, 0.025, uk_id, ARRAY['suspension'], 150),
    (ctc_id, 'Side steps',         3,    0,      0,  25000, 0.025, uk_id, ARRAY['side-steps'], 160),
    (ctc_id, 'Spare wheel cover',  1,    0,      0,   8000, 0.025, uk_id, ARRAY['spare-wheel-cover'], 170),
    (ctc_id, 'Storage box',      1.5,    0,      0,  12000, 0.025, uk_id, ARRAY['storage-box'], 180),
    (ctc_id, 'Decals',             1,    0,      0,   3000, 0.040, uk_id, ARRAY['decals'], 190),
    (ctc_id, 'Fuel cap',         0.5,    0,      0,   3000, 0.025, uk_id, ARRAY['fuel-cap'], 200),
    (ctc_id, 'Door mask',          1,    0,      0,   6000, 0.025, uk_id, ARRAY['door-mask'], 210),
    (ctc_id, 'Alloy wheels',       2,    0,      0,  15000, 0.025, tw_id, ARRAY['wheels'], 220),
    (ctc_id, 'Leather interior', 30,     0,      0,  40000, 0.000, uk_id, ARRAY['leather-interiors'], 230),
    (ctc_id, 'Steering wheel',   1.5,    0,      0,   6000, 0.025, uk_id, ARRAY['steering-wheels'], 240),
    (ctc_id, 'Floor mats',       0.5,    0,      0,   6000, 0.060, uk_id, ARRAY['floor-mats','boot-mat'], 250),
    (ctc_id, 'Floor carpet',       6,    0,      0,  10000, 0.060, uk_id, ARRAY['floor-carpets'], 260),
    (ctc_id, 'Interior trim kit',  6,    0,      0,  10000, 0.025, uk_id, ARRAY['interior-trim-kit'], 270),
    (ctc_id, 'Interior hardware',  4,    0,      0,   8000, 0.025, uk_id, ARRAY['hardware'], 280),
    (ctc_id, 'Pedals',             1,    0,      0,   3000, 0.025, uk_id, ARRAY['foot-pedals'], 290),
    (ctc_id, 'Gear shift trim',  0.5,    0,      0,   3000, 0.025, uk_id, ARRAY['gear-sticks'], 300),
    -- Fallback category for anything the sync can't tag — ops will
    -- re-assign by hand or add a tag mapping.
    (ctc_id, 'Other',              2,    0,      0,  10000, 0.025, uk_id, ARRAY[]::text[], 999)
  ON CONFLICT (builder_id, name) DO NOTHING;
END $$;
