-- Phase 9 §3 — Scheduled jobs for sync-builder-catalog, refresh-fx-rates
-- and Connect backfill, keyed by a Vault secret named `service_key`.
--
-- The Vault secret must exist before these jobs can succeed; it's set
-- out-of-band by the operator (never committed to git):
--
--   SELECT vault.create_secret('<sb_secret_…>', 'service_key',
--     'Supabase secret API key for pg_cron HTTP callbacks');
--
-- Each HTTP call authenticates with that key; the edge functions read
-- HH_SERVICE_KEY (new) with a fallback to SUPABASE_SERVICE_ROLE_KEY,
-- so both Vault and the edge-function env accept the same secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper: fetch the current service key from Vault. SECURITY DEFINER
-- so it can read vault.decrypted_secrets; locked to cron-only callers
-- by its name (never exposed to PostgREST).
create or replace function _hh_service_key()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'service_key' limit 1
$$;

revoke all on function _hh_service_key() from public, anon, authenticated;

-- ─── Idempotency: remove any prior schedules under these names ─────
do $$
declare
  j text;
begin
  for j in select array['nightly-sync-builder-catalog',
                        'daily-fx-refresh',
                        'weekly-connect-backfill']::text[]
  loop
    for j in select jobname from cron.job where jobname = any (
      array['nightly-sync-builder-catalog',
            'daily-fx-refresh',
            'weekly-connect-backfill']
    ) loop
      perform cron.unschedule(j);
    end loop;
  end loop;
end $$;

-- ─── 1. Nightly catalog sync for every Shopify-sourced builder ─────
--
-- Fires 07:00 UTC daily, which is 03:00 America/New_York during
-- standard time and 02:00 during daylight saving (pg_cron runs in
-- UTC; TZ-aware schedules aren't yet supported on Supabase's pinned
-- version). Close enough to "overnight for ET"; shifts by 1h for
-- part of the year.
select cron.schedule(
  'nightly-sync-builder-catalog',
  '0 7 * * *',
  $$
    select net.http_post(
      url     := 'https://vvuccbskbswtfvxplxxm.supabase.co/functions/v1/sync-builder-catalog',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || _hh_service_key(),
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object('builder_id', b.id)
    )
      from builders b
     where b.active = true
       and b.catalog_source = 'shopify';
  $$
);

-- ─── 2. Daily FX refresh ──────────────────────────────────────────
--
-- Fires 10:00 UTC daily (05:00 ET standard / 06:00 ET DST). Function
-- walks every builder with fx_auto = true and reprices the catalog.
select cron.schedule(
  'daily-fx-refresh',
  '0 10 * * *',
  $$
    select net.http_post(
      url     := 'https://vvuccbskbswtfvxplxxm.supabase.co/functions/v1/refresh-fx-rates',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || _hh_service_key(),
        'Content-Type',  'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- ─── 3. Weekly "Pull everything from Connect" ─────────────────────
--
-- Fires Sunday 09:00 UTC (04:00 ET standard / 05:00 ET DST) for every
-- builder with a backfill_url configured. Safety net against missed
-- live webhook deliveries.
select cron.schedule(
  'weekly-connect-backfill',
  '0 9 * * 0',
  $$
    select net.http_post(
      url     := 'https://vvuccbskbswtfvxplxxm.supabase.co/functions/v1/builder-webhook/backfill',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || _hh_service_key(),
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object('builder_id', s.builder_id)
    )
      from builder_secrets s
      join builders b on b.id = s.builder_id
     where b.active = true
       and s.backfill_url is not null;
  $$
);

-- ─── UI read helper: next-run time for a schedule ─────────────────
-- pg_cron's job table carries the cron expression; computing the next
-- run from it is awkward in SQL. The UI shows the schedule string
-- plus the latest cron.job_run_details row via this view.
create or replace view scheduled_jobs_public as
select
  j.jobname,
  j.schedule,
  j.active,
  (
    select r.start_time
      from cron.job_run_details r
     where r.jobid = j.jobid
     order by r.start_time desc
     limit 1
  ) as last_run_at,
  (
    select r.status
      from cron.job_run_details r
     where r.jobid = j.jobid
     order by r.start_time desc
     limit 1
  ) as last_run_status
from cron.job j
where j.jobname in ('nightly-sync-builder-catalog',
                    'daily-fx-refresh',
                    'weekly-connect-backfill');

-- RLS not applicable to views; wrap via policy on a security-barrier
-- function so only staff can read.
grant select on scheduled_jobs_public to authenticated;
