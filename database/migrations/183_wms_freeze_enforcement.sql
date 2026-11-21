-- Hard database boundary: normal inventory movement cannot bypass an active
-- closed-loop freeze, even if a legacy API forgets to check it.
BEGIN;

CREATE OR REPLACE FUNCTION wms_enforce_inventory_freeze()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM wms_inventory_freezes f
    WHERE f.status='ACTIVE'
      AND (
        (f.material_lot_id IS NOT NULL AND f.material_lot_id=NEW.material_lot_id)
        OR
        (f.location_code IS NOT NULL AND EXISTS (
          SELECT 1 FROM storage_locations sl
          WHERE sl.code=f.location_code
            AND sl.id IN (NEW.from_location_id,NEW.to_location_id)
        ))
      )
  ) THEN
    RAISE EXCEPTION 'WMS_INVENTORY_FROZEN: lot or location has an active closure case'
      USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wms_inventory_freeze ON inventory_transactions;
CREATE TRIGGER trg_wms_inventory_freeze
BEFORE INSERT ON inventory_transactions
FOR EACH ROW EXECUTE FUNCTION wms_enforce_inventory_freeze();

INSERT INTO _migrations(filename,hash)
VALUES ('183_wms_freeze_enforcement.sql','wms-freeze-enforcement-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
