-- ============================================================
-- Catalog seed
--
-- Operators + builders + brand + terms + contract templates are
-- seeded inside migration 202610141200_multi_builder.sql, so the
-- builder IDs referenced below already exist.
--
--   klassikwerk  = 20000000-0000-0000-0000-000000000001
--   demo-builder = 20000000-0000-0000-0000-000000000002
-- ============================================================

-- ------------------------------------------------------------
-- KlassikWerk platforms
-- ------------------------------------------------------------
INSERT INTO catalog_platforms (id, builder_id, slug, name, chassis, years, sort, active) VALUES
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'w463', 'G-Class W463', 'W463', '1999–2006', 1, true),
  ('00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'r129', 'SL R129',      'R129', '1990–2002', 2, true),
  ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'w124', 'E-Class W124', 'W124', '1992–1996', 3, true)
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- KlassikWerk tiers
-- ------------------------------------------------------------
INSERT INTO catalog_tiers (id, builder_id, slug, name, base_price_cents, lead_time_weeks, quote_only, sort) VALUES
  ('00000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', 'klassik',      'Klassik',       7000000, 12, false, 1),
  ('00000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000001', 'klassik-plus', 'Klassik Plus', 11000000, 18, false, 2),
  ('00000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000001', 'werk',         'Werk',          NULL,    NULL, true,  3)
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- KlassikWerk option groups
-- ------------------------------------------------------------
INSERT INTO catalog_option_groups (id, builder_id, slug, name, selection, required, sort) VALUES
  ('00000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000001', 'exterior-colour', 'Exterior Colour', 'single', true,  1),
  ('00000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000001', 'leather',         'Leather',         'single', true,  2),
  ('00000000-0000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000001', 'walnut',          'Walnut',          'single', false, 3),
  ('00000000-0000-0000-0000-000000000024', '20000000-0000-0000-0000-000000000001', 'wheels',          'Wheels',          'single', false, 4),
  ('00000000-0000-0000-0000-000000000025', '20000000-0000-0000-0000-000000000001', 'seats',           'Seats',           'single', false, 5),
  ('00000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000001', 'audio',           'Audio',           'single', false, 6),
  ('00000000-0000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000001', 'extras',          'Extras',          'multi',  false, 7)
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- KlassikWerk options
-- ------------------------------------------------------------
INSERT INTO catalog_options (id, builder_id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0001-000000000001', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000021',
    'alanite-green', 'Alanite Green', 'MB-ALANITE', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  ),
  (
    '00000000-0000-0000-0001-000000000002', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000021',
    'chalcedon-blue', 'Chalcedon Blue', 'MB-347', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    2, true
  ),
  (
    '00000000-0000-0000-0001-000000000003', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000021',
    'tanzanite-blue', 'Tanzanite Blue', 'MB-359', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    3, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;

INSERT INTO catalog_options (id, builder_id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0002-000000000001', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000022',
    'hydes-greige', 'Hydes Thema Greige', 'HYDES-6113', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  ),
  (
    '00000000-0000-0000-0002-000000000002', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000022',
    'hydes-chalk', 'Hydes Thema Chalk', 'HYDES-CHALK', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    2, true
  ),
  (
    '00000000-0000-0000-0002-000000000003', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000022',
    'hydes-anthracite', 'Hydes Thema Anthracite', 'HYDES-2617', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    3, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;

INSERT INTO catalog_options (id, builder_id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0003-000000000001', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000023',
    'walnut-classic-burl', 'Classic Burl', 'WLT-BURL', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;

INSERT INTO catalog_options (id, builder_id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0004-000000000001', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000024',
    'wheels-period-refinish', 'Period-correct refinish', 'WHL-REFINISH', 0,
    ARRAY['00000000-0000-0000-0000-000000000012']::uuid[],
    1, true
  ),
  (
    '00000000-0000-0000-0004-000000000002', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000024',
    'wheels-new-set', 'New set', 'WHL-NEW', 0,
    ARRAY[]::uuid[],
    2, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;

INSERT INTO catalog_options (id, builder_id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0005-000000000001', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000025',
    'seats-standard-retrim', 'Standard retrim', 'SEAT-STD', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  ),
  (
    '00000000-0000-0000-0005-000000000002', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000025',
    'seats-scheel-mann', 'Scheel-Mann', 'SEAT-SM', 600000,
    ARRAY[]::uuid[],
    2, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;

INSERT INTO catalog_option_platforms (option_id, platform_id) VALUES
  ('00000000-0000-0000-0005-000000000002', '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO catalog_options (id, builder_id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0006-000000000001', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000026',
    'audio-blaupunkt-dab', 'Blaupunkt Frankfurt RCM 82 DAB', 'AUD-BLAUPUNKT', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  ),
  (
    '00000000-0000-0000-0006-000000000002', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000026',
    'audio-retractable-screen', 'Hidden retractable screen', 'AUD-SCREEN', 450000,
    ARRAY[]::uuid[],
    2, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;

INSERT INTO catalog_options (id, builder_id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0007-000000000001', '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000027',
    'extras-retro-carphone', 'Retro carphone', 'EXT-PHONE', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ============================================================
-- Demo builder: one platform, one tier, six options
-- ============================================================
INSERT INTO catalog_platforms (id, builder_id, slug, name, chassis, years, sort, active) VALUES
  ('00000000-0000-0000-0100-000000000001', '20000000-0000-0000-0000-000000000002', 'sample-platform', 'Sample Platform', 'XX00', '2000–2010', 1, true)
ON CONFLICT (builder_id, slug) DO NOTHING;

INSERT INTO catalog_tiers (id, builder_id, slug, name, base_price_cents, lead_time_weeks, quote_only, sort) VALUES
  ('00000000-0000-0000-0100-000000000011', '20000000-0000-0000-0000-000000000002', 'standard', 'Standard', 5000000, 12, false, 1)
ON CONFLICT (builder_id, slug) DO NOTHING;

INSERT INTO catalog_option_groups (id, builder_id, slug, name, selection, required, sort) VALUES
  ('00000000-0000-0000-0100-000000000021', '20000000-0000-0000-0000-000000000002', 'exterior', 'Exterior', 'single', true,  1),
  ('00000000-0000-0000-0100-000000000022', '20000000-0000-0000-0000-000000000002', 'interior', 'Interior', 'single', true,  2),
  ('00000000-0000-0000-0100-000000000023', '20000000-0000-0000-0000-000000000002', 'extras',   'Extras',   'multi',  false, 3)
ON CONFLICT (builder_id, slug) DO NOTHING;

INSERT INTO catalog_options (id, builder_id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  ('00000000-0000-0000-0101-000000000001', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0100-000000000021', 'exterior-silver', 'Silver', 'DEMO-S', 0,     ARRAY['00000000-0000-0000-0100-000000000011']::uuid[], 1, true),
  ('00000000-0000-0000-0101-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0100-000000000021', 'exterior-graphite', 'Graphite', 'DEMO-G', 0,  ARRAY['00000000-0000-0000-0100-000000000011']::uuid[], 2, true),
  ('00000000-0000-0000-0102-000000000001', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0100-000000000022', 'interior-tan', 'Tan leather', 'DEMO-T', 0,     ARRAY['00000000-0000-0000-0100-000000000011']::uuid[], 1, true),
  ('00000000-0000-0000-0102-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0100-000000000022', 'interior-black', 'Black leather', 'DEMO-B', 0, ARRAY['00000000-0000-0000-0100-000000000011']::uuid[], 2, true),
  ('00000000-0000-0000-0103-000000000001', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0100-000000000023', 'extras-nav', 'Navigation', 'DEMO-NAV', 150000, ARRAY[]::uuid[], 1, true),
  ('00000000-0000-0000-0103-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0100-000000000023', 'extras-audio', 'Premium audio', 'DEMO-AUD', 200000, ARRAY[]::uuid[], 2, true)
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ============================================================
-- Set Elliot to operator role (idempotent).
-- Run after the first magic-link login:
--   UPDATE profiles SET role = 'operator'
--     WHERE user_id = (SELECT id FROM auth.users WHERE email = 'elliot.humble@gmail.com');
-- ============================================================
