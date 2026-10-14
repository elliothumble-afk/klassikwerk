-- Make the media bucket public so swatch/hero URLs served via
-- /storage/v1/object/public/... resolve. RLS on individual objects
-- is unaffected (storage.objects still enforces its policies for
-- non-public requests), but public URLs for swatches now work from
-- the browser without a signed token.
UPDATE storage.buckets SET public = true WHERE id = 'media';
