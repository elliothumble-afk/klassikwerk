-- ============================================================
-- Utility: updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- Core: profiles
-- ============================================================
CREATE TABLE profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  role        text NOT NULL DEFAULT 'customer'
                CHECK (role IN ('customer', 'ops', 'partner')),
  full_name   text,
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- Core: customers
-- ============================================================
CREATE TABLE customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  address     jsonb,
  source      text CHECK (source IN ('web', 'humble_house', 'referral')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Catalog: platforms
-- ============================================================
CREATE TABLE catalog_platforms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  chassis         text NOT NULL,
  years           text NOT NULL,
  hero_image_url  text,
  sort            int NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_catalog_platforms_updated_at
  BEFORE UPDATE ON catalog_platforms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Catalog: tiers
-- ============================================================
CREATE TABLE catalog_tiers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  name              text NOT NULL,
  base_price_cents  int,
  lead_time_weeks   int,
  description       text,
  quote_only        boolean NOT NULL DEFAULT false,
  sort              int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_catalog_tiers_updated_at
  BEFORE UPDATE ON catalog_tiers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Catalog: option groups
-- ============================================================
CREATE TABLE catalog_option_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id uuid REFERENCES catalog_platforms(id) ON DELETE SET NULL,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  selection   text NOT NULL DEFAULT 'single' CHECK (selection IN ('single', 'multi')),
  required    boolean NOT NULL DEFAULT false,
  sort        int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_catalog_option_groups_updated_at
  BEFORE UPDATE ON catalog_option_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Catalog: options
-- ============================================================
CREATE TABLE catalog_options (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              uuid REFERENCES catalog_option_groups(id) ON DELETE CASCADE NOT NULL,
  slug                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  code                  text,
  price_cents           int NOT NULL DEFAULT 0,
  included_in_tier_ids  uuid[] NOT NULL DEFAULT '{}',
  swatch_image_url      text,
  sort                  int NOT NULL DEFAULT 0,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_catalog_options_updated_at
  BEFORE UPDATE ON catalog_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Catalog: option platform restrictions
-- ============================================================
CREATE TABLE catalog_option_platforms (
  option_id    uuid REFERENCES catalog_options(id) ON DELETE CASCADE NOT NULL,
  platform_id  uuid REFERENCES catalog_platforms(id) ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (option_id, platform_id)
);

-- ============================================================
-- Core: vehicles
-- ============================================================
CREATE TABLE vehicles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
  platform_id       uuid REFERENCES catalog_platforms(id) ON DELETE RESTRICT NOT NULL,
  vin               text,
  year              int,
  mileage           int,
  colour_original   text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_vehicles_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Core: builds
-- ============================================================
CREATE TYPE build_stage AS ENUM (
  'configured',
  'reserved',
  'intake',
  'samples',
  'contract',
  'build',
  'delivery',
  'aftercare',
  'closed'
);

CREATE TABLE builds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid REFERENCES customers(id) ON DELETE RESTRICT NOT NULL,
  vehicle_id    uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  platform_id   uuid REFERENCES catalog_platforms(id) ON DELETE RESTRICT NOT NULL,
  tier_id       uuid REFERENCES catalog_tiers(id) ON DELETE RESTRICT NOT NULL,
  stage         build_stage NOT NULL DEFAULT 'configured',
  slot_year     int,
  slot_number   int,
  price_cents   int,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_builds_updated_at
  BEFORE UPDATE ON builds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Core: build_options
-- ============================================================
CREATE TABLE build_options (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id                uuid REFERENCES builds(id) ON DELETE CASCADE NOT NULL,
  option_id               uuid REFERENCES catalog_options(id) ON DELETE RESTRICT NOT NULL,
  price_cents_at_selection int NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Core: build_stage_events
-- ============================================================
CREATE TABLE build_stage_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id       uuid REFERENCES builds(id) ON DELETE CASCADE NOT NULL,
  from_stage     build_stage,
  to_stage       build_stage NOT NULL,
  by_profile_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Core: media
-- ============================================================
CREATE TABLE media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id      uuid REFERENCES builds(id) ON DELETE CASCADE,
  option_id     uuid REFERENCES catalog_options(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('swatch', 'hero', 'build_photo', 'document')),
  caption       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_media_updated_at
  BEFORE UPDATE ON media
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Storage bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- RLS: enable on all tables
-- ============================================================
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_platforms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_tiers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_options       ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_option_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE builds                ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_options         ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_stage_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE media                 ENABLE ROW LEVEL SECURITY;

-- Helper: is current user ops?
CREATE OR REPLACE FUNCTION auth_is_ops()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid()
    AND role = 'ops'
  );
$$;

-- Helper: get customer id for current user
CREATE OR REPLACE FUNCTION auth_customer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT c.id FROM customers c
  JOIN profiles p ON p.id = c.profile_id
  WHERE p.user_id = auth.uid()
  LIMIT 1;
$$;

-- ============================================================
-- RLS policies: catalog (public read active, ops write)
-- ============================================================
CREATE POLICY "catalog_platforms_public_read"
  ON catalog_platforms FOR SELECT
  USING (active = true OR auth_is_ops());

CREATE POLICY "catalog_platforms_ops_write"
  ON catalog_platforms FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

CREATE POLICY "catalog_tiers_public_read"
  ON catalog_tiers FOR SELECT
  USING (true);

CREATE POLICY "catalog_tiers_ops_write"
  ON catalog_tiers FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

CREATE POLICY "catalog_option_groups_public_read"
  ON catalog_option_groups FOR SELECT
  USING (true);

CREATE POLICY "catalog_option_groups_ops_write"
  ON catalog_option_groups FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

CREATE POLICY "catalog_options_public_read"
  ON catalog_options FOR SELECT
  USING (active = true OR auth_is_ops());

CREATE POLICY "catalog_options_ops_write"
  ON catalog_options FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

CREATE POLICY "catalog_option_platforms_public_read"
  ON catalog_option_platforms FOR SELECT
  USING (true);

CREATE POLICY "catalog_option_platforms_ops_write"
  ON catalog_option_platforms FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

-- ============================================================
-- RLS policies: profiles
-- ============================================================
CREATE POLICY "profiles_own_read"
  ON profiles FOR SELECT
  USING (user_id = auth.uid() OR auth_is_ops());

CREATE POLICY "profiles_own_update"
  ON profiles FOR UPDATE
  USING (user_id = auth.uid() OR auth_is_ops())
  WITH CHECK (user_id = auth.uid() OR auth_is_ops());

CREATE POLICY "profiles_ops_insert"
  ON profiles FOR INSERT
  WITH CHECK (auth_is_ops() OR user_id = auth.uid());

-- ============================================================
-- RLS policies: customers
-- ============================================================
CREATE POLICY "customers_own_read"
  ON customers FOR SELECT
  USING (id = auth_customer_id() OR auth_is_ops());

CREATE POLICY "customers_ops_write"
  ON customers FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

-- ============================================================
-- RLS policies: vehicles
-- ============================================================
CREATE POLICY "vehicles_own_read"
  ON vehicles FOR SELECT
  USING (customer_id = auth_customer_id() OR auth_is_ops());

CREATE POLICY "vehicles_ops_write"
  ON vehicles FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

-- ============================================================
-- RLS policies: builds
-- ============================================================
CREATE POLICY "builds_own_read"
  ON builds FOR SELECT
  USING (customer_id = auth_customer_id() OR auth_is_ops());

CREATE POLICY "builds_ops_write"
  ON builds FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

-- ============================================================
-- RLS policies: build_options
-- ============================================================
CREATE POLICY "build_options_own_read"
  ON build_options FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM builds b
      WHERE b.id = build_id
      AND (b.customer_id = auth_customer_id() OR auth_is_ops())
    )
  );

CREATE POLICY "build_options_ops_write"
  ON build_options FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

-- ============================================================
-- RLS policies: build_stage_events
-- ============================================================
CREATE POLICY "build_stage_events_own_read"
  ON build_stage_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM builds b
      WHERE b.id = build_id
      AND (b.customer_id = auth_customer_id() OR auth_is_ops())
    )
  );

CREATE POLICY "build_stage_events_ops_write"
  ON build_stage_events FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

-- ============================================================
-- RLS policies: media
-- ============================================================
CREATE POLICY "media_swatch_hero_public_read"
  ON media FOR SELECT
  USING (
    kind IN ('swatch', 'hero')
    OR auth_is_ops()
    OR (
      build_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM builds b
        WHERE b.id = build_id
        AND b.customer_id = auth_customer_id()
      )
    )
  );

CREATE POLICY "media_ops_write"
  ON media FOR ALL
  USING (auth_is_ops())
  WITH CHECK (auth_is_ops());

-- ============================================================
-- Storage policies
-- ============================================================
CREATE POLICY "storage_swatch_hero_public_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'media'
    AND (
      (storage.foldername(name))[1] IN ('swatch', 'hero')
      OR auth.role() = 'authenticated'
    )
  );

CREATE POLICY "storage_ops_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'media' AND auth_is_ops());

CREATE POLICY "storage_ops_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'media' AND auth_is_ops())
  WITH CHECK (bucket_id = 'media' AND auth_is_ops());

CREATE POLICY "storage_ops_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'media' AND auth_is_ops());
