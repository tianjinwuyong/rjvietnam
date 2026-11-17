-- Physical reel traceability for SMT PDA loading.
-- BOM requirements identify the material; WMS label_id identifies the actual reel.

ALTER TABLE feeder_binding_events
  ADD COLUMN IF NOT EXISTS material_sn varchar(128);

CREATE INDEX IF NOT EXISTS idx_feeder_binding_material_sn
  ON feeder_binding_events(material_sn, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_lots_label_id
  ON material_lots(label_id)
  WHERE label_id IS NOT NULL AND label_id <> '';

COMMENT ON COLUMN feeder_binding_events.material_sn IS
  'Physical material/reel serial number scanned from WMS material_lots.label_id';

