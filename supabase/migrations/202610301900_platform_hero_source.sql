-- Phase 6 polish: track whether a catalog_platforms.hero_image_url
-- came from the Shopify sync or was pinned by an ops user. The sync
-- is only allowed to overwrite rows it previously wrote; a manually
-- set hero stays sticky even on re-sync.

ALTER TABLE catalog_platforms
  ADD COLUMN hero_source text
    CHECK (hero_source IS NULL OR hero_source IN ('sync','manual'));

-- Any existing hero was set by an operator (sync hasn't written one
-- yet), so mark it manual so the first run of the new sync code
-- doesn't blow it away.
UPDATE catalog_platforms
   SET hero_source = 'manual'
 WHERE hero_image_url IS NOT NULL;
