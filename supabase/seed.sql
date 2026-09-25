-- ============================================================
-- KlassikWerk seed data
-- Uses fixed UUIDs so options can reference tier IDs.
-- ============================================================

-- Platforms
INSERT INTO catalog_platforms (id, slug, name, chassis, years, sort, active) VALUES
  ('00000000-0000-0000-0000-000000000001', 'w463', 'G-Class W463', 'W463', '1999–2006', 1, true),
  ('00000000-0000-0000-0000-000000000002', 'r129', 'SL R129',      'R129', '1990–2002', 2, true),
  ('00000000-0000-0000-0000-000000000003', 'w124', 'E-Class W124', 'W124', '1992–1996', 3, true)
ON CONFLICT (slug) DO NOTHING;

-- Tiers
INSERT INTO catalog_tiers (id, slug, name, base_price_cents, lead_time_weeks, quote_only, sort) VALUES
  ('00000000-0000-0000-0000-000000000011', 'klassik',      'Klassik',       7000000, 12, false, 1),
  ('00000000-0000-0000-0000-000000000012', 'klassik-plus', 'Klassik Plus', 11000000, 18, false, 2),
  ('00000000-0000-0000-0000-000000000013', 'werk',         'Werk',          NULL,    NULL, true, 3)
ON CONFLICT (slug) DO NOTHING;

-- Option groups
INSERT INTO catalog_option_groups (id, slug, name, selection, required, sort) VALUES
  ('00000000-0000-0000-0000-000000000021', 'exterior-colour', 'Exterior Colour', 'single', true,  1),
  ('00000000-0000-0000-0000-000000000022', 'leather',         'Leather',         'single', true,  2),
  ('00000000-0000-0000-0000-000000000023', 'walnut',          'Walnut',          'single', false, 3),
  ('00000000-0000-0000-0000-000000000024', 'wheels',          'Wheels',          'single', false, 4),
  ('00000000-0000-0000-0000-000000000025', 'seats',           'Seats',           'single', false, 5),
  ('00000000-0000-0000-0000-000000000026', 'audio',           'Audio',           'single', false, 6),
  ('00000000-0000-0000-0000-000000000027', 'extras',          'Extras',          'multi',  false, 7)
ON CONFLICT (slug) DO NOTHING;

-- Exterior colours
INSERT INTO catalog_options (id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0000-000000000021',
    'alanite-green', 'Alanite Green', 'MB-ALANITE', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  ),
  (
    '00000000-0000-0000-0001-000000000002',
    '00000000-0000-0000-0000-000000000021',
    'chalcedon-blue', 'Chalcedon Blue', 'MB-347', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    2, true
  ),
  (
    '00000000-0000-0000-0001-000000000003',
    '00000000-0000-0000-0000-000000000021',
    'tanzanite-blue', 'Tanzanite Blue', 'MB-359', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    3, true
  )
ON CONFLICT (slug) DO NOTHING;

-- Leather
INSERT INTO catalog_options (id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0002-000000000001',
    '00000000-0000-0000-0000-000000000022',
    'hydes-greige', 'Hydes Thema Greige', 'HYDES-6113', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  ),
  (
    '00000000-0000-0000-0002-000000000002',
    '00000000-0000-0000-0000-000000000022',
    'hydes-chalk', 'Hydes Thema Chalk', 'HYDES-CHALK', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    2, true
  ),
  (
    '00000000-0000-0000-0002-000000000003',
    '00000000-0000-0000-0000-000000000022',
    'hydes-anthracite', 'Hydes Thema Anthracite', 'HYDES-2617', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    3, true
  )
ON CONFLICT (slug) DO NOTHING;

-- Walnut
INSERT INTO catalog_options (id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0003-000000000001',
    '00000000-0000-0000-0000-000000000023',
    'walnut-classic-burl', 'Classic Burl', 'WLT-BURL', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  )
ON CONFLICT (slug) DO NOTHING;

-- Wheels
INSERT INTO catalog_options (id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0004-000000000001',
    '00000000-0000-0000-0000-000000000024',
    'wheels-period-refinish', 'Period-correct refinish', 'WHL-REFINISH', 0,
    ARRAY['00000000-0000-0000-0000-000000000012']::uuid[],
    1, true
  ),
  (
    '00000000-0000-0000-0004-000000000002',
    '00000000-0000-0000-0000-000000000024',
    'wheels-new-set', 'New set', 'WHL-NEW', 0,
    ARRAY[]::uuid[],
    2, true
  )
ON CONFLICT (slug) DO NOTHING;

-- Seats
INSERT INTO catalog_options (id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0005-000000000001',
    '00000000-0000-0000-0000-000000000025',
    'seats-standard-retrim', 'Standard retrim', 'SEAT-STD', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  ),
  (
    '00000000-0000-0000-0005-000000000002',
    '00000000-0000-0000-0000-000000000025',
    'seats-scheel-mann', 'Scheel-Mann', 'SEAT-SM', 600000,
    ARRAY[]::uuid[],
    2, true
  )
ON CONFLICT (slug) DO NOTHING;

-- Scheel-Mann restricted to G-Class W463
INSERT INTO catalog_option_platforms (option_id, platform_id) VALUES
  ('00000000-0000-0000-0005-000000000002', '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- Audio
INSERT INTO catalog_options (id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0006-000000000001',
    '00000000-0000-0000-0000-000000000026',
    'audio-blaupunkt-dab', 'Blaupunkt Frankfurt RCM 82 DAB', 'AUD-BLAUPUNKT', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  ),
  (
    '00000000-0000-0000-0006-000000000002',
    '00000000-0000-0000-0000-000000000026',
    'audio-retractable-screen', 'Hidden retractable screen', 'AUD-SCREEN', 450000,
    ARRAY[]::uuid[],
    2, true
  )
ON CONFLICT (slug) DO NOTHING;

-- Extras
INSERT INTO catalog_options (id, group_id, slug, name, code, price_cents, included_in_tier_ids, sort, active) VALUES
  (
    '00000000-0000-0000-0007-000000000001',
    '00000000-0000-0000-0000-000000000027',
    'extras-retro-carphone', 'Retro carphone', 'EXT-PHONE', 0,
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013']::uuid[],
    1, true
  )
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Set Elliot's account to ops role
-- Run this AFTER the first magic-link login:
-- ============================================================
-- UPDATE profiles
--   SET role = 'ops'
-- WHERE user_id = (
--   SELECT id FROM auth.users
--   WHERE email = 'elliot.humble@gmail.com'
-- );
