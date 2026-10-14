-- ============================================================
-- Phase 2b: multi-builder platform
--
-- Introduces operators + builders. KlassikWerk becomes builder #1
-- under the Humble House operator. Every catalog table and `builds`
-- gains a builder_id. profiles.role gains 'operator'. ops users are
-- scoped via a profile_builders join table.
-- ============================================================

-- ------------------------------------------------------------
-- operators
-- ------------------------------------------------------------
CREATE TABLE operators (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  brand       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_operators_updated_at
  BEFORE UPDATE ON operators
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO operators (id, slug, name, brand) VALUES (
  '10000000-0000-0000-0000-000000000001',
  'humble-house',
  'Humble House',
  jsonb_build_object(
    'tagline', 'Bespoke restorations, white-labelled.',
    'color_accent', '#1C1C1A',
    'color_bg', '#FAF8F4',
    'color_text', '#1C1C1A'
  )
);

-- ------------------------------------------------------------
-- builders
-- ------------------------------------------------------------
CREATE TABLE builders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id        uuid REFERENCES operators(id) ON DELETE RESTRICT NOT NULL,
  slug               text NOT NULL,
  name               text NOT NULL,
  legal_name         text,
  active             boolean NOT NULL DEFAULT true,
  sort               int NOT NULL DEFAULT 0,
  stripe_account_id  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, slug)
);

CREATE TRIGGER trg_builders_updated_at
  BEFORE UPDATE ON builders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed KlassikWerk as builder #1 so backfills can reference its id
INSERT INTO builders (id, operator_id, slug, name, legal_name, active, sort) VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'klassikwerk',
  'KlassikWerk',
  'KlassikWerk LLC',
  true,
  1
);

-- Seed inactive demo builder for the live add-builder demo flow
INSERT INTO builders (id, operator_id, slug, name, legal_name, active, sort) VALUES (
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'demo-builder',
  'Your Builder',
  'Your Builder LLC',
  false,
  2
);

-- ------------------------------------------------------------
-- builder_brand
-- ------------------------------------------------------------
CREATE TABLE builder_brand (
  builder_id      uuid PRIMARY KEY REFERENCES builders(id) ON DELETE CASCADE,
  logo_url        text,
  wordmark_text   text,
  color_accent    text NOT NULL DEFAULT '#2E3B2B',
  color_bg        text NOT NULL DEFAULT '#FAF8F4',
  color_text      text NOT NULL DEFAULT '#1C1C1A',
  font_display    text NOT NULL DEFAULT 'Fraunces',
  font_body       text NOT NULL DEFAULT 'Inter',
  tagline         text,
  hero_copy       text,
  process_copy    jsonb NOT NULL DEFAULT '[]'::jsonb,
  custom_domain   text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_builder_brand_updated_at
  BEFORE UPDATE ON builder_brand
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- KlassikWerk brand mirrors the Phase-1 tokens
INSERT INTO builder_brand (
  builder_id, wordmark_text, color_accent, color_bg, color_text,
  font_display, font_body, tagline, hero_copy, process_copy
) VALUES (
  '20000000-0000-0000-0000-000000000001',
  'KlassikWerk',
  '#2E3B2B', '#FAF8F4', '#1C1C1A',
  'Fraunces', 'Inter',
  'Bespoke restorations of modern-classic Mercedes-Benz.',
  'Three platforms. Three tiers. A long waiting list, and a short conversation to get on it.',
  jsonb_build_array(
    jsonb_build_object('label', 'Configure',           'copy', 'Choose a platform, a tier, and the specification.'),
    jsonb_build_object('label', 'Reserve',             'copy', 'Hold your slot with a refundable deposit.'),
    jsonb_build_object('label', 'Intake',              'copy', 'Donor car sourced or supplied, inspected, documented.'),
    jsonb_build_object('label', 'Samples',             'copy', 'Paint, leather, wood and wheel samples signed off in person.'),
    jsonb_build_object('label', 'Contract',            'copy', 'Final specification locked. Work authorization signed.'),
    jsonb_build_object('label', 'Build',               'copy', 'The car is restored to the agreed specification.'),
    jsonb_build_object('label', 'Delivery',            'copy', 'Hand-over at our workshop or your door.'),
    jsonb_build_object('label', 'Aftercare',           'copy', 'Workmanship warranty and ongoing support.')
  )
);

-- Demo builder — neutral brand
INSERT INTO builder_brand (
  builder_id, wordmark_text, color_accent, color_bg, color_text,
  font_display, font_body, tagline, hero_copy, process_copy
) VALUES (
  '20000000-0000-0000-0000-000000000002',
  'Your Builder',
  '#5A5A58', '#F6F5F2', '#1A1A1A',
  'Playfair Display', 'Inter',
  'Your tagline here.',
  'Replace this hero copy in the brand editor.',
  jsonb_build_array(
    jsonb_build_object('label', 'Configure',  'copy', 'Describe your configure step.'),
    jsonb_build_object('label', 'Reserve',    'copy', 'Describe your reserve step.'),
    jsonb_build_object('label', 'Intake',     'copy', 'Describe your intake step.'),
    jsonb_build_object('label', 'Samples',    'copy', 'Describe your samples step.'),
    jsonb_build_object('label', 'Contract',   'copy', 'Describe your contract step.'),
    jsonb_build_object('label', 'Build',      'copy', 'Describe your build step.'),
    jsonb_build_object('label', 'Delivery',   'copy', 'Describe your delivery step.'),
    jsonb_build_object('label', 'Aftercare',  'copy', 'Describe your aftercare step.')
  )
);

-- ------------------------------------------------------------
-- builder_terms
-- ------------------------------------------------------------
CREATE TABLE builder_terms (
  builder_id         uuid PRIMARY KEY REFERENCES builders(id) ON DELETE CASCADE,
  reservation_cents  int NOT NULL DEFAULT 100000,
  payment_schedule   jsonb NOT NULL DEFAULT '[]'::jsonb,
  warranty_text      text,
  governing_law      text,
  lead_time_copy     text,
  currency           text NOT NULL DEFAULT 'usd',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_builder_terms_updated_at
  BEFORE UPDATE ON builder_terms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO builder_terms (
  builder_id, reservation_cents, payment_schedule,
  warranty_text, governing_law, lead_time_copy, currency
) VALUES (
  '20000000-0000-0000-0000-000000000001',
  1000000,
  jsonb_build_array(
    jsonb_build_object('label', 'Contract signing',               'percent', 50, 'trigger', 'contract'),
    jsonb_build_object('label', 'Paint and interior sign-off',    'percent', 40, 'trigger', 'samples'),
    jsonb_build_object('label', 'Delivery',                       'percent', 10, 'trigger', 'delivery')
  ),
  '12 months or 12,000 miles workmanship warranty on all work performed by KlassikWerk.',
  'State of Florida',
  'Current lead time: 12–18 weeks from contract signing.',
  'usd'
);

INSERT INTO builder_terms (
  builder_id, reservation_cents, payment_schedule,
  warranty_text, governing_law, lead_time_copy, currency
) VALUES (
  '20000000-0000-0000-0000-000000000002',
  100000,
  jsonb_build_array(
    jsonb_build_object('label', 'Contract signing', 'percent', 50, 'trigger', 'contract'),
    jsonb_build_object('label', 'Delivery',         'percent', 50, 'trigger', 'delivery')
  ),
  'Workmanship warranty text goes here.',
  'State of Florida',
  'Current lead time: TBD.',
  'usd'
);

-- ------------------------------------------------------------
-- contract_templates
-- ------------------------------------------------------------
CREATE TABLE contract_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id     uuid REFERENCES builders(id) ON DELETE CASCADE NOT NULL,
  version        int NOT NULL,
  title          text NOT NULL,
  body_markdown  text NOT NULL,
  merge_fields   jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_current     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (builder_id, version)
);

CREATE UNIQUE INDEX contract_templates_one_current_per_builder
  ON contract_templates (builder_id) WHERE is_current;

CREATE TRIGGER trg_contract_templates_updated_at
  BEFORE UPDATE ON contract_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- KlassikWerk work authorization template
INSERT INTO contract_templates (
  builder_id, version, title, body_markdown, merge_fields, is_current
) VALUES (
  '20000000-0000-0000-0000-000000000001',
  1,
  'Work Authorization',
  $md$# Work Authorization

**Builder:** {{builder_legal_name}}
**Customer:** {{customer_full_name}}
**Address:** {{customer_address}}

## Vehicle

- Platform: {{vehicle_platform}}
- VIN: {{vehicle_vin}}
- Year: {{vehicle_year}}

## Configuration

{{configuration_table}}

## Price

Total: **{{price_total}}**

## Payment Schedule

{{payment_schedule_table}}

## Warranty

{{warranty_text}}

## Governing Law

This agreement is governed by the laws of {{governing_law}}.

## Signatures

Customer: ______________________________   Date: ______________

{{builder_name}} authorized representative: ______________________________   Date: ______________
$md$,
  jsonb_build_array(
    'builder_legal_name', 'builder_name', 'customer_full_name', 'customer_address',
    'vehicle_platform', 'vehicle_vin', 'vehicle_year',
    'configuration_table', 'price_total', 'payment_schedule_table',
    'warranty_text', 'governing_law'
  ),
  true
);

-- Demo builder generic template
INSERT INTO contract_templates (
  builder_id, version, title, body_markdown, merge_fields, is_current
) VALUES (
  '20000000-0000-0000-0000-000000000002',
  1,
  'Work Authorization',
  $md$# Work Authorization

Customer: {{customer_full_name}}
Vehicle: {{vehicle_platform}} VIN {{vehicle_vin}}

{{configuration_table}}

Price: {{price_total}}

{{payment_schedule_table}}

{{warranty_text}}

Governed by {{governing_law}}.
$md$,
  jsonb_build_array(
    'customer_full_name', 'vehicle_platform', 'vehicle_vin',
    'configuration_table', 'price_total', 'payment_schedule_table',
    'warranty_text', 'governing_law'
  ),
  true
);

-- ------------------------------------------------------------
-- catalog_platform_gallery
-- ------------------------------------------------------------
CREATE TABLE catalog_platform_gallery (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id    uuid REFERENCES builders(id) ON DELETE CASCADE NOT NULL,
  platform_id   uuid REFERENCES catalog_platforms(id) ON DELETE CASCADE NOT NULL,
  image_url     text NOT NULL,
  caption       text,
  sort          int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_catalog_platform_gallery_updated_at
  BEFORE UPDATE ON catalog_platform_gallery
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- Add builder_id to existing catalog_* + builds, backfill, lock down
-- ------------------------------------------------------------

ALTER TABLE catalog_platforms     ADD COLUMN builder_id uuid REFERENCES builders(id) ON DELETE CASCADE;
ALTER TABLE catalog_tiers         ADD COLUMN builder_id uuid REFERENCES builders(id) ON DELETE CASCADE;
ALTER TABLE catalog_option_groups ADD COLUMN builder_id uuid REFERENCES builders(id) ON DELETE CASCADE;
ALTER TABLE catalog_options       ADD COLUMN builder_id uuid REFERENCES builders(id) ON DELETE CASCADE;
ALTER TABLE builds                ADD COLUMN builder_id uuid REFERENCES builders(id) ON DELETE RESTRICT;

UPDATE catalog_platforms     SET builder_id = '20000000-0000-0000-0000-000000000001' WHERE builder_id IS NULL;
UPDATE catalog_tiers         SET builder_id = '20000000-0000-0000-0000-000000000001' WHERE builder_id IS NULL;
UPDATE catalog_option_groups SET builder_id = '20000000-0000-0000-0000-000000000001' WHERE builder_id IS NULL;
UPDATE catalog_options       SET builder_id = '20000000-0000-0000-0000-000000000001' WHERE builder_id IS NULL;
UPDATE builds                SET builder_id = '20000000-0000-0000-0000-000000000001' WHERE builder_id IS NULL;

ALTER TABLE catalog_platforms     ALTER COLUMN builder_id SET NOT NULL;
ALTER TABLE catalog_tiers         ALTER COLUMN builder_id SET NOT NULL;
ALTER TABLE catalog_option_groups ALTER COLUMN builder_id SET NOT NULL;
ALTER TABLE catalog_options       ALTER COLUMN builder_id SET NOT NULL;
ALTER TABLE builds                ALTER COLUMN builder_id SET NOT NULL;

-- Replace (slug) uniqueness with (builder_id, slug)
ALTER TABLE catalog_platforms     DROP CONSTRAINT catalog_platforms_slug_key;
ALTER TABLE catalog_tiers         DROP CONSTRAINT catalog_tiers_slug_key;
ALTER TABLE catalog_option_groups DROP CONSTRAINT catalog_option_groups_slug_key;
ALTER TABLE catalog_options       DROP CONSTRAINT catalog_options_slug_key;

ALTER TABLE catalog_platforms     ADD CONSTRAINT catalog_platforms_builder_slug_key     UNIQUE (builder_id, slug);
ALTER TABLE catalog_tiers         ADD CONSTRAINT catalog_tiers_builder_slug_key         UNIQUE (builder_id, slug);
ALTER TABLE catalog_option_groups ADD CONSTRAINT catalog_option_groups_builder_slug_key UNIQUE (builder_id, slug);
ALTER TABLE catalog_options       ADD CONSTRAINT catalog_options_builder_slug_key       UNIQUE (builder_id, slug);

-- ------------------------------------------------------------
-- profiles: add operator role, profile_builders join
-- ------------------------------------------------------------
ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'ops', 'partner', 'operator'));

CREATE TABLE profile_builders (
  profile_id  uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  builder_id  uuid REFERENCES builders(id) ON DELETE CASCADE NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, builder_id)
);

-- Promote Elliot to operator if his profile exists
UPDATE profiles
SET role = 'operator'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'elliot.humble@gmail.com')
  AND role IN ('customer', 'ops');

-- ------------------------------------------------------------
-- RLS helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_is_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND role = 'operator'
  );
$$;

CREATE OR REPLACE FUNCTION auth_can_write_builder(target_builder uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    auth_is_operator()
    OR EXISTS (
      SELECT 1
      FROM profile_builders pb
      JOIN profiles p ON p.id = pb.profile_id
      WHERE p.user_id = auth.uid()
        AND p.role = 'ops'
        AND pb.builder_id = target_builder
    );
$$;

-- Redefine auth_is_ops to include operator (operators can do everything ops can)
CREATE OR REPLACE FUNCTION auth_is_ops()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid()
      AND role IN ('ops', 'operator')
  );
$$;

-- ------------------------------------------------------------
-- Enable RLS on new tables
-- ------------------------------------------------------------
ALTER TABLE operators                ENABLE ROW LEVEL SECURITY;
ALTER TABLE builders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder_brand            ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder_terms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_platform_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_builders         ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- RLS: operators, builders, brand, terms (public read, operator write)
-- ------------------------------------------------------------
CREATE POLICY "operators_public_read"
  ON operators FOR SELECT USING (true);

CREATE POLICY "operators_operator_write"
  ON operators FOR ALL
  USING (auth_is_operator()) WITH CHECK (auth_is_operator());

CREATE POLICY "builders_public_read"
  ON builders FOR SELECT
  USING (active = true OR auth_can_write_builder(id));

CREATE POLICY "builders_operator_write"
  ON builders FOR ALL
  USING (auth_is_operator()) WITH CHECK (auth_is_operator());

CREATE POLICY "builder_brand_public_read"
  ON builder_brand FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM builders b WHERE b.id = builder_id AND (b.active OR auth_can_write_builder(b.id)))
  );

CREATE POLICY "builder_brand_write"
  ON builder_brand FOR ALL
  USING (auth_can_write_builder(builder_id)) WITH CHECK (auth_can_write_builder(builder_id));

CREATE POLICY "builder_terms_public_read"
  ON builder_terms FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM builders b WHERE b.id = builder_id AND (b.active OR auth_can_write_builder(b.id)))
  );

CREATE POLICY "builder_terms_write"
  ON builder_terms FOR ALL
  USING (auth_can_write_builder(builder_id)) WITH CHECK (auth_can_write_builder(builder_id));

CREATE POLICY "contract_templates_builder_scope"
  ON contract_templates FOR SELECT
  USING (auth_can_write_builder(builder_id));

CREATE POLICY "contract_templates_write"
  ON contract_templates FOR ALL
  USING (auth_can_write_builder(builder_id)) WITH CHECK (auth_can_write_builder(builder_id));

CREATE POLICY "profile_builders_self_read"
  ON profile_builders FOR SELECT
  USING (
    auth_is_operator()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
  );

CREATE POLICY "profile_builders_operator_write"
  ON profile_builders FOR ALL
  USING (auth_is_operator()) WITH CHECK (auth_is_operator());

CREATE POLICY "catalog_platform_gallery_public_read"
  ON catalog_platform_gallery FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM builders b WHERE b.id = builder_id AND (b.active OR auth_can_write_builder(b.id)))
  );

CREATE POLICY "catalog_platform_gallery_write"
  ON catalog_platform_gallery FOR ALL
  USING (auth_can_write_builder(builder_id)) WITH CHECK (auth_can_write_builder(builder_id));

-- ------------------------------------------------------------
-- Rewrite catalog RLS so public read requires builder.active and
-- writes require builder-scope permission.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "catalog_platforms_public_read"      ON catalog_platforms;
DROP POLICY IF EXISTS "catalog_platforms_ops_write"        ON catalog_platforms;
DROP POLICY IF EXISTS "catalog_tiers_public_read"          ON catalog_tiers;
DROP POLICY IF EXISTS "catalog_tiers_ops_write"            ON catalog_tiers;
DROP POLICY IF EXISTS "catalog_option_groups_public_read"  ON catalog_option_groups;
DROP POLICY IF EXISTS "catalog_option_groups_ops_write"    ON catalog_option_groups;
DROP POLICY IF EXISTS "catalog_options_public_read"        ON catalog_options;
DROP POLICY IF EXISTS "catalog_options_ops_write"          ON catalog_options;

CREATE POLICY "catalog_platforms_public_read"
  ON catalog_platforms FOR SELECT
  USING (
    (active AND EXISTS (SELECT 1 FROM builders b WHERE b.id = builder_id AND b.active))
    OR auth_can_write_builder(builder_id)
  );
CREATE POLICY "catalog_platforms_write"
  ON catalog_platforms FOR ALL
  USING (auth_can_write_builder(builder_id)) WITH CHECK (auth_can_write_builder(builder_id));

CREATE POLICY "catalog_tiers_public_read"
  ON catalog_tiers FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM builders b WHERE b.id = builder_id AND b.active)
    OR auth_can_write_builder(builder_id)
  );
CREATE POLICY "catalog_tiers_write"
  ON catalog_tiers FOR ALL
  USING (auth_can_write_builder(builder_id)) WITH CHECK (auth_can_write_builder(builder_id));

CREATE POLICY "catalog_option_groups_public_read"
  ON catalog_option_groups FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM builders b WHERE b.id = builder_id AND b.active)
    OR auth_can_write_builder(builder_id)
  );
CREATE POLICY "catalog_option_groups_write"
  ON catalog_option_groups FOR ALL
  USING (auth_can_write_builder(builder_id)) WITH CHECK (auth_can_write_builder(builder_id));

CREATE POLICY "catalog_options_public_read"
  ON catalog_options FOR SELECT
  USING (
    (active AND EXISTS (SELECT 1 FROM builders b WHERE b.id = builder_id AND b.active))
    OR auth_can_write_builder(builder_id)
  );
CREATE POLICY "catalog_options_write"
  ON catalog_options FOR ALL
  USING (auth_can_write_builder(builder_id)) WITH CHECK (auth_can_write_builder(builder_id));

-- builds already has a scope policy on customer_id / ops; add builder scoping
DROP POLICY IF EXISTS "builds_own_read"  ON builds;
DROP POLICY IF EXISTS "builds_ops_write" ON builds;

CREATE POLICY "builds_own_read"
  ON builds FOR SELECT
  USING (customer_id = auth_customer_id() OR auth_can_write_builder(builder_id));

CREATE POLICY "builds_builder_write"
  ON builds FOR ALL
  USING (auth_can_write_builder(builder_id)) WITH CHECK (auth_can_write_builder(builder_id));
