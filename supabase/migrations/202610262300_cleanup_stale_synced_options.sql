-- Cleanup + policy for stale synced options.
--
-- The early Shopify sync runs left ~800 inactive synced catalog_
-- options rows behind on CTC: a tyre or wheel would move between
-- vehicle collections, generating a fresh row under a new external_id
-- while the old one went active=false. They have no platform links,
-- have never been quoted, and clutter every filter / drawer / count.
--
-- This migration:
--   1. Deletes any synced catalog_options row that is inactive, has
--      no catalog_option_platforms, and has no quote_options reference.
--      Safe by definition — nothing points at it.
--   2. Adds missed_sync_runs so the sync can enforce a "two strikes
--      and you're out" rule for synced options missing from the feed:
--      an option that goes inactive on one run gets missed_sync_runs=1;
--      stay missing on the next run and we delete it (unless some
--      quote has it on an active quote_options row).
--
-- Non-synced (manual) options are never touched by this policy.

DELETE FROM catalog_options o
 WHERE o.synced = true
   AND o.active = false
   AND NOT EXISTS (SELECT 1 FROM catalog_option_platforms cp WHERE cp.option_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM quote_options qo WHERE qo.option_id = o.id);

ALTER TABLE catalog_options
  ADD COLUMN missed_sync_runs int NOT NULL DEFAULT 0;
