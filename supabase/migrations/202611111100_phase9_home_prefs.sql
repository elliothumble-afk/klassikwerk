-- Phase 9 §2 — per-user visibility toggles for the Home page sections.
--
-- Simple jsonb blob on the profile so we can add more Home widgets
-- later without another migration. Shape today:
--   {
--     "my_work":     true,
--     "pipeline":    true,
--     "commissions": true,
--     "activity":    true
--   }
-- Missing keys default to true in the UI.

alter table profiles
  add column if not exists home_prefs jsonb not null default '{}'::jsonb;
