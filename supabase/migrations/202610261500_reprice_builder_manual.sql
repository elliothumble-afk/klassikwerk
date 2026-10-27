-- Update reprice_builder to handle manual (non-synced) options for
-- cost_based builders.
--
-- For synced rows the formula is unchanged: retail = web × fx, kit =
-- retail × (1 − discount), landing stacked on top.
--
-- For manual rows the ops user types a sell price into
-- manual_parts_sell_cents. No FX, discount, freight, duty, tariff,
-- Section 232 or fees apply; the entered amount IS parts_sell. We
-- still add the category's labour + materials for the final line
-- price. Landed cost is set equal to parts_sell so the margin panel
-- treats the parts as zero-margin (conservative) until a real cost
-- model is wired for manual rows.

CREATE OR REPLACE FUNCTION reprice_builder(target_builder uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fx          numeric;
  v_discount    numeric;
  v_labour_rate numeric;
  v_paint_rate  numeric;
  v_mpf         numeric;
  v_brokerage   numeric;
  v_items       numeric;
  v_aluminium   numeric;
  v_mode        text;
  updated       int := 0;
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
      o.synced,
      -- Parts sell + landed in dollars. For synced rows these come
      -- out of the landing-cost formula; for manual rows they're the
      -- ops-entered price.
      CASE
        WHEN o.synced AND o.web_price_cents IS NOT NULL
          THEN ((o.web_price_cents::numeric / 100.0) * v_fx)
             + (c.freight_cents::numeric / 100.0)
             + (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount)) * c.hts_duty_pct
             + (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount))
                 * COALESCE(opt_orig.tariff_pct, cat_orig.tariff_pct, 0)
             + CASE WHEN c.name = 'Alloy wheels'
                     THEN (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount))
                            * v_aluminium
                            * COALESCE(opt_orig.s232_aluminium_pct, cat_orig.s232_aluminium_pct, 0)
                     ELSE 0 END
             + (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount)) * v_mpf
             + v_brokerage / NULLIF(v_items, 0)
        ELSE
          COALESCE(o.manual_parts_sell_cents, 0)::numeric / 100.0
      END AS parts_sell_usd,
      -- Landed cost. Synced: kit_cost + landing. Manual: equal to
      -- parts_sell so margin reflects labour impact only.
      CASE
        WHEN o.synced AND o.web_price_cents IS NOT NULL
          THEN (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount))
             + (c.freight_cents::numeric / 100.0)
             + (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount)) * c.hts_duty_pct
             + (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount))
                 * COALESCE(opt_orig.tariff_pct, cat_orig.tariff_pct, 0)
             + CASE WHEN c.name = 'Alloy wheels'
                     THEN (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount))
                            * v_aluminium
                            * COALESCE(opt_orig.s232_aluminium_pct, cat_orig.s232_aluminium_pct, 0)
                     ELSE 0 END
             + (((o.web_price_cents::numeric / 100.0) * v_fx) * (1 - v_discount)) * v_mpf
             + v_brokerage / NULLIF(v_items, 0)
        ELSE
          COALESCE(o.manual_parts_sell_cents, 0)::numeric / 100.0
      END AS landed_usd,
      -- Install cost from the category (labour + materials in dollars).
      c.install_hours * v_labour_rate
        + c.paint_hours * v_paint_rate
        + c.paint_materials_cents::numeric / 100.0 AS install_usd
    FROM catalog_options o
    JOIN catalog_categories c ON c.id = o.category_id
    LEFT JOIN origins opt_orig ON opt_orig.id = o.origin_id
    LEFT JOIN origins cat_orig ON cat_orig.id = c.default_origin_id
    WHERE o.builder_id = target_builder
      AND o.category_id IS NOT NULL
      AND (o.synced = true OR o.manual_parts_sell_cents IS NOT NULL)
  )
  UPDATE catalog_options o
     SET parts_sell_cents    = ROUND(p.parts_sell_usd * 100)::int,
         landed_cost_cents   = ROUND(p.landed_usd * 100)::int,
         install_price_cents = ROUND(p.install_usd * 100)::int,
         price_cents         = ROUND((p.parts_sell_usd + p.install_usd) * 100)::int
    FROM priced p
   WHERE o.id = p.id;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;
