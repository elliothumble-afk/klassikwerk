-- SECURITY DEFINER helper so the edge function can clear every
-- catalog_option_platforms row owned by a builder's synced options in
-- a single round trip. Supabase-js chunked DELETEs were flaking
-- through Cloudflare for large (option_id IN (…)) URLs, leaving stale
-- link rows for options from superseded sync runs. This bypasses that
-- by running the delete server-side.

CREATE OR REPLACE FUNCTION clear_synced_option_platforms(target_builder uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed int;
BEGIN
  WITH deleted AS (
    DELETE FROM catalog_option_platforms cp
     USING catalog_options o
     WHERE o.id = cp.option_id
       AND o.builder_id = target_builder
       AND o.synced = true
     RETURNING cp.option_id
  )
  SELECT COUNT(*) INTO removed FROM deleted;
  RETURN removed;
END;
$$;

-- Only operators and ops-with-scope can call it. The sync edge
-- function uses the service role, which bypasses RLS, so this GRANT
-- is really just a belt-and-braces measure for ad-hoc human calls.
REVOKE ALL ON FUNCTION clear_synced_option_platforms(uuid) FROM public;
GRANT EXECUTE ON FUNCTION clear_synced_option_platforms(uuid) TO service_role;
