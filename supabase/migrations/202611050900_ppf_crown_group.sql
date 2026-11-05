-- Paint Protection Film for CTC.
--
--   • CROWN Group supplier (USD, email blank — Elliot fills it).
--   • "Paint protection" category in lookbook section "Protection",
--     zero install/paint/materials/freight/duty (vendor supplies+fits).
--   • Builder-wide single-select "Protection" option group, sort 50.
--   • Manual option "Full-vehicle Paint Protection Film" —
--     parts_sell $15,000, cost $10,000, available on every CTC
--     platform.
--   • "PPF finish" set with Gloss / Matte (no overrides).
--
-- Manual (synced=false) → survives sync; sync-builder-catalog only
-- touches synced rows.

do $$
declare
  v_builder_id uuid := '20000000-0000-0000-0000-000000000004';
  v_supplier_id uuid;
  v_category_id uuid;
  v_group_id uuid;
  v_option_id uuid;
  v_finish_set_id uuid;
begin
  -- 1. Supplier.
  insert into suppliers (builder_id, name, currency, email, lead_time_days)
  values (v_builder_id, 'CROWN Group', 'USD', null, 14)
  on conflict (builder_id, name) do nothing;
  select id into v_supplier_id from suppliers
    where builder_id = v_builder_id and name = 'CROWN Group';

  -- 2. Category.
  insert into catalog_categories (
    builder_id, name, install_hours, paint_hours, paint_materials_cents,
    freight_cents, hts_duty_pct, default_origin_id, shopify_tags, sort,
    lookbook_section, lookbook_sort
  )
  values (
    v_builder_id, 'Paint protection', 0, 0, 0, 0, 0, null,
    array[]::text[], 320, 'Protection', 10
  )
  on conflict do nothing;
  select id into v_category_id from catalog_categories
    where builder_id = v_builder_id and name = 'Paint protection';

  -- 3. Option group — single-select, builder-wide, after Performance.
  insert into catalog_option_groups (
    builder_id, slug, name, selection, required, platform_id, sort,
    active, synced, allow_quantity
  )
  values (
    v_builder_id, 'protection', 'Protection', 'single', false, null,
    50, true, false, false
  )
  on conflict do nothing;
  select id into v_group_id from catalog_option_groups
    where builder_id = v_builder_id and slug = 'protection';

  -- 4. Finish set + Gloss / Matte.
  insert into catalog_finish_sets (builder_id, name, applies_to_category_ids, sort)
  values (v_builder_id, 'PPF finish', array[v_category_id], 40)
  on conflict do nothing;
  select id into v_finish_set_id from catalog_finish_sets
    where builder_id = v_builder_id and name = 'PPF finish';
  insert into catalog_finishes (finish_set_id, name, sort, active)
  values (v_finish_set_id, 'Gloss', 10, true), (v_finish_set_id, 'Matte', 20, true)
  on conflict do nothing;

  -- 5. Manual option.
  insert into catalog_options (
    builder_id, group_id, slug, name, code, price_cents, included_in_tier_ids,
    swatch_image_url, sort, active, sold_as_set, category_id, origin_id,
    web_price_cents, source_currency, category_locked, description_locked,
    origin_locked, kit_sku_placeholder, parts_sell_cents, install_price_cents,
    landed_cost_cents, manual_parts_sell_cents, cost_cents, description,
    lead_image_url, supplier_id, synced
  )
  values (
    v_builder_id, v_group_id, 'manual-ppf-full-vehicle',
    'Full-vehicle Paint Protection Film', 'PPF-FULL',
    1500000, array[]::uuid[], null, 10, true, false, v_category_id, null,
    null, 'USD', true, true, true, false,
    1500000, 0, 1000000, 1500000, 1000000,
    'Full-vehicle self-healing paint protection film, professionally applied by CROWN Group. Protects paint, carbon and finished bodywork from stone chips, swirl marks and UV.',
    null, v_supplier_id, false
  )
  on conflict (builder_id, slug) do update
    set name = excluded.name,
        parts_sell_cents = excluded.parts_sell_cents,
        cost_cents = excluded.cost_cents,
        landed_cost_cents = excluded.landed_cost_cents,
        description = excluded.description,
        supplier_id = excluded.supplier_id,
        category_id = excluded.category_id,
        group_id = excluded.group_id
  returning id into v_option_id;

  -- Available on every CTC platform.
  insert into catalog_option_platforms (option_id, platform_id)
  select v_option_id, p.id from catalog_platforms p
  where p.builder_id = v_builder_id
  on conflict do nothing;
end $$;
