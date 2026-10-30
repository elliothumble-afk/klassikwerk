-- Phase 6 — Lookbook quote PDF.
--
-- Schema additions for the new 16:9 landscape quote PDF rendered for
-- cost_based builders:
--   * catalog_options: description (plain text) + lead_image_url.
--   * catalog_option_images: all product images from the Shopify sync.
--   * catalog_categories: lookbook_section + lookbook_sort to group
--     options into "The Face", "The Silhouette", etc.
--   * catalog_platforms: lookbook_copy — one sentence for the
--     "The Foundation" page.
--   * quotes: theme_words + vehicle_colour (the customer's existing
--     vehicle colour; we don't repaint the car).
--   * leads: vehicle_colour so the colour follows the customer.
--   * builder_brand: lookbook_statement — the one-line marque strap
--     on the Statement page.
--   * profiles: title (job title) for the Closing page sign-off.
--     profiles.phone already exists.
-- Then seeds CTC: section mapping for all 31 categories, platform
-- lookbook copy for every active platform, brand statement.

ALTER TABLE catalog_options
  ADD COLUMN description     text,
  ADD COLUMN lead_image_url  text;

CREATE TABLE catalog_option_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_id  uuid NOT NULL REFERENCES catalog_options(id) ON DELETE CASCADE,
  url        text NOT NULL,
  sort       int  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (option_id, url)
);
CREATE INDEX catalog_option_images_option_idx ON catalog_option_images (option_id);
ALTER TABLE catalog_option_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_option_images_ops_read ON catalog_option_images FOR SELECT USING (auth_is_operator());
CREATE POLICY catalog_option_images_ops_write ON catalog_option_images FOR ALL
  USING (EXISTS (
    SELECT 1 FROM catalog_options o
     WHERE o.id = catalog_option_images.option_id
       AND auth_can_write_builder(o.builder_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM catalog_options o
     WHERE o.id = catalog_option_images.option_id
       AND auth_can_write_builder(o.builder_id)
  ));

ALTER TABLE catalog_categories
  ADD COLUMN lookbook_section text,
  ADD COLUMN lookbook_sort    int NOT NULL DEFAULT 0;

ALTER TABLE catalog_platforms
  ADD COLUMN lookbook_copy text;

ALTER TABLE quotes
  ADD COLUMN theme_words    text,
  ADD COLUMN vehicle_colour text;

ALTER TABLE leads
  ADD COLUMN vehicle_colour text;

ALTER TABLE builder_brand
  ADD COLUMN lookbook_statement text;

ALTER TABLE profiles
  ADD COLUMN title text;

-- ─── CTC seed ───────────────────────────────────────────────────────
DO $$
DECLARE
  ctc_id uuid := '20000000-0000-0000-0000-000000000004';
BEGIN
  -- Category → lookbook section. Sort order:
  --   10 The Face  · 20 The Silhouette  · 30 Carbon Accents
  --   40 The Finishing Touch · 50 Underneath · 60 Inside · 70 Wheels
  UPDATE catalog_categories SET lookbook_section = 'The Face',           lookbook_sort = 10 WHERE builder_id = ctc_id AND name IN ('Body kit','Front bumper','Grille','Bonnet');
  UPDATE catalog_categories SET lookbook_section = 'The Silhouette',     lookbook_sort = 20 WHERE builder_id = ctc_id AND name IN ('Wheel arches','Roof spoiler','Roof light bar','Roof rack');
  UPDATE catalog_categories SET lookbook_section = 'Carbon Accents',     lookbook_sort = 30 WHERE builder_id = ctc_id AND name IN ('Bonnet vents','Side vents','Storage box','Door mask');
  UPDATE catalog_categories SET lookbook_section = 'The Finishing Touch',lookbook_sort = 40 WHERE builder_id = ctc_id AND name IN ('Spare wheel cover','Decals','Fuel cap','Side steps','Side ladder');
  UPDATE catalog_categories SET lookbook_section = 'Underneath',         lookbook_sort = 50 WHERE builder_id = ctc_id AND name IN ('Exhaust','Suspension');
  UPDATE catalog_categories SET lookbook_section = 'Inside',             lookbook_sort = 60 WHERE builder_id = ctc_id AND name IN ('Leather interior','Steering wheel','Floor mats','Floor carpet','Interior trim kit','Interior hardware','Pedals','Gear shift trim');
  UPDATE catalog_categories SET lookbook_section = 'Wheels',             lookbook_sort = 70 WHERE builder_id = ctc_id AND name IN ('Alloy wheels','Tyres');
  -- Everything else (Lighting, Roof conversion, Roof rack, Other) stays NULL;
  -- the renderer gathers unsectioned options under a trailing "Other"
  -- section only when the quote actually selects one.

  -- Platform lookbook copy. Short, confident, one paragraph each.
  UPDATE catalog_platforms SET lookbook_copy =
    'A 3.0-litre twin-turbo straight-six wrapped in a body-on-frame platform purpose-built for the trail. The Grenadier is already uncompromised; a Chelsea Truck Company build makes it unmistakably yours.'
   WHERE builder_id = ctc_id AND slug = 'ineos-grenadier-2023-onwards';

  UPDATE catalog_platforms SET lookbook_copy =
    'Short-wheelbase, open-top, and still the most iconic Jeep ever made. A Chelsea build keeps the character intact and adds a presence that is impossible to miss.'
   WHERE builder_id = ctc_id AND slug = 'jeep-wrangler-jl-2-door-2018-onwards';

  UPDATE catalog_platforms SET lookbook_copy =
    'The four-door Wrangler earns its daily keep. We tune the stance, sharpen the surfaces, and layer in carbon and bronze so the family rig looks every bit as considered as it drives.'
   WHERE builder_id = ctc_id AND slug = 'jeep-wrangler-jl-4-door-2018-onwards';

  UPDATE catalog_platforms SET lookbook_copy =
    'The original Defender in its most sought-after wheelbase. We preserve the agricultural honesty and layer refinement where it matters — paint, trim, interior — for a truck that still feels like itself.'
   WHERE builder_id = ctc_id AND slug = 'land-rover-defender-110-1991-2016';

  UPDATE catalog_platforms SET lookbook_copy =
    'The current Defender 110 is the ideal canvas for a Chelsea Truck Company build: capable, composed, and ready to be made entirely your own.'
   WHERE builder_id = ctc_id AND slug = 'land-rover-defender-110-2020-onwards';

  UPDATE catalog_platforms SET lookbook_copy =
    'A full-length Defender with room for everything a build like this asks for. We lean into the length — sharper lines, longer shoulders, carbon detailing that reads as intentional at every angle.'
   WHERE builder_id = ctc_id AND slug = 'land-rover-defender-130-2020-onwards';

  UPDATE catalog_platforms SET lookbook_copy =
    'The short Defender in its first body — compact, honest, and endlessly characterful. Chelsea builds it with restraint: paint, carbon, and the right wheels.'
   WHERE builder_id = ctc_id AND slug = 'land-rover-defender-90-1991-2016';

  UPDATE catalog_platforms SET lookbook_copy =
    'A short-wheelbase Defender with the running gear and refinement of the 2020 platform. Compact, confident, and the right size for a build that reads as sculpted rather than oversized.'
   WHERE builder_id = ctc_id AND slug = 'land-rover-defender-90-2020-onwards';

  UPDATE catalog_platforms SET lookbook_copy =
    'The G-Wagon is already dress uniform; a Chelsea build is tailoring. The G350 and G400 take body-coloured accents, carbon trim and a wheel choice that completes the silhouette without shouting.'
   WHERE builder_id = ctc_id AND slug = 'mercedes-benz-g-wagon-g350-400-2018-onwards';

  UPDATE catalog_platforms SET lookbook_copy =
    'The G63 is the loudest G-Wagon on paper. We dress it to match: wider arches, deeper wheels, finish choices that make the AMG motor read as the surface promises.'
   WHERE builder_id = ctc_id AND slug = 'mercedes-benz-g-wagon-g63-2018-onwards';

  UPDATE catalog_platforms SET lookbook_copy =
    'The 250 is the Land Cruiser Toyota promised the enthusiasts for a decade. We let the body-on-frame honesty do the work and layer carbon, bronze and the right stance to finish the brief.'
   WHERE builder_id = ctc_id AND slug = 'toyota-land-cruiser-250-2024-onwards';

  UPDATE catalog_platforms SET lookbook_copy =
    'The reborn 70 Series, short-wheelbase. Chelsea builds it the way it should have left the factory: coherent, considered, and absolutely ready for the trail.'
   WHERE builder_id = ctc_id AND slug = 'toyota-land-cruiser-70-2-door-2023-onwards';

  UPDATE catalog_platforms SET lookbook_copy =
    'The four-door 70 Series brings workhorse proportions to a Chelsea build. We let the length carry the stance, with carbon detail and the right wheel choice to tie it together.'
   WHERE builder_id = ctc_id AND slug = 'toyota-land-cruiser-70-4-door-2023-onwards';

  -- Brand statement.
  UPDATE builder_brand
     SET lookbook_statement = 'Finished to order, built in Florida.'
   WHERE builder_id = ctc_id;
END $$;
