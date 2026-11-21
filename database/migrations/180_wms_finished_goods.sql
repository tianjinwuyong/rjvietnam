-- Migration 180: WMS Finished Goods + Outbound + SN Trace
BEGIN;

CREATE TABLE IF NOT EXISTS wms_finished_goods (
  id                    BIGSERIAL PRIMARY KEY,
  sn_no                 VARCHAR(80) NOT NULL UNIQUE,
  work_order_no         VARCHAR(80) NOT NULL,
  material_code         VARCHAR(120) NOT NULL,
  material_name         VARCHAR(240),
  batch_code            VARCHAR(80),
  production_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  qty                   DECIMAL(12,3) NOT NULL DEFAULT 1,
  location_code         VARCHAR(40),
  warehouse_zone        VARCHAR(24),
  iqc_status            VARCHAR(16) DEFAULT 'pending',
  oqc_inspector         VARCHAR(80),
  oqc_inspected_at      TIMESTAMPTZ,
  stored_at             TIMESTAMPTZ,
  stored_by             VARCHAR(80),
  status                VARCHAR(24) DEFAULT 'pending_oqc',
  customer_code         VARCHAR(80),
  customer_order_no     VARCHAR(80),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms_sn_material_lots (
  id                    BIGSERIAL PRIMARY KEY,
  sn_no                 VARCHAR(80) NOT NULL,
  material_lot_no       VARCHAR(120) NOT NULL,
  material_code         VARCHAR(120) NOT NULL,
  material_name         VARCHAR(240),
  work_order_no         VARCHAR(80),
  station_code          VARCHAR(40),
  loaded_at             TIMESTAMPTZ NOT NULL,
  operator_id           VARCHAR(80),
  qty_per_unit          DECIMAL(12,3) DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms_outbound_orders (
  id                    BIGSERIAL PRIMARY KEY,
  outbound_no           VARCHAR(80) NOT NULL UNIQUE,
  customer_code         VARCHAR(80) NOT NULL,
  customer_name         VARCHAR(240),
  customer_order_no     VARCHAR(80),
  outbound_type         VARCHAR(24) DEFAULT 'sales',
  planned_date          DATE,
  actual_date           DATE,
  status                VARCHAR(24) DEFAULT 'pending',
  total_qty             DECIMAL(12,3) DEFAULT 0,
  operator_id           VARCHAR(80),
  logistics_no          VARCHAR(80),
  packing_operator      VARCHAR(80),
  packing_time          TIMESTAMPTZ,
  shipping_method       VARCHAR(40),
  destination           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms_outbound_items (
  id                    BIGSERIAL PRIMARY KEY,
  outbound_order_id     BIGINT NOT NULL REFERENCES wms_outbound_orders(id),
  sn_no                 VARCHAR(80) NOT NULL,
  material_code         VARCHAR(120),
  batch_code            VARCHAR(80),
  qty                   DECIMAL(12,3) DEFAULT 1,
  pick_status           VARCHAR(16) DEFAULT 'pending',
  picked_at             TIMESTAMPTZ,
  picked_by             VARCHAR(80),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms_packing_records (
  id                    BIGSERIAL PRIMARY KEY,
  outbound_order_id     BIGINT REFERENCES wms_outbound_orders(id),
  operator_id           VARCHAR(80) NOT NULL,
  packing_time          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  packing_materials     JSONB DEFAULT '[]',
  photo_urls            JSONB DEFAULT '[]',
  marking_info          JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fg_sn ON wms_finished_goods(sn_no);
CREATE INDEX IF NOT EXISTS idx_fg_wo ON wms_finished_goods(work_order_no);
CREATE INDEX IF NOT EXISTS idx_fg_status ON wms_finished_goods(status);
CREATE INDEX IF NOT EXISTS idx_sn_lot_sn ON wms_sn_material_lots(sn_no);
CREATE INDEX IF NOT EXISTS idx_sn_lot_lot ON wms_sn_material_lots(material_lot_no);
CREATE INDEX IF NOT EXISTS idx_outbound_no ON wms_outbound_orders(outbound_no);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON wms_outbound_orders(status);
CREATE INDEX IF NOT EXISTS idx_outbound_cust ON wms_outbound_orders(customer_code);

INSERT INTO _migrations(filename, hash)
VALUES ('180_wms_finished_goods.sql', 'wms-finished-goods-v1')
ON CONFLICT (filename) DO NOTHING;
COMMIT;
