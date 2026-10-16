-- ============================================================
-- Phase 3 — Leads, quotes, Zoho sync
--
-- Introduces the lead → quote → contract pipeline. Quotes carry
-- versions; a build is only created when a quote is approved and a
-- contract has been triggered. Zoho CRM owns top-of-funnel (status
-- Warm triggers the inbound webhook); this system owns everything
-- from warm onward and pushes stage/status changes back.
-- ============================================================

-- ------------------------------------------------------------
-- Column additions on existing tables
-- ------------------------------------------------------------
ALTER TABLE customers       ADD COLUMN zoho_contact_id text;
ALTER TABLE builders        ADD COLUMN zoho_product_id text;
ALTER TABLE builder_terms   ADD COLUMN quote_validity_days int NOT NULL DEFAULT 30;
ALTER TABLE builder_terms   ADD COLUMN quote_intro_copy text;
ALTER TABLE builder_terms   ADD COLUMN brochure_url text;

-- ------------------------------------------------------------
-- leads
-- ------------------------------------------------------------
CREATE TYPE lead_stage AS ENUM (
  'inquiry', 'warm', 'quoting', 'quoted', 'revising',
  'contract_sent', 'won', 'lost'
);

CREATE TYPE lead_source AS ENUM (
  'zoho', 'site', 'design_centre', 'referral'
);

CREATE TABLE leads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id           uuid REFERENCES builders(id) ON DELETE RESTRICT NOT NULL,
  customer_id          uuid REFERENCES customers(id) ON DELETE SET NULL,
  zoho_lead_id         text UNIQUE,
  source               lead_source NOT NULL DEFAULT 'site',
  stage                lead_stage NOT NULL DEFAULT 'inquiry',
  owner_profile_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  platform_interest_id uuid REFERENCES catalog_platforms(id) ON DELETE SET NULL,
  notes                text,
  lost_reason          text,
  message              text,
  phone                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_builder_stage_idx ON leads (builder_id, stage);
CREATE INDEX leads_customer_idx ON leads (customer_id);
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- quotes
-- ------------------------------------------------------------
CREATE TYPE quote_status AS ENUM (
  'draft', 'sent', 'approved', 'superseded'
);

CREATE TABLE quotes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  builder_id    uuid REFERENCES builders(id) ON DELETE RESTRICT NOT NULL,
  version       int NOT NULL,
  platform_id   uuid REFERENCES catalog_platforms(id) ON DELETE RESTRICT NOT NULL,
  tier_id       uuid REFERENCES catalog_tiers(id) ON DELETE RESTRICT NOT NULL,
  price_cents   int NOT NULL DEFAULT 0,
  status        quote_status NOT NULL DEFAULT 'draft',
  pdf_url       text,
  sent_at       timestamptz,
  approved_at   timestamptz,
  notes         text,
  token         text UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, version)
);
CREATE INDEX quotes_lead_idx ON quotes (lead_id);
CREATE INDEX quotes_builder_status_idx ON quotes (builder_id, status);
CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- quote_options (snapshot of selected options at quote time)
-- ------------------------------------------------------------
CREATE TABLE quote_options (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id                  uuid REFERENCES quotes(id) ON DELETE CASCADE NOT NULL,
  option_id                 uuid REFERENCES catalog_options(id) ON DELETE RESTRICT NOT NULL,
  price_cents_at_selection  int NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quote_options_quote_idx ON quote_options (quote_id);

-- ------------------------------------------------------------
-- quote_events (audit trail)
-- ------------------------------------------------------------
CREATE TYPE quote_event_kind AS ENUM (
  'created', 'sent', 'viewed', 'revised', 'approved'
);

CREATE TABLE quote_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id       uuid REFERENCES quotes(id) ON DELETE CASCADE NOT NULL,
  kind           quote_event_kind NOT NULL,
  by_profile_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quote_events_quote_idx ON quote_events (quote_id);

-- ------------------------------------------------------------
-- builds: link to the approved quote
-- ------------------------------------------------------------
ALTER TABLE builds ADD COLUMN quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Zoho sync log + token cache
-- ------------------------------------------------------------
CREATE TABLE zoho_sync_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction   text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  object      text NOT NULL,
  object_id   text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL CHECK (status IN ('success', 'error', 'pending')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zoho_sync_log_created_idx ON zoho_sync_log (created_at DESC);

CREATE TABLE zoho_tokens (
  id            int PRIMARY KEY DEFAULT 1,
  access_token  text NOT NULL,
  expires_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_options  ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoho_sync_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoho_tokens    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_scope_read"
  ON leads FOR SELECT
  USING (auth_can_write_builder(builder_id));
CREATE POLICY "leads_scope_write"
  ON leads FOR ALL
  USING (auth_can_write_builder(builder_id))
  WITH CHECK (auth_can_write_builder(builder_id));

CREATE POLICY "quotes_scope_read"
  ON quotes FOR SELECT
  USING (auth_can_write_builder(builder_id));
CREATE POLICY "quotes_scope_write"
  ON quotes FOR ALL
  USING (auth_can_write_builder(builder_id))
  WITH CHECK (auth_can_write_builder(builder_id));

CREATE POLICY "quote_options_scope_read"
  ON quote_options FOR SELECT
  USING (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND auth_can_write_builder(q.builder_id)));
CREATE POLICY "quote_options_scope_write"
  ON quote_options FOR ALL
  USING (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND auth_can_write_builder(q.builder_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND auth_can_write_builder(q.builder_id)));

CREATE POLICY "quote_events_scope_read"
  ON quote_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND auth_can_write_builder(q.builder_id)));
CREATE POLICY "quote_events_scope_write"
  ON quote_events FOR ALL
  USING (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND auth_can_write_builder(q.builder_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND auth_can_write_builder(q.builder_id)));

CREATE POLICY "zoho_sync_log_operator_read"
  ON zoho_sync_log FOR SELECT
  USING (auth_is_operator());

CREATE POLICY "zoho_tokens_operator_read"
  ON zoho_tokens FOR SELECT
  USING (auth_is_operator());
