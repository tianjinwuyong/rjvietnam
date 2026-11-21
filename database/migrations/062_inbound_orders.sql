-- Migration 062: Inbound Orders
-- 入库单：供应商发货 → 来料接收 → IQC → 入库/拒收

CREATE SEQUENCE IF NOT EXISTS inbound_orders_seq;
CREATE SEQUENCE IF NOT EXISTS inbound_order_lines_seq;

CREATE TABLE IF NOT EXISTS inbound_orders (
    id                        bigserial PRIMARY KEY,
    doc_no                    varchar(25)  UNIQUE,
    doc_type                  varchar(30)  NOT NULL DEFAULT 'INBOUND_ORDER',
    status                    varchar(20)  NOT NULL DEFAULT 'DRAFT',
    -- Supplier
    supplier_id               bigint,
    supplier_code             varchar(50),
    supplier_name             varchar(100),
    -- Warehouse operator who received
    warehouse_operator_id     bigint,
    warehouse_operator_name   varchar(100),
    -- Workflow timestamps
    submitted_at              timestamptz,
    approved_at               timestamptz,
    approved_by               bigint,
    rejected_at               timestamptz,
    rejected_by               bigint,
    rejection_reason          varchar(200),
    executed_at               timestamptz,
    completed_at             timestamptz,
    cancelled_at              timestamptz,
    cancelled_by              bigint,
    -- Notes
    notes                     varchar(500),
    created_by                bigint       NOT NULL,
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz
);

CREATE TABLE IF NOT EXISTS inbound_order_lines (
    id                        bigserial PRIMARY KEY,
    inbound_order_id          bigint       NOT NULL REFERENCES inbound_orders(id) ON DELETE CASCADE,
    material_id               bigint,
    material_code             varchar(50),
    material_name_zh          varchar(100),
    unit                      varchar(20),
    requested_qty             numeric(38,6),
    approved_qqty             numeric(38,6),
    executed_qty              numeric(38,6),
    lot_no                    varchar(80),
    location_code             varchar(30),
    location_name             varchar(100),
    line_status               varchar(20)  NOT NULL DEFAULT 'DRAFT',
    remarks                   varchar(200),
    created_at                timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE inbound_orders IS '入库单 — 供应商发货到货后创建，经IQC判定后执行入库';
COMMENT ON COLUMN inbound_orders.status IS 'DRAFT | SUBMITTED | APPROVED | EXECUTING | COMPLETED | REJECTED | CANCELLED';
COMMENT ON TABLE inbound_order_lines IS '入库单明细行';
COMMENT ON COLUMN inbound_order_lines.line_status IS 'DRAFT | APPROVED | REJECTED';

CREATE INDEX idx_io_doc_no        ON inbound_orders(doc_no);
CREATE INDEX idx_io_status      ON inbound_orders(status);
CREATE INDEX idx_io_supplier     ON inbound_orders(supplier_id);
CREATE INDEX idx_io_created      ON inbound_orders(created_at DESC);
CREATE INDEX idx_iol_parent      ON inbound_order_lines(inbound_order_id);
CREATE INDEX idx_iol_material    ON inbound_order_lines(material_id);

ALTER TABLE inbound_orders    ADD CONSTRAINT chk_io_status
    CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','EXECUTING','COMPLETED','REJECTED','CANCELLED')) NOT DEFERRABLE;
ALTER TABLE inbound_order_lines ADD CONSTRAINT chk_iol_status
    CHECK (line_status IN ('DRAFT','APPROVED','REJECTED')) NOT DEFERRABLE;

-- Sample
INSERT INTO inbound_orders (doc_no, supplier_code, supplier_name, status, warehouse_operator_id, warehouse_operator_name, created_by)
VALUES ('IN-' || to_char(now(),'YYYYMMDD') || '-000001', 'SUP-001', 'Sample Supplier Co.', 'DRAFT', 1, 'Warehouse Op', 1)
ON CONFLICT (doc_no) DO NOTHING;

INSERT INTO _migrations (filename, hash) VALUES ('062_inbound_orders.sql', 'inbound-orders')
ON CONFLICT (filename) DO NOTHING;
