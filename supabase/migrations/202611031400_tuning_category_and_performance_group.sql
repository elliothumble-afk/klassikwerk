-- Phase 6 polish: Tuning category + Performance option group.
--
-- Chelsea files engine remaps ("Tuning System - D250 MHEV 4x4", etc.)
-- under the "Interior" collection on their website, but these are
-- performance parts, not interior trim. We add a dedicated Tuning
-- category (lookbook_section=Underneath, 2h install, UK origin, 2.5%
-- duty, $80 freight) and a Performance builder-wide option group so
-- the sync can lift tuning products out of Interior at ingest time.
--
-- The category is matched by Shopify tag 'tuning-system' OR the
-- product title containing "Tuning System". That logic lives in the
-- sync; this migration only ensures the destination rows exist.

insert into catalog_categories (
  builder_id, name, install_hours, paint_hours, paint_materials_cents,
  freight_cents, hts_duty_pct, default_origin_id, shopify_tags, sort,
  lookbook_section, lookbook_sort
)
values (
  '20000000-0000-0000-0000-000000000004',
  'Tuning',
  2, 0, 0,
  8000,              -- $80 freight
  2.5,               -- 2.5% duty
  '5dc56f67-76ec-4da6-b0a2-4ff837b14a26',  -- United Kingdom
  array['tuning-system'],
  310,
  'Underneath',
  10
)
on conflict do nothing;

insert into catalog_option_groups (
  builder_id, slug, name, selection, required, platform_id, sort,
  active, synced, external_id, allow_quantity
)
values (
  '20000000-0000-0000-0000-000000000004',
  'shopify-performance',
  'Performance',
  'multi',
  false,
  null,
  40,                -- after alloy wheels (30)
  true,
  true,
  'shopify:group:performance',
  false
)
on conflict (builder_id, external_id) do nothing;
