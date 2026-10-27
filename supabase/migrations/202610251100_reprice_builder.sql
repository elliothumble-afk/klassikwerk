-- reprice_builder(target_builder uuid)
--
-- Recomputes price_cents / parts_sell_cents / install_price_cents /
-- landed_cost_cents for every option of a cost_based builder. Called
-- at the end of every sync and whenever Terms, a Category or an
-- Origin changes.
--
-- Formula (per option, in cents, rounded):
--   retail_usd   = web_price × fx_rate
--   kit_cost_usd = retail_usd × (1 − trade_discount)
--   freight      = category.freight
--   duty         = kit_cost_usd × category.hts_duty_pct
--   tariff       = kit_cost_usd × origin.tariff_pct
--   s232         = category is Alloy wheels ? kit_cost_usd × aluminium_share × origin.s232_pct : 0
--   fees         = kit_cost_usd × mpf_pct + brokerage / items_per_shipment
--   parts_sell   = retail_usd + freight + duty + tariff + s232 + fees
--   landed       = kit_cost_usd + freight + duty + tariff + s232 + fees
--   install      = install_hours × labour_rate + paint_hours × paint_rate + paint_materials
--   price_cents  = parts_sell + install
--
-- Origin resolution: option override, else category default.

CREATE OR REPLACE FUNCTION reprice_builder(target_builder uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fx                 numeric;
  v_discount           numeric;
  v_labour_rate        numeric;
  v_paint_rate         numeric;
  v_mpf                numeric;
  v_brokerage          numeric;
  v_items              numeric;
  v_aluminium          numeric;
  v_mode               text;
  updated              int := 0;
BEGIN
  SELECT fx_rate, trade_discount_pct,
         labour_rate_cents::numeric / 100.0,
         paint_rate_cents::numeric / 100.0,
         mpf_pct,
         brokerage_cents::numeric / 100.0,
         items_per_shipment,
         aluminium_share_pct,
         pricing_mode::text
    INTO v_fx, v_discount, v_labour_rate, v_paint_rate,
         v_mpf, v_brokerage, v_items, v_aluminium, v_mode
    FROM builder_terms
   WHERE builder_id = target_builder;

  IF NOT FOUND OR v_mode <> 'cost_based' THEN
    RETURN 0;
  END IF;

  WITH priced AS (
    SELECT
      o.id,
      -- Everything below is in dollars (numeric). Final round to cents.
      ((o.web_price_cents::numeric / 100.0) * v_fx)                              AS retail_usd,
      ((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount)           AS kit_cost_usd,
      c.freight_cents::numeric / 100.0                                           AS freight_usd,
      (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount))
        * c.hts_duty_pct                                                          AS duty_usd,
      (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount))
        * COALESCE(opt_orig.tariff_pct, cat_orig.tariff_pct, 0)                   AS tariff_usd,
      CASE WHEN c.name = 'Alloy wheels'
           THEN (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount))
                * v_aluminium
                * COALESCE(opt_orig.s232_aluminium_pct, cat_orig.s232_aluminium_pct, 0)
           ELSE 0 END                                                             AS s232_usd,
      (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount)) * v_mpf
        + v_brokerage / NULLIF(v_items, 0)                                        AS fees_usd,
      c.install_hours * v_labour_rate
        + c.paint_hours * v_paint_rate                                            AS labour_usd,
      c.paint_materials_cents::numeric / 100.0                                    AS materials_usd
    FROM catalog_options o
    JOIN catalog_categories c ON c.id = o.category_id
    LEFT JOIN origins opt_orig ON opt_orig.id = o.origin_id
    LEFT JOIN origins cat_orig ON cat_orig.id = c.default_origin_id
    WHERE o.builder_id = target_builder
      AND o.web_price_cents IS NOT NULL
      AND o.category_id IS NOT NULL
  )
  UPDATE catalog_options o
     SET parts_sell_cents    = ROUND( (p.retail_usd  + p.freight_usd + p.duty_usd + p.tariff_usd + p.s232_usd + p.fees_usd) * 100 )::int,
         landed_cost_cents   = ROUND( (p.kit_cost_usd + p.freight_usd + p.duty_usd + p.tariff_usd + p.s232_usd + p.fees_usd) * 100 )::int,
         install_price_cents = ROUND( (p.labour_usd + p.materials_usd) * 100 )::int,
         price_cents         = ROUND(
                                 ( p.retail_usd + p.freight_usd + p.duty_usd + p.tariff_usd + p.s232_usd + p.fees_usd
                                 + p.labour_usd + p.materials_usd
                                 ) * 100
                               )::int
    FROM priced p
   WHERE o.id = p.id;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION reprice_builder(uuid) FROM public;
GRANT EXECUTE ON FUNCTION reprice_builder(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION reprice_builder(uuid) TO authenticated;
