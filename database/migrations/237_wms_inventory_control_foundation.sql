-- WMS inventory control foundation.
-- Inventory quantity remains derived from material_lots and the immutable ledger.

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_lot_time
  ON inventory_transactions(material_lot_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_locations
  ON inventory_transactions(from_location_id, to_location_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_material_lots_location_status
  ON material_lots(storage_location_id, iqc_status, lot_no);

CREATE TABLE IF NOT EXISTS wms_process_sla_rules (
  process_key VARCHAR(40) PRIMARY KEY,
  sla_minutes INTEGER NOT NULL CHECK (sla_minutes > 0),
  warning_percent INTEGER NOT NULL DEFAULT 80 CHECK (warning_percent BETWEEN 1 AND 99),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO wms_process_sla_rules(process_key, sla_minutes, warning_percent)
VALUES
  ('RECEIVING', 120, 80),
  ('QR_BINDING', 60, 80),
  ('IQC', 1440, 80),
  ('DEFECT_MRB', 480, 80),
  ('MRB', 1440, 80)
ON CONFLICT(process_key) DO NOTHING;

CREATE OR REPLACE VIEW wms_inventory_position_balances AS
SELECT
  ml.id AS material_lot_id,
  ml.lot_no,
  ml.material_id,
  m.code AS material_code,
  m.name_zh AS material_name,
  ml.storage_location_id,
  sl.code AS location_code,
  sl.area,
  w.warehouse_type,
  ml.received_qty::NUMERIC AS quantity,
  COALESCE(ml.reserved_qty, 0)::NUMERIC AS reserved_quantity,
  GREATEST(0, ml.received_qty - COALESCE(ml.reserved_qty, 0))::NUMERIC AS available_quantity,
  ml.iqc_status,
  ml.lifecycle_status,
  ml.received_at,
  ml.expiry_date,
  CASE
    WHEN ml.iqc_status IN ('released', 'scrapped') THEN FALSE
    WHEN ml.received_at IS NULL THEN FALSE
    ELSE NOW() > ml.received_at + INTERVAL '24 hours'
  END AS iqc_sla_overdue
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
LEFT JOIN wms_warehouses w ON w.id = sl.warehouse_id;

CREATE OR REPLACE VIEW wms_inventory_position_summary AS
SELECT
  location_code,
  warehouse_type,
  material_code,
  COUNT(*)::INTEGER AS lot_count,
  SUM(quantity)::NUMERIC AS quantity,
  SUM(available_quantity)::NUMERIC AS available_quantity,
  COUNT(*) FILTER (WHERE iqc_sla_overdue)::INTEGER AS overdue_lot_count
FROM wms_inventory_position_balances
GROUP BY location_code, warehouse_type, material_code;
