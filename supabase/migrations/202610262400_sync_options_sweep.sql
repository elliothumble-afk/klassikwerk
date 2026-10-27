-- End-of-sync sweep for synced catalog_options.
--
-- Call this once per sync run after the upsert / platform-link
-- rebuild finish. It:
--   1. Deactivates synced rows that weren't touched this run and
--      increments their missed_sync_runs counter.
--   2. Deletes synced rows that have been missing from the feed for
--      two consecutive runs AND were never referenced by a quote.
--   3. Returns both counts so the sync report can surface them.
--
-- Synced rows present in the current run have missed_sync_runs reset
-- to 0 by the upsert payload — this function only touches the ones
-- the upsert didn't visit.

CREATE OR REPLACE FUNCTION sync_options_sweep(
  target_builder uuid,
  started_at timestamptz
)
RETURNS TABLE(deactivated int, deleted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deactivated int;
  v_deleted     int;
BEGIN
  WITH stale AS (
    UPDATE catalog_options
       SET active = false,
           missed_sync_runs = missed_sync_runs + 1
     WHERE builder_id = target_builder
       AND synced = true
       AND updated_at < started_at
     RETURNING id
  )
  SELECT COUNT(*) INTO v_deactivated FROM stale;

  WITH gone AS (
    DELETE FROM catalog_options o
     WHERE o.builder_id = target_builder
       AND o.synced = true
       AND o.active = false
       AND o.missed_sync_runs >= 2
       AND NOT EXISTS (SELECT 1 FROM quote_options qo WHERE qo.option_id = o.id)
     RETURNING o.id
  )
  SELECT COUNT(*) INTO v_deleted FROM gone;

  RETURN QUERY SELECT v_deactivated, v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION sync_options_sweep(uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION sync_options_sweep(uuid, timestamptz) TO service_role;
