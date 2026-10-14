-- Operator contact block shown in quote / contract PDFs.
ALTER TABLE operators
  ADD COLUMN contact jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE operators
  SET contact = jsonb_build_object(
    'name',    'Humble House',
    'person',  'Elliot Humble',
    'email',   'elliot.humble@gmail.com',
    'phone',   '',
    'website', 'https://humblehouseauto.com',
    'address', ''
  )
  WHERE slug = 'humble-house';
