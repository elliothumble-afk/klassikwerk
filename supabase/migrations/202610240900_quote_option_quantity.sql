-- Wheels and other set-of-N options can be sold as "Set of 4" or
-- "Set of 5 incl. spare". The quantity lives on the quote line; the
-- group decides whether the quote editor exposes the chooser.

ALTER TABLE quote_options
  ADD COLUMN quantity int NOT NULL DEFAULT 1
  CHECK (quantity >= 1);

-- build_options is the contract-side snapshot of what the customer
-- committed to. It needs qty too, or the contract loses the Set-of-5
-- distinction after the quote is converted.
ALTER TABLE build_options
  ADD COLUMN quantity int NOT NULL DEFAULT 1
  CHECK (quantity >= 1);

ALTER TABLE catalog_option_groups
  ADD COLUMN allow_quantity boolean NOT NULL DEFAULT false;

-- The Shopify sync writes allow_quantity=true for the alloy-wheels
-- group on every run. We flip the existing synced row now so the
-- migration leaves the DB in the right state without needing an
-- immediate re-sync.
UPDATE catalog_option_groups
   SET allow_quantity = true
 WHERE synced = true
   AND external_id = 'shopify:group:alloy-wheels';
