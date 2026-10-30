-- Server-side guard: a quote_options row's option must either be
-- universal (no catalog_option_platforms rows) or linked to the
-- quote's platform. Belt-and-braces alongside the editor's platform
-- switch sanitation.

CREATE OR REPLACE FUNCTION quote_options_platform_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform_id uuid;
  v_restricted  int;
  v_matches     int;
  v_option_name text;
BEGIN
  SELECT platform_id INTO v_platform_id FROM quotes WHERE id = NEW.quote_id;
  IF v_platform_id IS NULL THEN
    RAISE EXCEPTION 'quote % has no platform_id', NEW.quote_id;
  END IF;

  SELECT COUNT(*) INTO v_restricted
    FROM catalog_option_platforms
   WHERE option_id = NEW.option_id;

  IF v_restricted = 0 THEN
    RETURN NEW;  -- universal option
  END IF;

  SELECT COUNT(*) INTO v_matches
    FROM catalog_option_platforms
   WHERE option_id = NEW.option_id AND platform_id = v_platform_id;

  IF v_matches = 0 THEN
    SELECT name INTO v_option_name FROM catalog_options WHERE id = NEW.option_id;
    RAISE EXCEPTION
      'option % (%) is not linked to this quote''s platform (%)',
      COALESCE(v_option_name, '?'), NEW.option_id, v_platform_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quote_options_platform_guard_trg ON quote_options;
CREATE TRIGGER quote_options_platform_guard_trg
  BEFORE INSERT OR UPDATE ON quote_options
  FOR EACH ROW EXECUTE FUNCTION quote_options_platform_guard();
