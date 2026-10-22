-- Second catalog source type: `shopify`. CTC pulls its catalog from
-- the Chelsea Truck Company Shopify storefront's public endpoints.

-- ------------------------------------------------------------
-- Allow 'shopify' in catalog_source
-- ------------------------------------------------------------
ALTER TABLE builders DROP CONSTRAINT IF EXISTS builders_catalog_source_check;
ALTER TABLE builders ADD CONSTRAINT builders_catalog_source_check
  CHECK (catalog_source IN ('manual', 'connect', 'shopify'));

-- ------------------------------------------------------------
-- builder_terms: fx_rate and kit_markup for Shopify price conversion
-- ------------------------------------------------------------
ALTER TABLE builder_terms
  ADD COLUMN fx_rate     numeric(10, 4) NOT NULL DEFAULT 1.27,
  ADD COLUMN kit_markup  numeric(10, 4) NOT NULL DEFAULT 1.0;

-- ------------------------------------------------------------
-- catalog_options: kit_sku column for the vendor variant SKU
-- ------------------------------------------------------------
ALTER TABLE catalog_options
  ADD COLUMN kit_sku text;

-- ------------------------------------------------------------
-- catalog_option_groups: active flag so groups can be deactivated
-- the same way platforms, tiers and options can.
-- ------------------------------------------------------------
ALTER TABLE catalog_option_groups
  ADD COLUMN active boolean NOT NULL DEFAULT true;

-- ------------------------------------------------------------
-- Point CTC at the Shopify storefront.
-- ------------------------------------------------------------
UPDATE builders
   SET catalog_source     = 'shopify',
       catalog_source_url = 'https://www.chelseatruckcompany.com'
 WHERE slug = 'ctc';

-- ------------------------------------------------------------
-- Deactivate the 3 placeholder platforms seeded for CTC in the
-- previous migration — Shopify-synced ones replace them.
-- ------------------------------------------------------------
UPDATE catalog_platforms
   SET active = false
 WHERE builder_id = '20000000-0000-0000-0000-000000000004'
   AND slug IN ('grenadier', 'defender-l663-90', 'defender-l663-110');

-- ------------------------------------------------------------
-- Deactivate the 2 placeholder tiers; insert the single
-- "Chelsea Conversion" tier at $0 base.
-- ------------------------------------------------------------
UPDATE catalog_tiers
   SET active = false
 WHERE builder_id = '20000000-0000-0000-0000-000000000004'
   AND slug IN ('chelsea-edition', 'chelsea-wide-track');

INSERT INTO catalog_tiers (
  id, builder_id, slug, name, base_price_cents, lead_time_weeks,
  description, quote_only, active, sort
) VALUES (
  '00000000-0000-0000-0200-000000000013',
  '20000000-0000-0000-0000-000000000004',
  'chelsea-conversion',
  'Chelsea Conversion',
  0, 20,
  'Single Chelsea Truck Company conversion tier. Options priced in GBP from the Shopify catalog, converted via builder_terms.fx_rate × kit_markup.',
  false, true, 1
)
ON CONFLICT (builder_id, slug) DO NOTHING;

-- ------------------------------------------------------------
-- Deactivate the 11 placeholder options and their 4 groups.
-- ------------------------------------------------------------
UPDATE catalog_options
   SET active = false
 WHERE builder_id = '20000000-0000-0000-0000-000000000004'
   AND slug IN (
     'keep-original-paint', 'chelsea-deep-black', 'monte-carlo-blue', 'verde-mantis',
     'kahn-mondial-20', 'kahn-monza-22',
     'keep-original-interior', 'chelsea-quilted-leather',
     'hood-vents', 'roof-rails', 'bumper-kit'
   );

UPDATE catalog_option_groups
   SET active = false
 WHERE builder_id = '20000000-0000-0000-0000-000000000004'
   AND slug IN ('exterior-colour', 'wheels', 'interior', 'exterior-details');
