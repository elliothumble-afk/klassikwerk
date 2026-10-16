-- ============================================================
-- Phase 4 — Synced builders (ECD Connect)
--
-- A builder's catalog + brand + terms + contract can come from an
-- external feed. Everything previously synced but absent from a
-- subsequent feed is deactivated, never deleted.
-- ============================================================

ALTER TABLE builders
  ADD COLUMN catalog_source text NOT NULL DEFAULT 'manual'
    CHECK (catalog_source IN ('manual', 'connect')),
  ADD COLUMN catalog_source_url text,
  ADD COLUMN catalog_source_token text,  -- stored server-side; see README
  ADD COLUMN lead_intake_url text,
  ADD COLUMN last_synced_at timestamptz,
  ADD COLUMN last_sync_status text CHECK (last_sync_status IN ('success', 'error')),
  ADD COLUMN last_sync_error text;

-- ------------------------------------------------------------
-- synced + external_id columns on every table the sync owns.
-- ------------------------------------------------------------
ALTER TABLE catalog_platforms         ADD COLUMN synced boolean NOT NULL DEFAULT false, ADD COLUMN external_id text;
ALTER TABLE catalog_tiers             ADD COLUMN synced boolean NOT NULL DEFAULT false, ADD COLUMN external_id text;
ALTER TABLE catalog_option_groups     ADD COLUMN synced boolean NOT NULL DEFAULT false, ADD COLUMN external_id text;
ALTER TABLE catalog_options           ADD COLUMN synced boolean NOT NULL DEFAULT false, ADD COLUMN external_id text;
ALTER TABLE catalog_option_platforms  ADD COLUMN synced boolean NOT NULL DEFAULT false, ADD COLUMN external_id text;
ALTER TABLE catalog_platform_gallery  ADD COLUMN synced boolean NOT NULL DEFAULT false, ADD COLUMN external_id text;
ALTER TABLE builder_brand             ADD COLUMN synced boolean NOT NULL DEFAULT false, ADD COLUMN external_id text;
ALTER TABLE builder_terms             ADD COLUMN synced boolean NOT NULL DEFAULT false, ADD COLUMN external_id text;
ALTER TABLE contract_templates        ADD COLUMN synced boolean NOT NULL DEFAULT false, ADD COLUMN external_id text;

-- Unique (builder_id, external_id) where external_id is present
CREATE UNIQUE INDEX catalog_platforms_builder_external_idx
  ON catalog_platforms (builder_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX catalog_tiers_builder_external_idx
  ON catalog_tiers (builder_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX catalog_option_groups_builder_external_idx
  ON catalog_option_groups (builder_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX catalog_options_builder_external_idx
  ON catalog_options (builder_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX catalog_platform_gallery_builder_external_idx
  ON catalog_platform_gallery (builder_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX contract_templates_builder_external_idx
  ON contract_templates (builder_id, external_id) WHERE external_id IS NOT NULL;

-- ------------------------------------------------------------
-- sync_runs: observability of each sync invocation
-- ------------------------------------------------------------
CREATE TABLE sync_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id   uuid REFERENCES builders(id) ON DELETE CASCADE NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL CHECK (status IN ('running', 'success', 'error')),
  counts       jsonb NOT NULL DEFAULT '{}'::jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_runs_builder_idx ON sync_runs (builder_id, started_at DESC);
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_runs_scope_read"
  ON sync_runs FOR SELECT USING (auth_can_write_builder(builder_id));

-- ------------------------------------------------------------
-- builder_push_log: outbound-to-builder (quote hand-off, etc.)
-- ------------------------------------------------------------
CREATE TABLE builder_push_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id  uuid REFERENCES builders(id) ON DELETE CASCADE NOT NULL,
  quote_id    uuid REFERENCES quotes(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  response    jsonb,
  status      text NOT NULL CHECK (status IN ('success', 'error', 'pending')),
  error       text,
  http_status int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX builder_push_log_builder_idx ON builder_push_log (builder_id, created_at DESC);
CREATE INDEX builder_push_log_quote_idx ON builder_push_log (quote_id, created_at DESC);
ALTER TABLE builder_push_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "builder_push_log_scope_read"
  ON builder_push_log FOR SELECT USING (auth_can_write_builder(builder_id));

-- ------------------------------------------------------------
-- Seed: ECD Auto Design (inactive until first sync)
-- ------------------------------------------------------------
INSERT INTO builders (
  id, operator_id, slug, name, legal_name, active, sort, catalog_source
) VALUES (
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'ecd',
  'ECD Auto Design',
  'ECD Automotive Design LLC',
  false,
  3,
  'connect'
)
ON CONFLICT (operator_id, slug) DO NOTHING;
