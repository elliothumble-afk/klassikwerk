-- Phase 6 polish: hero image per (finish, pattern, platform) combo
-- so the Lookbook's interior option page can show the right leather
-- + pattern on the right vehicle. The Shopify seed populates most of
-- it; ops can upload overrides on Costing → Finishes.

CREATE TABLE catalog_finish_images (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id         uuid NOT NULL REFERENCES builders(id) ON DELETE CASCADE,
  finish_set_id      uuid NOT NULL REFERENCES catalog_finish_sets(id) ON DELETE CASCADE,
  finish_id          uuid NOT NULL REFERENCES catalog_finishes(id)    ON DELETE CASCADE,
  pattern_finish_id  uuid REFERENCES catalog_finishes(id) ON DELETE CASCADE,
  platform_id        uuid REFERENCES catalog_platforms(id) ON DELETE CASCADE,
  image_url          text NOT NULL,
  source             text NOT NULL CHECK (source IN ('shopify','manual')) DEFAULT 'manual',
  sort               int  NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One image per (finish, pattern?, platform?) combo. Postgres treats
-- NULLs as distinct in UNIQUE, so partial indexes handle the three
-- shapes we actually query (platform+colour+pattern → colour+pattern →
-- pattern-only).
CREATE UNIQUE INDEX catalog_finish_images_full_idx
  ON catalog_finish_images (finish_id, pattern_finish_id, platform_id)
  WHERE pattern_finish_id IS NOT NULL AND platform_id IS NOT NULL;

CREATE UNIQUE INDEX catalog_finish_images_colour_pattern_idx
  ON catalog_finish_images (finish_id, pattern_finish_id)
  WHERE pattern_finish_id IS NOT NULL AND platform_id IS NULL;

CREATE UNIQUE INDEX catalog_finish_images_pattern_only_idx
  ON catalog_finish_images (pattern_finish_id)
  WHERE finish_id IS NULL IS FALSE AND pattern_finish_id IS NOT NULL AND platform_id IS NULL;

CREATE INDEX catalog_finish_images_builder_idx ON catalog_finish_images (builder_id);
CREATE INDEX catalog_finish_images_finish_idx ON catalog_finish_images (finish_id);

ALTER TABLE catalog_finish_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_finish_images_ops_read ON catalog_finish_images
  FOR SELECT USING (auth_is_operator());

CREATE POLICY catalog_finish_images_ops_write ON catalog_finish_images
  FOR ALL
  USING (auth_can_write_builder(builder_id))
  WITH CHECK (auth_can_write_builder(builder_id));
