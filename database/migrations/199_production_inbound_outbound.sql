-- Migration 199: Production Inbound/Outbound Management
-- Excel menu: "生产出入库管理" (Production In/Outbound Management)
-- Production flow: MO → Material Issue → Production → FG Receipt → Inventory Update
-- Trigger: MES work order starts → auto-create production order

BEGIN;

CREATE SEQUENCE IF NOT EXISTS fg_seq START 1;


-- ============================================================
-- Table 1: production_orders (production work order header)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_orders (
    id              BIGSERIAL PRIMARY KEY,
    factory_id      VARCHAR(32) NOT NULL DEFAULT 'VN_RUIJING',
    order_no        VARCHAR(64) NOT NULL UNIQUE,
    mo_number       VARCHAR(64) NOT NULL,
    material_code   VARCHAR(64) NOT NULL,
    material_name   VARCHAR(256),
    planned_qty     DECIMAL(12,2) NOT NULL DEFAULT 0,
    completed_qty   DECIMAL(12,2) NOT NULL DEFAULT 0,
    output_qty      DECIMAL(12,2) NOT NULL DEFAULT 0,
    status          VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    work_center     VARCHAR(64),
    order_date      DATE,
    actual_start    TIMESTAMPTZ,
    actual_end      TIMESTAMPTZ,
    line_id         BIGINT,
    supervisor_id   BIGINT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      BIGINT
);

CREATE INDEX IF NOT EXISTS idx_prod_orders_mo ON production_orders(mo_number);
CREATE INDEX IF NOT EXISTS idx_prod_orders_status ON production_orders(factory_id, status);
CREATE INDEX IF NOT EXISTS idx_prod_orders_date ON production_orders(factory_id, order_date);

-- ============================================================
-- Table 2: production_order_items (BOM lines: materials to consume)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_order_items (
    id                  BIGSERIAL PRIMARY KEY,
    production_order_id  BIGINT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
    line_no             INTEGER NOT NULL DEFAULT 1,
    material_code       VARCHAR(64) NOT NULL,
    material_name       VARCHAR(256),
    unit_code           VARCHAR(16),
    planned_qty         DECIMAL(12,2) NOT NULL DEFAULT 0,
    issued_qty          DECIMAL(12,2) NOT NULL DEFAULT 0,
    consumed_qty        DECIMAL(12,2) NOT NULL DEFAULT 0,
    returned_qty        DECIMAL(12,2) NOT NULL DEFAULT 0,
    scrap_qty           DECIMAL(12,2) NOT NULL DEFAULT 0,
    warehouse_code      VARCHAR(32),
    location_code       VARCHAR(32),
    remarks             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_order_items_oid ON production_order_items(production_order_id);

-- ============================================================
-- Table 3: production_finished_goods (finished goods receipt)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_finished_goods (
    id                  BIGSERIAL PRIMARY KEY,
    factory_id          VARCHAR(32) NOT NULL DEFAULT 'VN_RUIJING',
    production_order_id BIGINT NOT NULL REFERENCES production_orders(id),
    receipt_no          VARCHAR(64) NOT NULL UNIQUE,
    material_code       VARCHAR(64) NOT NULL,
    material_name       VARCHAR(256),
    quantity            DECIMAL(12,2) NOT NULL DEFAULT 0,
    unit_code           VARCHAR(16) DEFAULT 'PCS',
    serial_no           VARCHAR(128),
    batch_no            VARCHAR(64),
    warehouse_code      VARCHAR(32),
    location_code       VARCHAR(32),
    status              VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    qc_result          VARCHAR(16),
    qc_inspector       VARCHAR(64),
    qc_inspected_at    TIMESTAMPTZ,
    production_date     DATE,
    expiry_date         DATE,
    remarks             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_by        BIGINT,
    received_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pfg_order ON production_finished_goods(production_order_id);
CREATE INDEX IF NOT EXISTS idx_pfg_receipt ON production_finished_goods(receipt_no);
CREATE INDEX IF NOT EXISTS idx_pfg_serial ON production_finished_goods(serial_no) WHERE serial_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pfg_status ON production_finished_goods(factory_id, status);

-- ============================================================
-- Table 4: production_material_transactions (inventory tx log)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_material_transactions (
    id                  BIGSERIAL PRIMARY KEY,
    factory_id          VARCHAR(32) NOT NULL DEFAULT 'VN_RUIJING',
    production_order_id BIGINT REFERENCES production_orders(id),
    transaction_type    VARCHAR(32) NOT NULL,
    material_code       VARCHAR(64) NOT NULL,
    lot_no              VARCHAR(64),
    warehouse_code      VARCHAR(32),
    from_location      VARCHAR(32),
    to_location         VARCHAR(32),
    quantity            DECIMAL(12,2) NOT NULL,
    uom                 VARCHAR(16),
    reference_no        VARCHAR(64),
    operator_id        BIGINT,
    operator_name      VARCHAR(128),
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    remarks             TEXT
);

CREATE INDEX IF NOT EXISTS idx_pmt_order ON production_material_transactions(production_order_id);
CREATE INDEX IF NOT EXISTS idx_pmt_type ON production_material_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_pmt_at ON production_material_transactions(occurred_at);

COMMIT;
