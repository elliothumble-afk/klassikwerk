-- Phase 6 polish: allow synced Shopify options that have a price but
-- no SKU to sync as active. Sync writes "shopify-<handle>" into
-- kit_sku as a placeholder and sets kit_sku_placeholder = true so
-- the catalog admin + PO payload can flag "No Kahn SKU — confirm on
-- order". A real Kahn SKU on a later resync overwrites the placeholder
-- and clears the flag.

ALTER TABLE catalog_options
  ADD COLUMN kit_sku_placeholder boolean NOT NULL DEFAULT false;
