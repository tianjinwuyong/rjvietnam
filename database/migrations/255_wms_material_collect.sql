-- 255: WMS material collect orders — the warehouse collection step between
-- WO pick planning (GET /wms/pick-orders) and line issue. When a work order
-- needs material, WMS generates a collect order from the same FIFO pick-order
-- items (material + lot + location). A warehouse material collector walks the
-- list with the PDA, scans the storage-location QR (location_qr) and then the
-- material roll/lot to confirm each line is physically collected. Web's
-- material-issue page shows this collect status (which locations to pick from,
-- what is already collected) before issuing to the line.
--
-- One collect order per work order. Lines are immutable snapshots taken when
-- the order is generated (lot_no + location + required qty at that moment).

CREATE TABLE IF NOT EXISTS wms_collect_orders (
  id              BIGSERIAL PRIMARY KEY,
  collect_no      VARCHAR(40) NOT NULL UNIQUE,
  work_order_code VARCHAR(80) NOT NULL,
  work_order_id   BIGINT,
  line_code       VARCHAR(40),
  status          VARCHAR(20) NOT NULL DEFAULT 'OPEN',   -- OPEN | PARTIAL | COLLECTED | CANCELLED
  collector       VARCHAR(80),
  collector_id    BIGINT,
  collected_at    TIMESTAMPTZ,
  created_by      VARCHAR(80),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wms_collect_orders_wo     ON wms_collect_orders(work_order_code);
CREATE INDEX IF NOT EXISTS idx_wms_collect_orders_status ON wms_collect_orders(status);

CREATE TABLE IF NOT EXISTS wms_collect_order_lines (
  id                BIGSERIAL PRIMARY KEY,
  collect_order_id  BIGINT NOT NULL REFERENCES wms_collect_orders(id) ON DELETE CASCADE,
  line_no           INT NOT NULL,
  material_code     VARCHAR(80) NOT NULL,
  material_name     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ruijing_code      VARCHAR(80),
  lot_no            VARCHAR(120),
  material_sn       VARCHAR(120),
  location_code     VARCHAR(80),
  location_qr       VARCHAR(160),
  required_qty      NUMERIC NOT NULL DEFAULT 0,
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | COLLECTED
  scanned_qr        VARCHAR(240),
  collected_by      VARCHAR(80),
  collected_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (collect_order_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_wms_collect_lines_order ON wms_collect_order_lines(collect_order_id);
CREATE INDEX IF NOT EXISTS idx_wms_collect_lines_lot   ON wms_collect_order_lines(lot_no);
