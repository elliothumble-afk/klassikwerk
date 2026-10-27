-- Labour source toggle on the quote margin panel.
--
-- Operators can route a build through their own in-house shop or
-- through a partner shop. The cost rates differ, and the choice is a
-- per-quote call. builder_terms gets both rates + a default, and the
-- quote stores whichever one the operator picked so a sent quote's
-- margin snapshot is stable.

CREATE TYPE labour_source AS ENUM ('in_house', 'partner_shop');

ALTER TABLE builder_terms
  ADD COLUMN in_house_labour_cost_cents int NOT NULL DEFAULT 6500,
  ADD COLUMN default_labour_source      labour_source NOT NULL DEFAULT 'partner_shop';

ALTER TABLE quotes
  ADD COLUMN labour_source labour_source;
