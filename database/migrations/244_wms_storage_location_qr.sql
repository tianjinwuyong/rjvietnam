-- Every physical storage location has one stable, scannable WMS QR value.
UPDATE storage_locations
SET qr_code = 'WMS-LOC:' || UPPER(code)
WHERE qr_code IS NULL OR BTRIM(qr_code) = '';

