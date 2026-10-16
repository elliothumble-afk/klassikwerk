-- The partial unique indexes added in 202610161200 can't be targeted
-- by ON CONFLICT via supabase-js (which doesn't let us specify the
-- matching WHERE predicate), so Postgres raised
--
--   there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- Replace them with plain unique constraints. NULL external_id values
-- remain allowed because SQL treats each NULL as distinct, so
-- manually-added rows (synced=false, external_id=null) can still
-- coexist for the same builder.

DROP INDEX IF EXISTS catalog_platforms_builder_external_idx;
DROP INDEX IF EXISTS catalog_tiers_builder_external_idx;
DROP INDEX IF EXISTS catalog_option_groups_builder_external_idx;
DROP INDEX IF EXISTS catalog_options_builder_external_idx;
DROP INDEX IF EXISTS catalog_platform_gallery_builder_external_idx;
DROP INDEX IF EXISTS contract_templates_builder_external_idx;

ALTER TABLE catalog_platforms
  ADD CONSTRAINT catalog_platforms_builder_external_key
    UNIQUE (builder_id, external_id);

ALTER TABLE catalog_tiers
  ADD CONSTRAINT catalog_tiers_builder_external_key
    UNIQUE (builder_id, external_id);

ALTER TABLE catalog_option_groups
  ADD CONSTRAINT catalog_option_groups_builder_external_key
    UNIQUE (builder_id, external_id);

ALTER TABLE catalog_options
  ADD CONSTRAINT catalog_options_builder_external_key
    UNIQUE (builder_id, external_id);

ALTER TABLE catalog_platform_gallery
  ADD CONSTRAINT catalog_platform_gallery_builder_external_key
    UNIQUE (builder_id, external_id);

ALTER TABLE contract_templates
  ADD CONSTRAINT contract_templates_builder_external_key
    UNIQUE (builder_id, external_id);
