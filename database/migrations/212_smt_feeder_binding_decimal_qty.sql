BEGIN;

ALTER TABLE feeder_binding_events
  ALTER COLUMN qty TYPE numeric(18,6)
  USING qty::numeric;

INSERT INTO _migrations(filename, hash)
VALUES ('212_smt_feeder_binding_decimal_qty.sql', 'smt-feeder-binding-decimal-qty-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
