-- Phase 6 polish: tighten the finish-image match rules.
--
-- Previously the sync fanned a pattern-only Shopify title (e.g.
-- "Land Rover Defender 110 Designo Pattern Leather Interior") across
-- every catalog colour on the assumption it illustrated each — that
-- showed the wrong-colour interior whenever a quote picked a colour
-- the Shopify photograph wasn't actually in.
--
-- New rule: a pattern-only Shopify match stores a row with
-- finish_id = NULL and the Shopify colour name (if present in the
-- title) in source_colour_label, so the renderer can caption
-- "Shown in {label} — yours in {chosen colour}" when the chosen
-- colour doesn't match.

ALTER TABLE catalog_finish_images
  ALTER COLUMN finish_id DROP NOT NULL,
  ADD COLUMN source_colour_label text;

-- Replace the colour+pattern unique index with one that treats NULL
-- finish_id (pattern-only rows) as distinct from colour-bearing rows.
DROP INDEX IF EXISTS catalog_finish_images_full_idx;
DROP INDEX IF EXISTS catalog_finish_images_colour_pattern_idx;
DROP INDEX IF EXISTS catalog_finish_images_pattern_only_idx;

CREATE UNIQUE INDEX catalog_finish_images_full_idx
  ON catalog_finish_images (finish_id, pattern_finish_id, platform_id)
  WHERE finish_id IS NOT NULL AND pattern_finish_id IS NOT NULL AND platform_id IS NOT NULL;

CREATE UNIQUE INDEX catalog_finish_images_cp_idx
  ON catalog_finish_images (finish_id, pattern_finish_id)
  WHERE finish_id IS NOT NULL AND pattern_finish_id IS NOT NULL AND platform_id IS NULL;

CREATE UNIQUE INDEX catalog_finish_images_pattern_platform_idx
  ON catalog_finish_images (pattern_finish_id, platform_id)
  WHERE finish_id IS NULL AND pattern_finish_id IS NOT NULL AND platform_id IS NOT NULL;

CREATE UNIQUE INDEX catalog_finish_images_pattern_only_idx
  ON catalog_finish_images (pattern_finish_id)
  WHERE finish_id IS NULL AND pattern_finish_id IS NOT NULL AND platform_id IS NULL;
