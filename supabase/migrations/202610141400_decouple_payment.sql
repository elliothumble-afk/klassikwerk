-- ============================================================
-- Decouple reservations from payment.
--
-- Reservations always create the customer + build; a per-builder
-- payment_mode controls whether a Stripe Checkout session is kicked
-- off after creation. Default is 'none'.
-- ============================================================

-- Per-builder payment mode
ALTER TABLE builder_terms
  ADD COLUMN payment_mode text NOT NULL DEFAULT 'none'
    CHECK (payment_mode IN ('none', 'stripe'));

-- Guest customers (no auth user yet)
ALTER TABLE customers ADD COLUMN email text;
ALTER TABLE customers ADD COLUMN full_name text;
ALTER TABLE customers ALTER COLUMN profile_id DROP NOT NULL;

-- Email uniqueness only enforced when present; NULLs are allowed to coexist
CREATE UNIQUE INDEX customers_email_key
  ON customers (lower(email))
  WHERE email IS NOT NULL;

-- Build-level payment status (webhook updates this later)
ALTER TABLE builds
  ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed'));

-- Allow anonymous reservations: public insert into customers / builds /
-- build_options / build_stage_events via the edge function (which uses the
-- service role, so RLS does not apply there). RLS reads still require
-- customer or ops/operator access per existing policies.
