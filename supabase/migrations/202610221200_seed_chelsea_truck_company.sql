-- Chelsea Truck Company — manual builder, priced catalog.
-- Kahn Design conversions, built in the USA. Placeholder swatches
-- (inline SVG data URIs); the real catalog imagery is uploaded via
-- Ops → Catalog later.

-- ------------------------------------------------------------
-- Builder
-- ------------------------------------------------------------
INSERT INTO builders (
  id, operator_id, slug, name, legal_name, active, sort, catalog_source
) VALUES (
  '20000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000001',
  'ctc',
  'Chelsea Truck Company',
  'Chelsea Truck Company LLC',
  true, 4, 'manual'
)
ON CONFLICT (operator_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- Brand
-- ------------------------------------------------------------
INSERT INTO builder_brand (
  builder_id, wordmark_text, color_accent, color_bg, color_text,
  font_display, font_body, tagline, hero_copy, process_copy, enquire_url
) VALUES (
  '20000000-0000-0000-0000-000000000004',
  'Chelsea Truck Co.',
  '#000000', '#F5F3EE', '#1A1A1A',
  'Fraunces', 'Inter',
  'Kahn Design conversions, built in the USA.',
  'Chelsea Truck Company brings Kahn Design''s heritage conversions to the United States, built in Florida with American components.',
  jsonb_build_array(
    jsonb_build_object('label', 'Design',    'copy', 'Walk the configurator and lock a specification.'),
    jsonb_build_object('label', 'Reserve',   'copy', 'A $5,000 reservation holds your production slot.'),
    jsonb_build_object('label', 'Contract',  'copy', 'Final specification locked. Work authorization signed.'),
    jsonb_build_object('label', 'Intake',    'copy', 'Donor vehicle supplied or sourced on your behalf.'),
    jsonb_build_object('label', 'Build',     'copy', 'Conversion carried out in our Florida workshop.'),
    jsonb_build_object('label', 'Paint',     'copy', 'Colour and interior samples signed off in person.'),
    jsonb_build_object('label', 'Delivery',  'copy', 'Collection at the workshop or delivered to your door.'),
    jsonb_build_object('label', 'Aftercare', 'copy', '12-month workmanship warranty on all work performed.')
  ),
  'https://www.chelseatruckcompany.com'
)
ON CONFLICT (builder_id) DO NOTHING;

-- ------------------------------------------------------------
-- Terms
-- ------------------------------------------------------------
INSERT INTO builder_terms (
  builder_id, reservation_cents, payment_schedule,
  warranty_text, governing_law, lead_time_copy, currency, option_mode
) VALUES (
  '20000000-0000-0000-0000-000000000004',
  500000,
  jsonb_build_array(
    jsonb_build_object('label', 'Contract signing', 'percent', 50, 'trigger', 'contract'),
    jsonb_build_object('label', 'Paint sign-off',   'percent', 40, 'trigger', 'samples'),
    jsonb_build_object('label', 'Delivery',         'percent', 10, 'trigger', 'delivery')
  ),
  '12-month workmanship warranty on all work performed by Chelsea Truck Company.',
  'State of Florida',
  'Current lead time: 20–28 weeks from contract signing.',
  'usd',
  'priced'
)
ON CONFLICT (builder_id) DO NOTHING;

-- ------------------------------------------------------------
-- Contract template (cloned from KlassikWerk; names fill via merge fields)
-- ------------------------------------------------------------
INSERT INTO contract_templates (
  builder_id, version, title, body_markdown, merge_fields, is_current
) VALUES (
  '20000000-0000-0000-0000-000000000004',
  1,
  'Work Authorization',
  $md$# Work Authorization

**Builder:** {{builder_legal_name}}
**Customer:** {{customer_full_name}}
**Address:** {{customer_address}}

## Vehicle

- Platform: {{vehicle_platform}}
- VIN: {{vehicle_vin}}
- Year: {{vehicle_year}}

## Configuration

{{configuration_table}}

## Price

Total: **{{price_total}}**

## Payment Schedule

{{payment_schedule_table}}

## Warranty

{{warranty_text}}

## Governing Law

This agreement is governed by the laws of {{governing_law}}.

## Signatures

Customer: ______________________________   Date: ______________

{{builder_name}} authorized representative: ______________________________   Date: ______________
$md$,
  jsonb_build_array(
    'builder_legal_name', 'builder_name', 'customer_full_name', 'customer_address',
    'vehicle_platform', 'vehicle_vin', 'vehicle_year',
    'configuration_table', 'price_total', 'payment_schedule_table',
    'warranty_text', 'governing_law'
  ),
  true
)
ON CONFLICT (builder_id, version) DO NOTHING;

-- ------------------------------------------------------------
-- Platforms
-- ------------------------------------------------------------
INSERT INTO catalog_platforms (id, builder_id, slug, name, chassis, years, sort, active) VALUES
  ('00000000-0000-0000-0200-000000000001', '20000000-0000-0000-0000-000000000004', 'grenadier',         'INEOS Grenadier',               'Grenadier', '2023–',    1, true),
  ('00000000-0000-0000-0200-000000000002', '20000000-0000-0000-0000-000000000004', 'defender-l663-90',  'Land Rover Defender L663 90',  'L663 90',   '2020–',    2, true),
  ('00000000-0000-0000-0200-000000000003', '20000000-0000-0000-0000-000000000004', 'defender-l663-110', 'Land Rover Defender L663 110', 'L663 110',  '2020–',    3, true)
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- Tiers (shared across all platforms)
-- ------------------------------------------------------------
INSERT INTO catalog_tiers (id, builder_id, slug, name, base_price_cents, lead_time_weeks, description, quote_only, active, sort) VALUES
  ('00000000-0000-0000-0200-000000000011', '20000000-0000-0000-0000-000000000004', 'chelsea-edition',    'Chelsea Edition',    4500000, 20, 'Base Chelsea conversion package.', false, true, 1),
  ('00000000-0000-0000-0200-000000000012', '20000000-0000-0000-0000-000000000004', 'chelsea-wide-track', 'Chelsea Wide Track', 6200000, 24, 'Wide-arch body + stance package.',  false, true, 2)
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- Option groups
-- ------------------------------------------------------------
INSERT INTO catalog_option_groups (id, builder_id, slug, name, selection, required, sort) VALUES
  ('00000000-0000-0000-0200-000000000021', '20000000-0000-0000-0000-000000000004', 'exterior-colour',  'Exterior colour',  'single', true,  1),
  ('00000000-0000-0000-0200-000000000022', '20000000-0000-0000-0000-000000000004', 'wheels',           'Wheels',           'single', false, 2),
  ('00000000-0000-0000-0200-000000000023', '20000000-0000-0000-0000-000000000004', 'interior',         'Interior',         'single', true,  3),
  ('00000000-0000-0000-0200-000000000024', '20000000-0000-0000-0000-000000000004', 'exterior-details', 'Exterior details', 'multi',  false, 4)
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- Options — exterior colour
--   Placeholder swatches: inline SVG data URIs so the UI renders a
--   coloured square per option until Ops uploads real swatches.
-- ------------------------------------------------------------
INSERT INTO catalog_options (
  id, builder_id, group_id, slug, name, code, price_cents,
  included_in_tier_ids, swatch_image_url, sort, active
) VALUES
  (
    '00000000-0000-0000-0201-000000000001',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000021',
    'keep-original-paint', 'Keep original paint', 'EXT-ORIG', 0,
    ARRAY['00000000-0000-0000-0200-000000000011','00000000-0000-0000-0200-000000000012']::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23888888"/></svg>$sw$,
    1, true
  ),
  (
    '00000000-0000-0000-0201-000000000002',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000021',
    'chelsea-deep-black', 'Chelsea Deep Black respray', 'EXT-CDB', 350000,
    ARRAY[]::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23111111"/></svg>$sw$,
    2, true
  ),
  (
    '00000000-0000-0000-0201-000000000003',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000021',
    'monte-carlo-blue', 'Monte Carlo Blue respray', 'EXT-MCB', 350000,
    ARRAY[]::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%231E2E5A"/></svg>$sw$,
    3, true
  ),
  (
    '00000000-0000-0000-0201-000000000004',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000021',
    'verde-mantis', 'Verde Mantis respray', 'EXT-VM', 450000,
    ARRAY[]::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%232A3F2A"/></svg>$sw$,
    4, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- Options — wheels
-- ------------------------------------------------------------
INSERT INTO catalog_options (
  id, builder_id, group_id, slug, name, code, price_cents,
  included_in_tier_ids, swatch_image_url, sort, active
) VALUES
  (
    '00000000-0000-0000-0202-000000000001',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000022',
    'kahn-mondial-20', 'Kahn 20" Mondial', 'WHL-KM20', 450000,
    ARRAY[]::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23464646"/></svg>$sw$,
    1, true
  ),
  (
    '00000000-0000-0000-0202-000000000002',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000022',
    'kahn-monza-22', 'Kahn 22" Monza', 'WHL-KM22', 680000,
    ARRAY[]::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%232B2B2B"/></svg>$sw$,
    2, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- Options — interior
-- ------------------------------------------------------------
INSERT INTO catalog_options (
  id, builder_id, group_id, slug, name, code, price_cents,
  included_in_tier_ids, swatch_image_url, sort, active
) VALUES
  (
    '00000000-0000-0000-0203-000000000001',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000023',
    'keep-original-interior', 'Keep original interior', 'INT-ORIG', 0,
    ARRAY['00000000-0000-0000-0200-000000000011','00000000-0000-0000-0200-000000000012']::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23888888"/></svg>$sw$,
    1, true
  ),
  (
    '00000000-0000-0000-0203-000000000002',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000023',
    'chelsea-quilted-leather', 'Chelsea quilted leather', 'INT-CQL', 650000,
    ARRAY[]::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%235A3E2A"/></svg>$sw$,
    2, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- Options — exterior details (multi-select)
-- ------------------------------------------------------------
INSERT INTO catalog_options (
  id, builder_id, group_id, slug, name, code, price_cents,
  included_in_tier_ids, swatch_image_url, sort, active
) VALUES
  (
    '00000000-0000-0000-0204-000000000001',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000024',
    'hood-vents', 'Hood vents', 'EXT-HV', 85000,
    ARRAY[]::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23555555"/></svg>$sw$,
    1, true
  ),
  (
    '00000000-0000-0000-0204-000000000002',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000024',
    'roof-rails', 'Roof rails', 'EXT-RR', 120000,
    ARRAY[]::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23555555"/></svg>$sw$,
    2, true
  ),
  (
    '00000000-0000-0000-0204-000000000003',
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0200-000000000024',
    'bumper-kit', 'Bumper kit', 'EXT-BK', 240000,
    ARRAY[]::uuid[],
    $sw$data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23555555"/></svg>$sw$,
    3, true
  )
ON CONFLICT (builder_id, slug) DO NOTHING;
