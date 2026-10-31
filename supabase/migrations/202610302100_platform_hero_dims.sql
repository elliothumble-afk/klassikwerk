-- Phase 6 polish: cache the hero image's intrinsic width/height
-- alongside hero_image_url. The Lookbook renderer uses the stored
-- aspect ratio to decide between the banner (full-width top band)
-- and portrait (left half) layouts, which the browser Image check
-- was failing on under tight PDF-render timing.

ALTER TABLE catalog_platforms
  ADD COLUMN hero_image_width  int,
  ADD COLUMN hero_image_height int;
