-- Phase 6 polish: carry the customer's vehicle snapshot on the quote
-- so the Lookbook's merged "Your {platform}" page can show a real
-- photo, year and hex-driven palette instead of a stock hero.
--
-- vehicle_colour already lives on quotes (added in the Phase 6 base
-- migration); this adds the picker-friendly hex, year, and photo URL.

ALTER TABLE quotes
  ADD COLUMN vehicle_colour_hex text,
  ADD COLUMN vehicle_year       int,
  ADD COLUMN vehicle_photo_url  text;

-- Mirror onto leads so the vehicle snapshot follows the customer when
-- a quote is revised or re-created. Not strictly required by the PDF
-- renderer, but convenient for the UI and future reporting.
ALTER TABLE leads
  ADD COLUMN vehicle_colour_hex text,
  ADD COLUMN vehicle_year       int,
  ADD COLUMN vehicle_photo_url  text;
