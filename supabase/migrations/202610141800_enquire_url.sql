-- Per-builder Enquire link target.
-- The /b/:slug landing shows a single "Enquire" button that goes here;
-- there is no public inquiry form.
ALTER TABLE builder_brand
  ADD COLUMN enquire_url text NOT NULL DEFAULT 'https://humblehouseauto.com';
