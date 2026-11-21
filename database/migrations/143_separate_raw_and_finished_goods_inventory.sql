-- Separate raw-material and finished-goods inventory domains.
-- Additive only: existing material-lot history remains untouched.

ALTER TABLE wms_warehouses DROP CONSTRAINT IF EXISTS wms_warehouses_type_check;
ALTER TABLE wms_warehouses ADD CONSTRAINT wms_warehouses_type_check
  CHECK (warehouse_type IN ('RAW_MATERIAL','FINISHED_GOODS','WIP','QUARANTINE','SCRAP'));

CREATE TABLE IF NOT EXISTS wms_finished_goods_inventory (
  id bigserial PRIMARY KEY,
  serial_no varchar(160) NOT NULL UNIQUE,
  product_id bigint REFERENCES products(id),
  work_order_id bigint REFERENCES work_orders(id),
  location_id bigint NOT NULL REFERENCES storage_locations(id),
  carton_container_id bigint REFERENCES wms_containers(id),
  pallet_container_id bigint REFERENCES wms_containers(id),
  inventory_status varchar(20) NOT NULL DEFAULT 'AVAILABLE',
  received_at timestamptz NOT NULL DEFAULT now(),
  shipped_at timestamptz,
  created_by bigint REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (inventory_status IN ('AVAILABLE','RESERVED','HOLD','SHIPPED','RETURNED','SCRAPPED'))
);

CREATE TABLE IF NOT EXISTS wms_finished_goods_transactions (
  id bigserial PRIMARY KEY,
  event_key varchar(120) NOT NULL UNIQUE,
  serial_no varchar(160) NOT NULL,
  action varchar(30) NOT NULL,
  from_location_id bigint REFERENCES storage_locations(id),
  to_location_id bigint REFERENCES storage_locations(id),
  work_order_id bigint REFERENCES work_orders(id),
  carton_container_id bigint REFERENCES wms_containers(id),
  pallet_container_id bigint REFERENCES wms_containers(id),
  operator_id bigint NOT NULL REFERENCES users(id),
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (action IN ('RECEIVE_FINISHED','MOVE','RESERVE','RELEASE','SHIP','RETURN','HOLD','SCRAP'))
);

CREATE INDEX IF NOT EXISTS idx_fg_inventory_location_status
  ON wms_finished_goods_inventory(location_id, inventory_status);
CREATE INDEX IF NOT EXISTS idx_fg_inventory_work_order
  ON wms_finished_goods_inventory(work_order_id, inventory_status);
CREATE INDEX IF NOT EXISTS idx_fg_transactions_serial_time
  ON wms_finished_goods_transactions(serial_no, occurred_at DESC);

CREATE OR REPLACE FUNCTION enforce_wms_inventory_warehouse_domain()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_type varchar(30);
BEGIN
  SELECT w.warehouse_type INTO target_type
  FROM storage_locations sl JOIN wms_warehouses w ON w.id=sl.warehouse_id
  WHERE sl.id=NEW.location_id;
  IF target_type IS DISTINCT FROM 'FINISHED_GOODS' THEN
    RAISE EXCEPTION 'Finished good % requires a FINISHED_GOODS warehouse location', NEW.serial_no;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fg_inventory_warehouse_domain ON wms_finished_goods_inventory;
CREATE TRIGGER trg_fg_inventory_warehouse_domain
BEFORE INSERT OR UPDATE OF location_id ON wms_finished_goods_inventory
FOR EACH ROW EXECUTE FUNCTION enforce_wms_inventory_warehouse_domain();

CREATE OR REPLACE VIEW v_wms_raw_material_inventory AS
SELECT ml.id AS material_lot_id, ml.lot_no, ml.material_id, m.code AS material_code,
       ml.received_qty, ml.reserved_qty, ml.iqc_status, ml.storage_location_id,
       sl.code AS location_code, w.code AS warehouse_code, w.warehouse_type
FROM material_lots ml
JOIN materials m ON m.id=ml.material_id
LEFT JOIN storage_locations sl ON sl.id=ml.storage_location_id
LEFT JOIN wms_warehouses w ON w.id=sl.warehouse_id
WHERE w.warehouse_type='RAW_MATERIAL' OR w.id IS NULL;

CREATE OR REPLACE VIEW v_wms_finished_goods_inventory AS
SELECT fg.id,fg.serial_no,fg.inventory_status,fg.received_at,fg.shipped_at,
       p.code AS product_code,wo.code AS work_order_code,sl.code AS location_code,
       w.code AS warehouse_code,carton.container_code AS carton_code,
       pallet.container_code AS pallet_code
FROM wms_finished_goods_inventory fg
LEFT JOIN products p ON p.id=fg.product_id
LEFT JOIN work_orders wo ON wo.id=fg.work_order_id
JOIN storage_locations sl ON sl.id=fg.location_id
JOIN wms_warehouses w ON w.id=sl.warehouse_id
LEFT JOIN wms_containers carton ON carton.id=fg.carton_container_id
LEFT JOIN wms_containers pallet ON pallet.id=fg.pallet_container_id;

COMMENT ON VIEW v_wms_raw_material_inventory IS 'Raw-material lots only; never includes finished-product SN inventory.';
COMMENT ON VIEW v_wms_finished_goods_inventory IS 'Finished-product SN inventory only; never includes raw-material lots.';
